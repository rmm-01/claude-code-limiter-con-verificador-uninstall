'use strict';

const db = require('../db');

/**
 * Evaluate all limit rules for a user/model combination.
 *
 * Evaluation order (first deny wins):
 *   1. Is user killed/paused?           -> BLOCK
 *   2. Is model in allowed time window? -> if no, BLOCK
 *   3. Is per-model cap exceeded?       -> if yes, BLOCK
 *   4. Is credit budget exceeded?       -> if yes, BLOCK
 *   5. Is effort level over user cap?   -> if yes, BLOCK
 *   6. Are subagents over limit?        -> if yes, BLOCK
 *   7. Are tokens over limit?           -> if yes, BLOCK
 *   8. ALLOW
 *
 * @param {object} user - The user row from the database.
 * @param {string} model - The model being used (opus, sonnet, haiku, default).
 * @param {object} creditWeights - { opus: 10, sonnet: 3, haiku: 1 }
 * @param {object} [extra] - { effort_level, is_subagent }
 * @returns {{ allowed: boolean, reason?: string, usage: object, credit_balance?: number, credit_budget?: number }}
 */
function evaluateLimits(user, model, creditWeights, extra) {
  // 1. Check user status
  if (user.status === 'killed') {
    return {
      allowed: false,
      reason: 'Your Claude Code access has been revoked by the admin. Contact your admin to restore access.',
      usage: {},
    };
  }
  if (user.status === 'paused') {
    return {
      allowed: false,
      reason: 'Your Claude Code access has been paused by the admin. Contact your admin to resume.',
      usage: {},
    };
  }

  const rules = db.getLimitRules(user.id);
  if (rules.length === 0) {
    // No rules = unlimited
    return { allowed: true, usage: {} };
  }

  // Gather usage data we will need
  const usageCache = {}; // key: `${model}:${window}` -> count
  const creditCache = {}; // key: window -> totalCredits

  function getModelUsage(mdl, windowType) {
    const key = `${mdl}:${windowType}`;
    if (usageCache[key] !== undefined) return usageCache[key];
    const windowStart = db.calculateWindowStart(windowType);
    const rows = db.getDb().prepare(
      'SELECT COUNT(*) AS count FROM usage_event WHERE user_id = ? AND model = ? AND timestamp >= ?'
    ).get(user.id, mdl, windowStart);
    usageCache[key] = rows.count;
    return rows.count;
  }

  function getCreditUsage(windowType) {
    if (creditCache[windowType] !== undefined) return creditCache[windowType];
    const windowStart = db.calculateWindowStart(windowType);
    const row = db.getDb().prepare(
      'SELECT COALESCE(SUM(credit_cost), 0) AS total FROM usage_event WHERE user_id = ? AND timestamp >= ?'
    ).get(user.id, windowStart);
    creditCache[windowType] = row.total;
    return row.total;
  }

  // Collect all usage for the response
  const usageSummary = {};
  let creditBalance = null;
  let creditBudget = null;

  // 2. Check time_of_day rules
  const timeRules = rules.filter(r => r.type === 'time_of_day');
  for (const rule of timeRules) {
    // Only applies to the specified model, or all if model is null
    if (rule.model && rule.model !== model) continue;

    const inWindow = isInTimeWindow(rule.schedule_start, rule.schedule_end, rule.schedule_tz);
    if (!inWindow) {
      const tz = rule.schedule_tz || 'UTC';
      const currentTime = getCurrentTimeInTZ(tz);
      const modelName = rule.model || 'This model';
      return {
        allowed: false,
        reason: `${capitalize(modelName)} is only available ${rule.schedule_start} - ${rule.schedule_end} (${tz}).\nCurrent time: ${currentTime}. Try another model instead.`,
        usage: usageSummary,
      };
    }
  }

  // 3. Check per_model rules
  const perModelRules = rules.filter(r => r.type === 'per_model');
  for (const rule of perModelRules) {
    // Skip rules that don't apply to this model
    if (rule.model && rule.model !== model) continue;

    const targetModel = rule.model || model;
    const count = getModelUsage(targetModel, rule.window);
    const limit = rule.value;

    // Track in usage summary
    if (!usageSummary[rule.window]) usageSummary[rule.window] = {};
    usageSummary[rule.window][targetModel] = { used: count, limit };

    if (limit === -1) continue; // unlimited
    if (limit === 0 || count >= limit) {
      if (limit === 0) {
        return {
          allowed: false,
          reason: `El modelo ${capitalize(targetModel)} no está permitido para ${user.name}.\n\nUsá otro modelo o contactá al admin.`,
          usage: usageSummary,
        };
      }
      const windowLabel = windowToLabel(rule.window);
      return {
        allowed: false,
        reason: `${capitalize(windowLabel)} ${targetModel} limit reached for ${user.name}.\nUsed ${count}/${limit} prompts.\n\nSwitch to another model or try again later.`,
        usage: usageSummary,
      };
    }
  }

  // 4a. Dollar budget (only in dollars mode; the other mode's rule stays stored but dormant)
  const mode = effectiveLimitMode(user);
  if (mode === 'dollars') {
    for (const rule of rules.filter(r => r.type === 'dollars')) {
      if (rule.value === -1) continue;
      const used = db.getUsdUsage(user.id, db.calculateWindowStart(rule.window));
      const balance = Math.max(0, rule.value - used);
      if (!usageSummary[rule.window]) usageSummary[rule.window] = {};
      usageSummary[rule.window]._usd = { used, budget: rule.value, balance };
      if (rule.value === 0 || used >= rule.value) {
        const windowLabel = windowToLabel(rule.window);
        return {
          allowed: false,
          reason: `Presupuesto ${windowLabel} en dólares agotado para ${user.name}.\nUsados US$${used.toFixed(2)} de US$${Number(rule.value).toFixed(2)}.\n\nEsperá a que se reinicie la ventana o contactá al admin.`,
          usage: usageSummary,
        };
      }
    }
  }

  // 4. Check credit budget rules (only in credits mode)
  const creditRules = mode === 'credits' ? rules.filter(r => r.type === 'credits') : [];
  for (const rule of creditRules) {
    const budget = rule.value;
    if (budget === -1) continue; // unlimited

    const usedCredits = getCreditUsage(rule.window);
    const balance = Math.max(0, budget - usedCredits);

    creditBalance = balance;
    creditBudget = budget;

    if (!usageSummary[rule.window]) usageSummary[rule.window] = {};
    usageSummary[rule.window]._credits = { used: usedCredits, budget, balance };

    // Check if the next prompt would exceed the budget
    const modelCost = creditWeights[model] || creditWeights['default'] || 1;
    if (balance < modelCost) {
      const windowLabel = windowToLabel(rule.window);
      return {
        allowed: false,
        reason: `${capitalize(windowLabel)} credit budget exhausted for ${user.name}.\nUsed ${usedCredits}/${budget} credits (${balance} remaining).\n${capitalize(model)} costs ${modelCost} credits per prompt.\n\nTry a cheaper model or wait for the window to reset.`,
        usage: usageSummary,
        credit_balance: balance,
        credit_budget: budget,
      };
    }
  }

  // 5. Check effort level cap (per-user setting, not a limit_rule)
  const effortLevel = extra && extra.effort_level;
  if (effortLevel && user.max_effort_level && user.max_effort_level !== 'max') {
    if (!isEffortAllowed(effortLevel, user.max_effort_level)) {
      return {
        allowed: false,
        reason: `Effort level "${effortLevel}" no permitido para ${user.name}.\nNivel máximo: "${user.max_effort_level}".\n\nUsá /effort ${user.max_effort_level} para cambiar el nivel.`,
        usage: usageSummary,
      };
    }
  }

  // 6. Check subagent limit rules
  const subagentRules = rules.filter(r => r.type === 'subagents');
  for (const rule of subagentRules) {
    const windowStart = db.calculateWindowStart(rule.window);
    const count = db.getSubagentCount(user.id, windowStart);
    if (!usageSummary[rule.window]) usageSummary[rule.window] = {};
    usageSummary[rule.window]._subagents = { used: count, limit: rule.value };

    if (rule.value === -1) continue;
    if (rule.value === 0 || count >= rule.value) {
      const windowLabel = windowToLabel(rule.window);
      return {
        allowed: false,
        reason: `Límite ${windowLabel} de subagentes/workflows alcanzado para ${user.name}.\nUsados ${count}/${rule.value} subagentes.\n\nEsperá a que se reinicie la ventana o contactá al admin.`,
        usage: usageSummary,
      };
    }
  }

  // 7. Check token budget rules
  const tokenRules = rules.filter(r => r.type === 'tokens');
  for (const rule of tokenRules) {
    const windowStart = db.calculateWindowStart(rule.window);
    const tokenData = db.getTokenUsage(user.id, windowStart);
    if (!usageSummary[rule.window]) usageSummary[rule.window] = {};
    usageSummary[rule.window]._tokens = { used: tokenData.total, limit: rule.value, input: tokenData.input, output: tokenData.output };

    if (rule.value === -1) continue;
    if (rule.value === 0 || tokenData.total >= rule.value) {
      const windowLabel = windowToLabel(rule.window);
      const usedK = Math.round(tokenData.total / 1000);
      const limitK = Math.round(rule.value / 1000);
      return {
        allowed: false,
        reason: `Límite ${windowLabel} de tokens alcanzado para ${user.name}.\nUsados ~${usedK}k/${limitK}k tokens.\n\nEsperá a que se reinicie la ventana o usá un modelo más económico.`,
        usage: usageSummary,
      };
    }
  }

  // 8. ALLOW
  // Populate usage for the response even on allow
  const defaultWindow = creditRules.length > 0 ? creditRules[0].window : (perModelRules.length > 0 ? perModelRules[0].window : 'daily');
  if (Object.keys(usageSummary).length === 0) {
    const windowStart = db.calculateWindowStart(defaultWindow);
    const data = db.getUsageWithCredits(user.id, windowStart);
    usageSummary[defaultWindow] = data.counts;
  }

  return {
    allowed: true,
    usage: usageSummary,
    credit_balance: creditBalance,
    credit_budget: creditBudget,
  };
}

