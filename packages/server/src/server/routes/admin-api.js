'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyPassword, hashPassword, createJWT, adminAuth } = require('../services/auth');
const { getUsageSummary, getCreditBalance } = require('../services/usage');
const { broadcast } = require('../ws');

function pickDefined(obj, keys) {
  const result = {};
  for (const k of keys) {
    if (obj[k] !== undefined) result[k] = obj[k];
  }
  return result;
}

/**
 * POST /api/admin/login
 * Verify admin password, return JWT.
 * Body: { password }
 */
router.post('/login', (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password required' });
    }

    const team = db.getDefaultTeam();
    if (!team) {
      return res.status(500).json({ error: 'No team configured' });
    }

    if (!verifyPassword(password, team.admin_password)) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const token = createJWT({ teamId: team.id });

    // Set cookie and return token
    res.cookie('jwt', token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    let effortMults = { low: 0.5, medium: 1, high: 2, xhigh: 4, max: 6 };
    try { effortMults = JSON.parse(team.effort_multipliers || '{}'); } catch {}

    res.json({
      token,
      team: {
        id: team.id,
        name: team.name,
        credit_weights: JSON.parse(team.credit_weights),
        effort_multipliers: effortMults,
      },
    });
  } catch (err) {
    console.error('POST /login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// All routes below require admin auth
router.use(adminAuth);

/**
 * GET /api/admin/users
 * List all users with live usage and device info.
 */
router.get('/users', (req, res) => {
  try {
    const team = req.team;
    const creditWeights = JSON.parse(team.credit_weights);
    const users = db.getAllUsers(team.id);

    // Build the date keys for the last 7 days (inclusive of today), oldest first.
    // Used to render sparklines in the Resumen UserCard.
    const sparkDayKeys = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      sparkDayKeys.push(d.toISOString().split('T')[0]);
    }
    const sparkSince = sparkDayKeys[0] + 'T00:00:00.000Z';
    // Single batch query: credits per (user, day) for all users in the team.
    const sparkRows = db.getDb().prepare(
      `SELECT ue.user_id, DATE(ue.timestamp) AS date, SUM(ue.credit_cost) AS credits
       FROM usage_event ue
       JOIN user u ON ue.user_id = u.id
       WHERE u.team_id = ? AND ue.timestamp >= ?
       GROUP BY ue.user_id, DATE(ue.timestamp)`
    ).all(team.id, sparkSince);
    const sparkMap = {};
    for (const r of sparkRows) {
      if (!sparkMap[r.user_id]) sparkMap[r.user_id] = {};
      sparkMap[r.user_id][r.date] = r.credits;
    }

    // Same 7-day window: tokens and model versions per user, for the cards.
    const tokenMap = {};
    for (const r of db.getDb().prepare(
      `SELECT ue.user_id,
              COALESCE(SUM(ue.input_tokens), 0) AS input,
              COALESCE(SUM(ue.output_tokens), 0) AS output,
              COALESCE(SUM(ue.cache_read_tokens), 0) AS cache_read,
              COUNT(ue.input_tokens) AS turns_with_tokens
       FROM usage_event ue
       JOIN user u ON ue.user_id = u.id
       WHERE u.team_id = ? AND ue.timestamp >= ?
       GROUP BY ue.user_id`
    ).all(team.id, sparkSince)) {
      tokenMap[r.user_id] = { input: r.input, output: r.output, cache_read: r.cache_read, total: r.input + r.output, turns_with_tokens: r.turns_with_tokens };
    }
    const versionMap = {};
    for (const r of db.getDb().prepare(
      `SELECT ue.user_id, ue.model, ue.model_version, COUNT(*) AS count
       FROM usage_event ue
       JOIN user u ON ue.user_id = u.id
       WHERE u.team_id = ? AND ue.timestamp >= ?
         AND ue.model_version IS NOT NULL AND ue.model_version != ue.model
       GROUP BY ue.user_id, ue.model, ue.model_version
       ORDER BY count DESC`
    ).all(team.id, sparkSince)) {
      if (!versionMap[r.user_id]) versionMap[r.user_id] = [];
      versionMap[r.user_id].push({ model: r.model, model_version: r.model_version, count: r.count });
    }

    const result = users.map(user => {
      const limits = db.getLimitRules(user.id);
      const usageSummary = getUsageSummary(user.id);
      const devices = db.getDevices(user.id);

      // Get last session time from session_event table
      const lastSession = db.getDb().prepare(
        'SELECT MAX(timestamp) AS last_session FROM session_event WHERE user_id = ? AND type = \'session_start\''
      ).get(user.id);

      // Credit info
      const creditRule = limits.find(r => r.type === 'credits');
      let creditBalance = null;
      let creditBudget = null;
      if (creditRule) {
        const cb = getCreditBalance(user.id, creditWeights, creditRule.window, creditRule.value);
        creditBalance = cb.balance;
        creditBudget = cb.budget;
      }

      // 7-day credits array (one number per day, oldest first) for the sparkline.
      const userSpark = sparkMap[user.id] || {};
      const dailyCredits7d = sparkDayKeys.map(k => userSpark[k] || 0);

      return {
        id: user.id,
        slug: user.slug,
        name: user.name,
        status: user.status,
        killed_at: user.killed_at,
        last_seen: user.last_seen,
        last_session: lastSession ? lastSession.last_session : null,
        created_at: user.created_at,
        allow_self_uninstall: !!user.allow_self_uninstall,
        allow_agents: !!user.allow_agents,
        allow_user_hooks: !!user.allow_user_hooks,
        allow_workflows: !!user.allow_workflows,
        max_effort_level: user.max_effort_level || 'max',
        last_tampering_at: user.last_tampering_at || null,
        limits,
        usage: usageSummary,
        credit_balance: creditBalance,
        credit_budget: creditBudget,
        daily_credits_7d: dailyCredits7d,
        tokens_7d: tokenMap[user.id] || { input: 0, output: 0, cache_read: 0, total: 0, turns_with_tokens: 0 },
        versions_7d: versionMap[user.id] || [],
        devices: devices.map(d => ({
          id: d.id,
          hostname: d.hostname,
          platform: d.platform,
          arch: d.arch,
          os_version: d.os_version,
          claude_version: d.claude_version,
          last_seen: d.last_seen,
          last_ip: d.last_ip,
        })),
      };
    });

    res.json({ users: result });
  } catch (err) {
    console.error('GET /users error:', err);
    console.error('  message:', err && err.message);
    console.error('  code:   ', err && err.code);
    console.error('  stack:  ', err && err.stack);
    // TEMPORARY: echo detail in the response so we can debug from the browser.
    res.status(500).json({
      error: 'Internal server error',
      detail: err && err.message,
      code: err && err.code,
    });
  }
});

/**
 * POST /api/admin/users
 * Create a user and generate an install code.
 * Body: { name, slug, limits? }
 */
router.post('/users', (req, res) => {
  try {
    const team = req.team;
    const { name, slug, limits } = req.body;

    if (!name || !slug) {
      return res.status(400).json({ error: 'name and slug are required' });
    }

    // Check slug uniqueness
    const existing = db.getUserBySlug(team.id, slug);
    if (existing) {
      return res.status(409).json({ error: `User with slug "${slug}" already exists` });
    }

    // Create user
    const user = db.createUser({ teamId: team.id, slug, name });

    // Create limit rules if provided
    if (limits && Array.isArray(limits)) {
      for (const rule of limits) {
        db.createLimitRule({
          userId: user.id,
          type: rule.type,
          model: rule.model,
          window: rule.window,
          value: rule.value,
          schedule_start: rule.schedule_start,
          schedule_end: rule.schedule_end,
          schedule_tz: rule.schedule_tz,
        });
      }
    }

    // Generate install code
    const installCode = db.createInstallCode(user.id);

    // Get the full user with limits
    const fullLimits = db.getLimitRules(user.id);

    res.status(201).json({
      user: {
        id: user.id,
        slug: user.slug,
        name: user.name,
        status: user.status,
        auth_token: user.auth_token,
        created_at: user.created_at,
      },
      limits: fullLimits,
      install_code: installCode,
    });
  } catch (err) {
    console.error('POST /users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/admin/users/:id
 * Update a user (name, slug, status, limits).
 * Body: { name?, slug?, status?, limits? }
 */
router.put('/users/:id', (req, res) => {
  try {
    const userId = req.params.id;
    const user = db.getUser(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify user belongs to this team
    if (user.team_id !== req.teamId) {
      return res.status(403).json({ error: 'User does not belong to your team' });
    }

    const { limits } = req.body;
    const updates = pickDefined(req.body, ['name', 'slug', 'status', 'allow_self_uninstall', 'allow_agents', 'allow_user_hooks', 'allow_workflows', 'max_effort_level']);

    // Reset expected hash when toggling agents or user hooks — the hook will
    // modify managed-settings.json on next sync, so the old hash is stale.
    if (updates.allow_agents !== undefined || updates.allow_user_hooks !== undefined) {
      updates.expected_managed_settings_hash = null;
    }

    if (Object.keys(updates).length > 0) {
      db.updateUser(userId, updates);
    }

    if (Array.isArray(limits)) {
      db.deleteLimitRulesForUser(userId);
      for (const rule of limits) {
        db.createLimitRule({
          userId,
          type: rule.type,
          model: rule.model,
          window: rule.window,
          value: rule.value,
          schedule_start: rule.schedule_start,
          schedule_end: rule.schedule_end,
          schedule_tz: rule.schedule_tz,
        });
      }
    }

    const updatedUser = db.getUser(userId);
    const updatedLimits = db.getLimitRules(userId);

    // Broadcast status change
    if (updates.status && updates.status !== user.status) {
      const eventType = updates.status === 'killed' ? 'user_killed' : 'user_status_change';
      broadcast({
        type: eventType,
        userId: updatedUser.id,
        userName: updatedUser.name,
        oldStatus: user.status,
        newStatus: updates.status,
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      user: {
        id: updatedUser.id,
        slug: updatedUser.slug,
        name: updatedUser.name,
        status: updatedUser.status,
        killed_at: updatedUser.killed_at,
        last_seen: updatedUser.last_seen,
        created_at: updatedUser.created_at,
        allow_self_uninstall: !!updatedUser.allow_self_uninstall,
        allow_agents: !!updatedUser.allow_agents,
        allow_user_hooks: !!updatedUser.allow_user_hooks,
        allow_workflows: !!updatedUser.allow_workflows,
        max_effort_level: updatedUser.max_effort_level || 'max',
      },
      limits: updatedLimits,
    });
  } catch (err) {
    console.error('PUT /users/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/users/:id/install-code
 * Returns the pending unused install code for a user, if any.
 */
router.get('/users/:id/install-code', (req, res) => {
  try {
    const user = db.getUser(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.team_id !== req.teamId) return res.status(403).json({ error: 'Forbidden' });

    const row = db.getUnusedInstallCode(req.params.id);
    res.json({ install_code: row ? row.code : null });
  } catch (err) {
    console.error('GET /users/:id/install-code error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/users/:id/install-code
 * Invalidates any existing unused codes and generates a new one.
 */
router.post('/users/:id/install-code', (req, res) => {
  try {
    const user = db.getUser(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.team_id !== req.teamId) return res.status(403).json({ error: 'Forbidden' });

    db.invalidateUnusedInstallCodes(req.params.id);
    const code = db.createInstallCode(req.params.id);
    res.json({ install_code: code });
  } catch (err) {
    console.error('POST /users/:id/install-code error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/admin/users/:id
 * Remove a user and all related data.
 */
router.delete('/users/:id', (req, res) => {
  try {
    const userId = req.params.id;
    const user = db.getUser(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.team_id !== req.teamId) {
      return res.status(403).json({ error: 'User does not belong to your team' });
    }

    db.deleteUser(userId);

    res.json({ deleted: true, userId });
  } catch (err) {
    console.error('DELETE /users/:id error:', err);
    console.error('  message:', err && err.message);
    console.error('  code:   ', err && err.code);
    console.error('  stack:  ', err && err.stack);
    res.status(500).json({
      error: 'Internal server error',
      detail: err && err.message,
      code: err && err.code,
    });
  }
});

/**
 * GET /api/admin/usage
 * Usage history data for charts.
 * Query: ?user_id=X&window=daily&days=30
 */
router.get('/usage', (req, res) => {
  try {
    const team = req.team;
    const { user_id, window: windowType, days } = req.query;
    const numDays = parseInt(days, 10) || 30;

    if (user_id) {
      // Verify user belongs to team
      const user = db.getUser(user_id);
      if (!user || user.team_id !== team.id) {
        return res.status(404).json({ error: 'User not found' });
      }

      const usageSummary = getUsageSummary(user_id);

      // Get daily breakdown for chart
      const since = new Date(Date.now() - numDays * 24 * 60 * 60 * 1000).toISOString();
      const dailyRows = db.getDb().prepare(
        `SELECT DATE(timestamp) AS day, model, COUNT(*) AS count, SUM(credit_cost) AS credits,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
                COUNT(input_tokens) AS turns_with_tokens
         FROM usage_event
         WHERE user_id = ? AND timestamp >= ?
         GROUP BY DATE(timestamp), model
         ORDER BY day ASC`
      ).all(user_id, since);

      res.json({ user_id, summary: usageSummary, daily: dailyRows });
    } else {
      // All users
      const users = db.getAllUsers(team.id);
      const since = new Date(Date.now() - numDays * 24 * 60 * 60 * 1000).toISOString();

      const dailyRows = db.getDb().prepare(
        `SELECT DATE(e.timestamp) AS day, e.user_id, u.name AS user_name, e.model, COUNT(*) AS count, SUM(e.credit_cost) AS credits,
                COALESCE(SUM(e.input_tokens), 0) AS input_tokens,
                COALESCE(SUM(e.output_tokens), 0) AS output_tokens,
                COALESCE(SUM(e.cache_read_tokens), 0) AS cache_read_tokens,
                COUNT(e.input_tokens) AS turns_with_tokens
         FROM usage_event e
         JOIN user u ON e.user_id = u.id
         WHERE u.team_id = ? AND e.timestamp >= ?
         GROUP BY DATE(e.timestamp), e.user_id, e.model
         ORDER BY day ASC`
      ).all(team.id, since);

      res.json({ daily: dailyRows });
    }
  } catch (err) {
    console.error('GET /usage error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/usage/versions
 * Usage breakdown by model version.
 * Query: ?user_id=X&days=30
 */
router.get('/usage/versions', (req, res) => {
  try {
    const team = req.team;
    const { user_id, days } = req.query;
    const numDays = parseInt(days, 10) || 30;
    const since = new Date(Date.now() - numDays * 24 * 60 * 60 * 1000).toISOString();

    if (user_id) {
      const user = db.getUser(user_id);
      if (!user || user.team_id !== team.id) {
        return res.status(404).json({ error: 'User not found' });
      }
      const rows = db.getUsageByVersion(user_id, since);
      res.json({ user_id, versions: rows });
    } else {
      const rows = db.getDb().prepare(
        `SELECT e.model, e.model_version, e.user_id, u.name AS user_name,
                COUNT(*) AS count, SUM(e.credit_cost) AS total_credits,
                COALESCE(SUM(e.input_tokens), 0) AS input_tokens,
                COALESCE(SUM(e.output_tokens), 0) AS output_tokens,
                COALESCE(SUM(e.cache_read_tokens), 0) AS cache_read_tokens
         FROM usage_event e
         JOIN user u ON e.user_id = u.id
         WHERE u.team_id = ? AND e.timestamp >= ?
         GROUP BY e.model, e.model_version, e.user_id
         ORDER BY e.model, count DESC`
      ).all(team.id, since);
      res.json({ versions: rows });
    }
  } catch (err) {
    console.error('GET /usage/versions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/events
 * Recent usage events.
 * Query: ?limit=50&user_id=X
 */
router.get('/events', (req, res) => {
  try {
    const team = req.team;
    const limit = parseInt(req.query.limit, 10) || 50;
    const userId = req.query.user_id;

    const events = db.getRecentEvents({
      userId: userId || null,
      teamId: team.id,
      limit,
    });

    res.json({ events });
  } catch (err) {
    console.error('GET /events error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/analytics
 * Analytics data for charts and reporting.
 * Query: ?days=7&user_id=xxx
 */
router.get('/analytics', (req, res) => {
  try {
    const team = req.team;
    const days = parseInt(req.query.days, 10) || 7;
    const userId = req.query.user_id || null;

    // If user_id provided, verify user belongs to this team
    if (userId) {
      const user = db.getUser(userId);
      if (!user || user.team_id !== team.id) {
        return res.status(404).json({ error: 'User not found' });
      }
    }

    const analytics = db.getAnalytics(team.id, { days, user_id: userId });
    res.json(analytics);
  } catch (err) {
    console.error('GET /analytics error:', err);
    console.error('  message:', err && err.message);
    console.error('  code:   ', err && err.code);
    console.error('  stack:  ', err && err.stack);
    console.error('  query:  ', req.query);
    console.error('  teamId: ', req.team && req.team.id);
    // TEMPORARY: echo detail in the response so we can debug from the browser
    // without needing Azure log access. Remove once /analytics is stable.
    res.status(500).json({
      error: 'Internal server error',
      detail: err && err.message,
      code: err && err.code,
    });
  }
});

/**
 * PUT /api/admin/settings
 * Update team settings.
 * Body: { name?, credit_weights?, admin_password? }
 */
router.put('/settings', (req, res) => {
  try {
    const team = req.team;
    const { name, credit_weights, effort_multipliers, admin_password } = req.body;

    const updates = {};
    if (name !== undefined) {
      if (typeof name === 'string' && name.trim().length > 50) {
        return res.status(400).json({ error: 'El nombre del equipo no puede superar los 50 caracteres' });
      }
      updates.name = name;
    }
    if (credit_weights !== undefined) updates.credit_weights = credit_weights;
    if (effort_multipliers !== undefined) updates.effort_multipliers = effort_multipliers;
    if (admin_password !== undefined) {
      updates.admin_password = hashPassword(admin_password);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    db.updateTeam(team.id, updates);

    const updatedTeam = db.getTeam(team.id);
    let parsedEffortMultipliers = { low: 0.5, medium: 1, high: 2, xhigh: 4, max: 6 };
    try { parsedEffortMultipliers = JSON.parse(updatedTeam.effort_multipliers || '{}'); } catch {}

    res.json({
      team: {
        id: updatedTeam.id,
        name: updatedTeam.name,
        credit_weights: JSON.parse(updatedTeam.credit_weights),
        effort_multipliers: parsedEffortMultipliers,
      },
    });
  } catch (err) {
    console.error('PUT /settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