// Hard block only (checklist unticked = per_model value 0). Caps are not checked
// here: they are judged on the declared model, so a legit /model switch is not punished.
function isModelBlocked(user, model) {
  return db.getLimitRules(user.id).some(r => r.type === 'per_model' && r.value === 0 && (!r.model || r.model === model));
}

/** 'credits' or 'dollars': the user's override, else the team's, else credits. */
function effectiveLimitMode(user) {
  if (user.limit_mode === 'credits' || user.limit_mode === 'dollars') return user.limit_mode;
  const team = db.getTeam(user.team_id);
  return team && team.limit_mode === 'dollars' ? 'dollars' : 'credits';
}

/** Rules the hook needs for offline evaluation: no dollar rules, no dormant credit rule. */
function hookLimits(user, rules) {
  const credits = effectiveLimitMode(user) === 'credits';
  return rules.filter(r => r.type !== 'dollars' && (r.type !== 'credits' || credits));
}

const KNOWN_MODELS = ['fable', 'opus', 'sonnet', 'haiku'];

// Value for Claude Code's managed `availableModels`; null = leave unrestricted.
// shortcut: all four blocked also yields null (an empty list is ambiguous), so
// the hook's own per_model block is the only guard then; revisit if that is used.
function allowedModels(user) {
  const allowed = KNOWN_MODELS.filter(m => !isModelBlocked(user, m));
  return allowed.length === 0 || allowed.length === KNOWN_MODELS.length ? null : allowed;
}

const EFFORT_HIERARCHY = ['low', 'medium', 'high', 'xhigh', 'max'];

function isEffortAllowed(requested, maxAllowed) {
  const reqIdx = EFFORT_HIERARCHY.indexOf(requested);
  const maxIdx = EFFORT_HIERARCHY.indexOf(maxAllowed);
  if (reqIdx === -1 || maxIdx === -1) return true;
  return reqIdx <= maxIdx;
}

/**
 * Check if the current time falls within a schedule window in a given timezone.
 * @param {string} startTime - "HH:MM" format
 * @param {string} endTime - "HH:MM" format
 * @param {string} [tz] - IANA timezone (e.g., "America/New_York")
 * @returns {boolean}
 */
function isInTimeWindow(startTime, endTime, tz) {
  if (!startTime || !endTime) return true; // No schedule = always allowed

  const timeZone = tz || 'UTC';
  const now = new Date();

  // Get current time in the target timezone
  const parts = db.getDatePartsInTZ(now, timeZone);
  const currentMinutes = parts.hour * 60 + parts.minute;

  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    // Same-day window (e.g., 09:00 - 18:00)
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Overnight window (e.g., 22:00 - 06:00)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

/**
 * Get the current time formatted in a given timezone.
 */
function getCurrentTimeInTZ(tz) {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return formatter.format(now);
}

function windowToLabel(window) {
  const labels = {
    daily: 'daily',
    weekly: 'weekly',
    monthly: 'monthly',
    sliding_24h: 'sliding 24-hour',
  };
  return labels[window] || window;
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

module.exports = {
  evaluateLimits,
  isModelBlocked,
  allowedModels,
  effectiveLimitMode,
  hookLimits,
  isInTimeWindow,
  isEffortAllowed,
  EFFORT_HIERARCHY,
};
