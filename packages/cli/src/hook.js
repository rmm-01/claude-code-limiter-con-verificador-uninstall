#!/usr/bin/env node

/**
 * claude-code-limiter — Hook Script
 * ==================================
 * Standalone rate limiter invoked by Claude Code managed hooks.
 * Zero npm dependencies. Uses only Node.js built-ins.
 * Gets copied to the system-protected directory during setup.
 *
 * Invoked by managed-settings.json hooks:
 *   node hook.js sync     → SessionStart   (cache model, sync config from server)
 *   node hook.js check    → UserPromptSubmit (gate: block if over limit)
 *   node hook.js count    → Stop           (increment turn counter)
 *   node hook.js enforce  → PreToolUse     (local-only kill/pause check)
 *   node hook.js status   → Terminal       (human-readable status)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const https = require("https");
const { execSync } = require("child_process");
const crypto = require("crypto");

// ════════════════════════════════════════════════════════════
// PATHS — System-protected locations per platform
// ════════════════════════════════════════════════════════════

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";

// CLAUDE_LIMITER_DIR override: for testing or custom install locations.
const LIMITER_DIR =
  process.env.CLAUDE_LIMITER_DIR ||
  (IS_WIN
    ? path.join("C:", "Program Files", "ClaudeCode", "limiter")
    : IS_MAC
      ? path.join("/Library", "Application Support", "ClaudeCode", "limiter")
      : path.join("/etc", "claude-code", "limiter"));

// managed-settings.json lives one directory up from LIMITER_DIR
// (e.g. C:\Program Files\ClaudeCode\managed-settings.json).
const MANAGED_SETTINGS_FILE = path.join(path.dirname(LIMITER_DIR), "managed-settings.json");

const CONFIG_FILE = path.join(LIMITER_DIR, "config.json");
const SERVER_FILE = path.join(LIMITER_DIR, "server.json");
const USAGE_DIR = path.join(LIMITER_DIR, "usage");
const CACHE_FILE = path.join(USAGE_DIR, ".cache.json");
const MODEL_FILE = path.join(USAGE_DIR, ".session-model.txt");
const DEBUG_LOG = path.join(USAGE_DIR, "debug.log");

const DEVICE_CACHE_FILE = path.join(USAGE_DIR, ".device-cache.json");

const TODAY = new Date().toISOString().slice(0, 10);
const USAGE_FILE = path.join(USAGE_DIR, `${TODAY}.json`);

// ════════════════════════════════════════════════════════════
// SAFE I/O — Every read/write is wrapped. Hook must never crash.
// ════════════════════════════════════════════════════════════

function readJSON(filepath) {
  try {
    return JSON.parse(fs.readFileSync(filepath, "utf-8"));
  } catch {
    return null;
  }
}

function writeJSON(filepath, data) {
  try {
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    const tmp = filepath + ".tmp." + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filepath);
  } catch (err) {
    debugLog(`WRITE_ERROR: ${filepath}: ${err.message}`);
  }
}

function readText(filepath) {
  try {
    return fs.readFileSync(filepath, "utf-8").trim();
  } catch {
    return null;
  }
}

function writeText(filepath, text) {
  try {
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, text);
  } catch {}
}

let _debugEnabled = false;
function debugLog(msg) {
  if (!_debugEnabled) return;
  try {
    fs.mkdirSync(path.dirname(DEBUG_LOG), { recursive: true });
    const ts = new Date().toISOString();
    fs.appendFileSync(DEBUG_LOG, `[${ts}] ${msg}\n`);
  } catch {}
}

function bootLog(msg) {
  try {
    fs.mkdirSync(path.dirname(DEBUG_LOG), { recursive: true });
    const ts = new Date().toISOString();
    fs.appendFileSync(DEBUG_LOG, `[${ts}] BOOT ${msg}\n`);
  } catch {}
}

process.on("uncaughtException", (err) => {
  bootLog(`UNCAUGHT ${err && (err.stack || err.message) || err}`);
});
process.on("unhandledRejection", (err) => {
  bootLog(`UNHANDLED ${err && (err.stack || err.message) || err}`);
});

function readStdin() {
  try {
    if (process.stdin.isTTY) return {};
    return JSON.parse(fs.readFileSync(0, "utf-8").trim());
  } catch {
    return {};
  }
}

function readStdinAsync(timeoutMs) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve({});
    const chunks = [];
    const timer = setTimeout(() => {
      process.stdin.destroy();
      resolve({});
    }, timeoutMs || 2000);
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8").trim()));
      } catch {
        resolve({});
      }
    });
    process.stdin.on("error", () => { clearTimeout(timer); resolve({}); });
    process.stdin.resume();
  });
}

// ════════════════════════════════════════════════════════════
// MODEL DETECTION
//
// Priority:
//   1. SessionStart stdin (only in sync action)
//   2. ~/.claude/settings.json → model field (catches /model changes)
//   3. ~/.claude/settings.local.json → model
//   4. .claude/settings.json (project) → model
//   5. session-model.txt (cached from SessionStart)
//   6. ANTHROPIC_MODEL env var
//   7. CLAUDE_MODEL env var
//   8. config.defaultModel (detected during setup: Pro=sonnet, Max=opus)
//   9. Falls back to "default"
//
// Normalization: string containing "fable"/"opus"/"sonnet"/"haiku"
// maps to that family. Everything else → "default".
// ════════════════════════════════════════════════════════════

function normalizeModel(raw) {
  const lower = String(raw || "").toLowerCase();
  if (lower.includes("fable")) return "fable";
  if (lower.includes("opus")) return "opus";
  if (lower.includes("sonnet")) return "sonnet";
  if (lower.includes("haiku")) return "haiku";
  return "default";
}

// Extract a normalized version string from a raw model ID.
// "claude-opus-4-6" → "opus-4-6", "claude-fable-5" → "fable-5",
// "claude-sonnet-4-6-20250101" → "sonnet-4-6", "claude-sonnet-5" → "sonnet-5",
// "claude-3-5-haiku-20241022" → "haiku-3-5"
// Falls back to the family name if no version found.
function extractModelVersion(raw) {
  const lower = String(raw || "").toLowerCase().trim();
  // family-major[-minor]; minor is 1-2 digits so an 8-digit date suffix is dropped
  let match = lower.match(/(fable|opus|sonnet|haiku)[- ](\d{1,2})(?:[-.](\d{1,2}))?(?!\d)/);
  if (match) {
    return match[1] + "-" + match[2] + (match[3] ? "-" + match[3] : "");
  }
  // Legacy naming puts the version before the family: claude-3-5-sonnet
  match = lower.match(/(\d{1,2})[-.](\d{1,2})-(fable|opus|sonnet|haiku)/);
  if (match) {
    return match[3] + "-" + match[1] + "-" + match[2];
  }
  return normalizeModel(raw);
}

// Returns the raw model string from the best available source.
function detectModelRaw(stdinData, config) {
  // Source 1: Hook input (SessionStart only — always accurate)
  if (stdinData && stdinData.model) {
    return stdinData.model;
  }

  // Source 2: User settings (updated by /model command)
  const home = os.homedir();
  const userSettings = readJSON(path.join(home, ".claude", "settings.json"));
  if (userSettings) {
    if (userSettings.model) {
      return userSettings.model;
    }
    if (config && config.defaultModel) {
      return config.defaultModel;
    }
  }

  // Source 3: Project/local settings (may force a specific model)
  const localSettings = readJSON(
    path.join(process.cwd(), ".claude", "settings.local.json"),
  );
  if (localSettings && localSettings.model) {
    return localSettings.model;
  }

  const projectSettings = readJSON(
    path.join(process.cwd(), ".claude", "settings.json"),
  );
  if (projectSettings && projectSettings.model) {
    return projectSettings.model;
  }

  // Source 4: Cached from SessionStart
  const cached = readText(MODEL_FILE);
  if (cached) return cached;

  // Source 5: Environment variables
  if (process.env.ANTHROPIC_MODEL) return process.env.ANTHROPIC_MODEL;
  if (process.env.CLAUDE_MODEL) return process.env.CLAUDE_MODEL;

  // Source 6: Plan default from config
  if (config && config.defaultModel) return config.defaultModel;

  return "default";
}

function detectModel(stdinData, config) {
  return normalizeModel(detectModelRaw(stdinData, config));
}

// ════════════════════════════════════════════════════════════
// DEVICE INFO — Cached to avoid repeated system calls
// ════════════════════════════════════════════════════════════

let _deviceInfoCached = null;

function getDeviceInfo(stdinData) {
  if (_deviceInfoCached) return _deviceInfoCached;

  // Try loading from disk cache (refreshed once per day)
  const cached = readJSON(DEVICE_CACHE_FILE);
  if (cached && cached._date === TODAY) {
    _deviceInfoCached = cached;
    return cached;
  }

  let claudeVersion = null;
  try {
    // stdio:pipe captures both streams; no shell redirect needed (works on Windows + POSIX).
    claudeVersion = execSync("claude --version", { timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {}

  const info = {
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    os_version: os.release(),
    node_version: process.version,
    claude_version: claudeVersion || (stdinData && stdinData.claude_version) || null,
    _date: TODAY,
  };

  _deviceInfoCached = info;
  writeJSON(DEVICE_CACHE_FILE, info);
  return info;
}

// ════════════════════════════════════════════════════════════
// SERVER COMMUNICATION
// ════════════════════════════════════════════════════════════

function serverRequest(endpoint, payload, timeoutMs) {
  const serverConfig = readJSON(SERVER_FILE);
  if (!serverConfig || !serverConfig.url) {
    debugLog(`HTTP ${endpoint} ABORT no_server_config`);
    return Promise.resolve(null);
  }

  const startedAt = Date.now();
  debugLog(`HTTP ${endpoint} START url=${serverConfig.url}`);

  return new Promise((resolve) => {
    try {
      const url = new URL(endpoint, serverConfig.url);
      const body = JSON.stringify(payload);
      const client = url.protocol === "https:" ? https : http;

      const req = client.request(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serverConfig.auth_token}`,
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            const dt = Date.now() - startedAt;
            debugLog(`HTTP ${endpoint} END status=${res.statusCode} dt=${dt}ms body=${data.slice(0,300)}`);
            try {
              resolve(JSON.parse(data));
            } catch (err) {
              debugLog(`HTTP ${endpoint} JSON_PARSE_ERR ${err.message}`);
              resolve(null);
            }
          });
        },
      );

      req.on("error", (err) => {
        debugLog(`HTTP ${endpoint} ERROR ${err.code || ''} ${err.message}`);
        resolve(null);
      });
      req.setTimeout(timeoutMs || 3000, () => {
        debugLog(`HTTP ${endpoint} TIMEOUT after ${timeoutMs || 3000}ms`);
        req.destroy();
        resolve(null);
      });

      req.write(body);
      req.end();
    } catch (err) {
      debugLog(`HTTP ${endpoint} CATCH ${err.message}`);
      resolve(null);
    }
  });
}

// ════════════════════════════════════════════════════════════
// USAGE TRACKING (local fallback)
// ════════════════════════════════════════════════════════════

function loadUsage() {
  try { fs.mkdirSync(USAGE_DIR, { recursive: true }); } catch {}
  return readJSON(USAGE_FILE) || {};
}

function saveUsage(usage) {
  writeJSON(USAGE_FILE, usage);
}

function cleanupOldUsage(keepDays) {
  keepDays = keepDays || 7;
  try {
    const cutoff = Date.now() - keepDays * 86400000;
    for (const f of fs.readdirSync(USAGE_DIR)) {
      if (!f.endsWith(".json")) continue;
      const d = new Date(f.replace(".json", "") + "T00:00:00Z");
      if (!isNaN(d.getTime()) && d.getTime() < cutoff) {
        try { fs.unlinkSync(path.join(USAGE_DIR, f)); } catch {}
      }
    }
  } catch {}
}

// ════════════════════════════════════════════════════════════
// LOCAL LIMIT EVALUATION (offline fallback)
// ════════════════════════════════════════════════════════════

function evaluateLimitsLocally(config, model, usage, extra) {
  if (!config || !config.limits) return { allowed: true };

  const limits = config.limits;
  const creditWeights = config.credit_weights || { fable: 15, opus: 10, sonnet: 3, haiku: 1 };
  const effortLevel = extra && extra.effort_level;
  const isSubagent = extra && extra.is_subagent;

  // Check kill/pause status
  if (config.status === "killed" || config.status === "paused") {
    return {
      allowed: false,
      reason: config.status === "killed"
        ? "Tu acceso a Claude Code fue revocado por el admin.\nContactá al admin para restaurar el acceso."
        : "Tu acceso a Claude Code fue pausado por el admin.\nContactá al admin para reanudar el acceso.",
    };
  }

  // Check workflow/subagent permission
  if (isSubagent && config.allow_workflows === false) {
    return {
      allowed: false,
      reason: "Workflows y subagentes están deshabilitados para tu cuenta.\nContactá al admin para habilitar esta funcionalidad.",
    };
  }

  // Check effort level cap
  if (effortLevel) {
    const maxEffort = config.max_effort_level || "max";
    if (maxEffort !== "max") {
      const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max"];
      const reqIdx = EFFORT_ORDER.indexOf(effortLevel);
      const maxIdx = EFFORT_ORDER.indexOf(maxEffort);
      if (reqIdx !== -1 && maxIdx !== -1 && reqIdx > maxIdx) {
        return {
          allowed: false,
          reason: `Effort level "${effortLevel}" no permitido.\nNivel máximo: "${maxEffort}".\n\nUsá /effort ${maxEffort} para cambiar el nivel.`,
        };
      }
    }
  }

  for (const rule of limits) {
    // 1. Time-of-day
    if (rule.type === "time_of_day") {
      if (rule.model && rule.model !== model) continue;
      if (rule.schedule_start && rule.schedule_end) {
        const now = new Date();
        const hhmm = String(now.getHours()).padStart(2, "0") + ":" +
                     String(now.getMinutes()).padStart(2, "0");
        if (hhmm < rule.schedule_start || hhmm >= rule.schedule_end) {
          return {
            allowed: false,
            reason: `${model} solo está disponible de ${rule.schedule_start} a ${rule.schedule_end}.\nHora actual: ${hhmm}. Probá con otro modelo.`,
          };
        }
      }
      continue;
    }

    // 2. Per-model cap
    if (rule.type === "per_model") {
      if (rule.model && rule.model !== model) continue;
      const limit = rule.value;
      if (limit < 0) continue;
      if (limit === 0) return { allowed: false, reason: `${model} está bloqueado para tu cuenta.` };
      const used = usage[rule.model || model] || 0;
      if (used >= limit) {
        return { allowed: false, reason: `Límite diario de ${model} alcanzado.\nUsaste ${used}/${limit} prompts hoy.` };
      }
    }

    // 3. Credit budget
    if (rule.type === "credits") {
      const budget = rule.value;
      if (budget < 0) continue;
      let totalCredits = 0;
      for (const [m, count] of Object.entries(usage)) {
        totalCredits += count * (creditWeights[m] || 1);
      }
      const nextCost = creditWeights[model] || 1;
      if (totalCredits + nextCost > budget) {
        return {
          allowed: false,
          reason: `Presupuesto diario de créditos agotado.\nUsaste ${totalCredits}/${budget} créditos.\nEl próximo prompt de ${model} cuesta ${nextCost} créditos.`,
        };
      }
    }
  }

  return { allowed: true };
}

// ════════════════════════════════════════════════════════════
// BUILD BLOCK MESSAGE
// ════════════════════════════════════════════════════════════

function buildBlockMessage(config, model, usage, reason) {
  const creditWeights = config.credit_weights || { fable: 15, opus: 10, sonnet: 3, haiku: 1 };
  const limits = config.limits || [];
  const lines = [reason, ""];

  // Usage summary
  const models = ["fable", "opus", "sonnet", "haiku"];
  const summaryLines = [];
  for (const m of models) {
    const used = usage[m] || 0;
    const rule = limits.find((r) => r.type === "per_model" && (r.model === m || !r.model));
    const lim = rule ? rule.value : -1;
    const limStr = lim < 0 ? "∞" : lim;
    const remaining = lim < 0 ? "∞" : Math.max(0, lim - used);
    summaryLines.push(`  ${m}: ${used}/${limStr} (${remaining} restantes)`);
  }

  if (summaryLines.length > 0) {
    lines.push("Uso de hoy:", ...summaryLines, "");
  }

  // Credit balance
  const creditRule = limits.find((r) => r.type === "credits");
  if (creditRule && creditRule.value >= 0) {
    let totalCredits = 0;
    for (const [m, count] of Object.entries(usage)) {
      totalCredits += count * (creditWeights[m] || 1);
    }
    lines.push(`Balance de créditos: ${Math.max(0, creditRule.value - totalCredits)}/${creditRule.value}`, "");
  }

  lines.push("Opciones:", "  Cambiar a otro modelo (si te queda cuota)", "  Reintentar más tarde");
  return lines.join("\n");
}

// ════════════════════════════════════════════════════════════
// ACCOUNT DETECTION — Skip limits for personal accounts
// ════════════════════════════════════════════════════════════

/**
 * Get the active Claude Code account email.
 * Runs `claude auth status --output-format json` and caches the result for 1 hour.
 * Returns null if Claude is not logged in or the command fails.
 */
const EMAIL_CACHE_FILE = path.join(USAGE_DIR, ".email-cache.json");
const EMAIL_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getActiveEmail() {
  try {
    // Check cache first
    const cached = readJSON(EMAIL_CACHE_FILE);
    if (cached && cached.email && cached.cachedAt) {
      if (Date.now() - cached.cachedAt < EMAIL_CACHE_TTL_MS) {
        debugLog(`EMAIL cache hit: ${cached.email}`);
        return cached.email;
      }
    }

    // Run claude auth status (stdio:'pipe' suppresses stderr cross-platform)
    const raw = execSync("claude auth status", {
      timeout: 5000,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

    const data = JSON.parse(raw);
    const email = (data.email || data.emailAddress || null);
    if (!email) return null;

    const normalized = email.toLowerCase();
    writeJSON(EMAIL_CACHE_FILE, { email: normalized, cachedAt: Date.now() });
    debugLog(`EMAIL resolved: ${normalized}`);
    return normalized;
  } catch {
    return null;
  }
}

/**
 * Returns true if the active account is NOT the one registered during setup.
 * When true, the hook should pass through without counting or blocking.
 */
function isPersonalAccount(config) {
  const allowedEmail = config && config.allowed_email;
  if (!allowedEmail) return false; // no email saved → apply limits normally

  const activeEmail = getActiveEmail();
  if (!activeEmail) return false; // can't determine → apply limits (safe default)

  return activeEmail !== allowedEmail.toLowerCase();
}

// ════════════════════════════════════════════════════════════
// KILL SWITCH — LOGOUT HELPER
// ════════════════════════════════════════════════════════════

function triggerLogout() {
  try {
    const { spawn } = require("child_process");
    const child = spawn("claude", ["auth", "logout"], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    debugLog("KILL triggered claude auth logout");
  } catch (err) {
    debugLog(`KILL logout error: ${err.message}`);
  }
}

// ════════════════════════════════════════════════════════════
// TOKEN PARSING — Extract usage from transcript JSONL
// ════════════════════════════════════════════════════════════

// Read the last `bytes` of a file as lines. The first line is dropped when
// the read starts mid-file, since it is almost certainly truncated.
function readTailLines(filePath, bytes) {
  const stat = fs.statSync(filePath);
  const size = Math.min(stat.size, bytes);
  const buf = Buffer.alloc(size);
  const fd = fs.openSync(filePath, "r");
  try { fs.readSync(fd, buf, 0, size, stat.size - size); } finally { fs.closeSync(fd); }
  const lines = buf.toString("utf-8").split("\n");
  if (size < stat.size) lines.shift();
  return { lines: lines.filter(Boolean), complete: size >= stat.size };
}

// A real user prompt (not a tool_result, meta message or subagent entry).
function isHumanPrompt(entry) {
  return entry.type === "user" && !entry.toolUseResult && !entry.isSidechain && !entry.isMeta;
}

// Add one assistant entry's usage to `acc`. Claude Code writes one line per
// content block, all repeating the same message.id and usage — count once.
function addUsage(acc, entry) {
  const msg = entry.message;
  if (!msg || !msg.usage) return;
  const id = msg.id || entry.uuid;
  if (acc.seen.has(id)) return;
  acc.seen.add(id);
  const u = msg.usage;
  acc.input += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  acc.cacheRead += u.cache_read_input_tokens || 0;
  acc.output += u.output_tokens || 0;
  acc.found = true;
}

// When a session is continued into a new one, Claude Code appends a
// `continued-in` entry to the old transcript but keeps handing the old path to
// hooks, while new turns are written to <continuedInSessionId>.jsonl. Follow
// the chain so the parser reads the file that actually has the turn.
function resolveContinuedTranscript(transcriptPath) {
  for (let hops = 0; hops < 5; hops++) {
    let next = null;
    try {
      const { lines } = readTailLines(transcriptPath, 64 << 10);
      for (let i = lines.length - 1; i >= 0 && !next; i--) {
        let entry;
        try { entry = JSON.parse(lines[i]); } catch { continue; }
        if (entry.type === "continued-in" && entry.continuedInSessionId) {
          next = path.join(path.dirname(transcriptPath), `${entry.continuedInSessionId}.jsonl`);
        }
      }
    } catch { break; }
    if (!next || !fs.existsSync(next)) break;
    debugLog(`TRANSCRIPT continued-in ${path.basename(transcriptPath)} → ${path.basename(next)}`);
    transcriptPath = next;
  }
  return transcriptPath;
}

/**
 * Token usage for the turn that just finished: every assistant message after
 * the last human prompt in the main transcript, plus subagent transcripts
 * (<session>/subagents/*.jsonl) written during the same turn.
 * Also returns the model and effort of the latest assistant message, which
 * are more reliable than settings.json (they are what actually ran).
 */
function parseTurnFromTranscript(transcriptPath) {
  const result = { input: null, output: null, cacheRead: null, model: null, effort: null, subagents: null };
  if (!transcriptPath) return result;
  transcriptPath = resolveContinuedTranscript(transcriptPath);
  const acc = { input: 0, output: 0, cacheRead: 0, seen: new Set(), found: false };
  const subagents = {};
  const subSeen = new Set();
  let promptTs = null;
  try {
    // Grow the window until the turn's prompt is found (long turns with many
    // tool calls can span several MB).
    for (const bytes of [1 << 20, 8 << 20, 32 << 20]) {
      const { lines, complete } = readTailLines(transcriptPath, bytes);
      acc.input = 0; acc.output = 0; acc.cacheRead = 0; acc.seen.clear(); acc.found = false;
      result.model = null; result.effort = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        let entry;
        try { entry = JSON.parse(lines[i]); } catch { continue; }
        if (isHumanPrompt(entry)) { promptTs = entry.timestamp || null; break; }
        if (entry.type === "assistant" && !entry.isSidechain) {
          if (!result.model && entry.message && entry.message.model) result.model = entry.message.model;
          if (!result.effort && typeof entry.effort === "string") result.effort = entry.effort;
          addUsage(acc, entry);
        }
      }
      if (promptTs || complete) break;
    }

    // Subagents run in their own transcript files.
    const subDir = path.join(transcriptPath.replace(/\.jsonl$/, ""), "subagents");
    if (promptTs && fs.existsSync(subDir)) {
      const since = Date.parse(promptTs);
      for (const name of fs.readdirSync(subDir)) {
        if (!name.endsWith(".jsonl")) continue;
        const file = path.join(subDir, name);
        if (fs.statSync(file).mtimeMs < since) continue;
        for (const line of readTailLines(file, 16 << 20).lines) {
          let entry;
          try { entry = JSON.parse(line); } catch { continue; }
          if (entry.type !== "assistant" || Date.parse(entry.timestamp) < since) continue;
          addUsage(acc, entry);
          // Subagents may run a different model than the turn (e.g. Explore on
          // haiku); keep their share per model so it isn't hidden in the total.
          const sub = entry.message && entry.message.model && entry.message.usage;
          if (sub && !subSeen.has(entry.message.id || entry.uuid)) {
            subSeen.add(entry.message.id || entry.uuid);
            const key = extractModelVersion(entry.message.model);
            const s = subagents[key] || (subagents[key] = { input: 0, output: 0, cache_read: 0 });
            s.input += (sub.input_tokens || 0) + (sub.cache_creation_input_tokens || 0);
            s.output += sub.output_tokens || 0;
            s.cache_read += sub.cache_read_input_tokens || 0;
          }
        }
      }
    }

    if (acc.found) {
      result.input = acc.input;
      result.output = acc.output;
      result.cacheRead = acc.cacheRead;
    }
    if (Object.keys(subagents).length) result.subagents = subagents;
  } catch (err) {
    debugLog(`TRANSCRIPT_PARSE error: ${err.message}`);
  }
  return result;
}

// ════════════════════════════════════════════════════════════
// ACTIONS
// ════════════════════════════════════════════════════════════

/**
 * SYNC — SessionStart hook.
 * Cache model, sync config from server.
 */
// Update managed-settings.json to enable/disable Agent View and Remote Control
// based on the server's allow_agents flag. Only writes if state actually changed.
// Also updates the watchdog backup so it doesn't revert the change.
function syncAgentSettings(allowAgents) {
  try {
    const ms = readJSON(MANAGED_SETTINGS_FILE);
    if (!ms) return;

    const shouldDisable = !allowAgents;
    const currentAgent = ms.disableAgentView !== undefined ? ms.disableAgentView : true;
    const currentRemote = ms.disableRemoteControl !== undefined ? ms.disableRemoteControl : true;

    if (currentAgent === shouldDisable && currentRemote === shouldDisable) return;

    ms.disableAgentView = shouldDisable;
    ms.disableRemoteControl = shouldDisable;
    writeJSON(MANAGED_SETTINGS_FILE, ms);

    // Update watchdog backup to prevent revert
    const backupFile = path.join(path.dirname(LIMITER_DIR), ".backup", "managed-settings.json");
    writeJSON(backupFile, ms);

    debugLog(`SYNC_AGENTS updated managed-settings + backup: disableAgentView=${shouldDisable} disableRemoteControl=${shouldDisable}`);
  } catch (err) {
    debugLog(`SYNC_AGENTS error: ${err.message}`);
  }
}

/**
 * SHA-256 of the local managed-settings.json file. Used by the server to
 * detect local tampering: if this hash differs from the one the server saw
 * the first time, somebody modified managed-settings.json out from under
 * the watchdog. Returns null if the file is missing or unreadable — server
 * treats null as "no report" and skips the check (no false positives).
 */
function getManagedSettingsHash() {
  try {
    const buf = fs.readFileSync(MANAGED_SETTINGS_FILE);
    return crypto.createHash("sha256").update(buf).digest("hex");
  } catch {
    return null;
  }
}

async function actionSync(config) {
  const stdinData = await readStdinAsync();
  const rawModel = detectModelRaw(stdinData, config);
  const model = normalizeModel(rawModel);
  const modelVersion = extractModelVersion(rawModel);
  writeText(MODEL_FILE, rawModel);
  debugLog(`SYNC model=${model} version=${modelVersion} source=${stdinData.source || "unknown"}`);

  const deviceInfo = getDeviceInfo(stdinData);
  const managedSettingsHash = getManagedSettingsHash();

  const serverResp = await serverRequest("/api/v1/sync", {
    model,
    model_version: modelVersion,
    hostname: deviceInfo.hostname,
    platform: deviceInfo.platform,
    arch: deviceInfo.arch,
    os_version: deviceInfo.os_version,
    node_version: deviceInfo.node_version,
    claude_version: deviceInfo.claude_version,
    session_id: stdinData.session_id || null,
    managed_settings_hash: managedSettingsHash,
  }, 8000);

  if (serverResp) {
    writeJSON(CACHE_FILE, serverResp);
    if (serverResp.limits) {
      const updated = { ...config, limits: serverResp.limits };
      if (serverResp.credit_weights) updated.credit_weights = serverResp.credit_weights;
      if (serverResp.effort_multipliers) updated.effort_multipliers = serverResp.effort_multipliers;
      if (serverResp.status) updated.status = serverResp.status;
      if (serverResp.user_name) updated.user_name = serverResp.user_name;
      if (serverResp.allow_workflows !== undefined) updated.allow_workflows = serverResp.allow_workflows;
      if (serverResp.max_effort_level) updated.max_effort_level = serverResp.max_effort_level;
      writeJSON(CONFIG_FILE, updated);
    }
    syncAgentSettings(serverResp.allow_agents);
    debugLog(`SYNC server_response status=${serverResp.status} allow_agents=${serverResp.allow_agents} allow_workflows=${serverResp.allow_workflows} max_effort=${serverResp.max_effort_level}`);
  }
}

/**
 * Per-user policy set by the admin (workflows toggle, effort cap).
 * Read from usage/.cache.json — the last /sync or /check response — because
 * config.json is admin/root-owned and read-only for the user the hook runs
 * as, so sync cannot persist these fields there. config.json is only the
 * fallback for a cache written by an older server.
 */
function serverPolicy(config) {
  const cached = readJSON(CACHE_FILE) || {};
  const pick = (key) => (cached[key] !== undefined ? cached[key] : config && config[key]);
  return {
    allowWorkflows: pick("allow_workflows"),
    maxEffort: pick("max_effort_level") || "max",
  };
}

/**
 * CHECK — UserPromptSubmit hook.
 * Gate: block prompt if over limit.
 */
async function actionCheck(config) {
  const stdinData = await readStdinAsync();

  if (isPersonalAccount(config)) {
    debugLog("CHECK bypassed — personal account");
    return; // no output = allow
  }

  const rawModel = detectModelRaw(stdinData, config);
  const model = normalizeModel(rawModel);
  const modelVersion = extractModelVersion(rawModel);
  const effortLevel = (stdinData.effort && stdinData.effort.level) || null;
  const agentId = stdinData.agent_id || null;
  const agentType = stdinData.agent_type || null;
  const usage = loadUsage();
  debugLog(`CHECK model=${model} version=${modelVersion} effort=${effortLevel} agent=${agentType || "none"} usage=${JSON.stringify(usage)}`);

  const policy = serverPolicy(config);

  // Block workflows/subagents if not allowed
  if (agentId && policy.allowWorkflows === false) {
    const msg = "Workflows y subagentes están deshabilitados para tu cuenta.\nContactá al admin para habilitar esta funcionalidad.";
    process.stdout.write(JSON.stringify({ decision: "block", reason: msg }));
    debugLog(`CHECK BLOCKED: workflows disabled, agent_type=${agentType}`);
    return;
  }

  // Block effort level if over cap
  const maxEffort = policy.maxEffort;
  if (effortLevel && maxEffort !== "max") {
    const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max"];
    const reqIdx = EFFORT_ORDER.indexOf(effortLevel);
    const maxIdx = EFFORT_ORDER.indexOf(maxEffort);
    if (reqIdx !== -1 && maxIdx !== -1 && reqIdx > maxIdx) {
      const msg = `Effort level "${effortLevel}" no permitido.\nNivel máximo: "${maxEffort}".\n\nUsá /effort ${maxEffort} para cambiar el nivel.`;
      process.stdout.write(JSON.stringify({ decision: "block", reason: msg }));
      debugLog(`CHECK BLOCKED: effort ${effortLevel} > max ${maxEffort}`);
      return;
    }
  }

  const serverResp = await serverRequest("/api/v1/check", {
    model,
    model_version: modelVersion,
    effort_level: effortLevel,
    agent_id: agentId,
    agent_type: agentType,
    local_usage: usage,
    prompt_length: (stdinData.prompt || "").length,
    project_dir: path.basename(stdinData.cwd || ""),
    session_id: stdinData.session_id || null,
  }, 3000);

  let allowed, reason;

  if (serverResp) {
    writeJSON(CACHE_FILE, serverResp);
    if (serverResp.limits) {
      const updated = { ...config, limits: serverResp.limits, status: serverResp.status };
      if (serverResp.credit_weights) updated.credit_weights = serverResp.credit_weights;
      writeJSON(CONFIG_FILE, updated);
    }
    allowed = serverResp.allowed;
    reason = serverResp.reason;

    if (serverResp.status === "killed") {
      allowed = false;
      reason = "Tu acceso a Claude Code fue revocado por el admin.\nContactá al admin para restaurar el acceso.";
      triggerLogout();
    } else if (serverResp.status === "paused") {
      allowed = false;
      reason = "Tu acceso a Claude Code fue pausado por el admin.\nContactá al admin para reanudar el acceso.";
    }
    // If status is "active", allowed stays as the server said (based on limits)
  } else {
    // Offline: evaluate locally
    const cached = readJSON(CACHE_FILE);
    const evalConfig = cached || config;
    const result = evaluateLimitsLocally(evalConfig, model, usage, {
      effort_level: effortLevel,
      is_subagent: !!agentId,
    });
    allowed = result.allowed;
    reason = result.reason;
    debugLog("CHECK offline_mode");
  }

  if (!allowed) {
    const fullMessage = buildBlockMessage(config, model, usage, reason);
    process.stdout.write(JSON.stringify({ decision: "block", reason: fullMessage }));
    debugLog(`CHECK BLOCKED: ${reason}`);
  }
}

/**
 * COUNT — Stop hook.
 * Increment counter, report to server.
 */
async function actionCount(config) {
  const stdinData = await readStdinAsync();

  if (isPersonalAccount(config)) {
    debugLog("COUNT bypassed — personal account");
    return;
  }

  // The transcript records the model and effort that actually answered this
  // turn; prefer it over settings-based detection.
  // Stop can fire before Claude Code flushes the final assistant line, so a
  // short text-only turn may not be in the file yet. Retry briefly when we know
  // there was an answer, bounded by process uptime so the server report still
  // fits in the hook's 5s timeout.
  let turn = parseTurnFromTranscript(stdinData.transcript_path);
  if (stdinData.transcript_path && stdinData.last_assistant_message) {
    while (!turn.model && process.uptime() < 1.5) {
      await new Promise((r) => setTimeout(r, 150));
      turn = parseTurnFromTranscript(stdinData.transcript_path);
    }
    if (!turn.model) debugLog("COUNT transcript had no assistant entry after retries");
  }
  const rawModel = turn.model || detectModelRaw(stdinData, config);
  const model = normalizeModel(rawModel);
  const modelVersion = extractModelVersion(rawModel);
  const effortLevel = (stdinData.effort && stdinData.effort.level) || turn.effort || null;
  const agentId = stdinData.agent_id || null;
  const agentType = stdinData.agent_type || null;
  const usage = loadUsage();
  const prev = usage[model] || 0;
  usage[model] = prev + 1;
  saveUsage(usage);
  cleanupOldUsage();

  debugLog(`COUNT model=${model} version=${modelVersion} effort=${effortLevel} agent=${agentType || "none"} tokens=in:${turn.input} out:${turn.output} cache_read:${turn.cacheRead} ${prev} → ${prev + 1}`);

  await serverRequest("/api/v1/count", {
    model,
    model_version: modelVersion,
    effort_level: effortLevel,
    agent_id: agentId,
    agent_type: agentType,
    input_tokens: turn.input,
    output_tokens: turn.output,
    cache_read_tokens: turn.cacheRead,
    subagent_tokens: turn.subagents,
    timestamp: new Date().toISOString(),
    session_id: stdinData.session_id || null,
    response_length: (stdinData.last_assistant_message || "").length,
  }, 3000);
}

/**
 * ENFORCE — PreToolUse hook.
 * Local kill/pause check. If killed/paused, does a quick server check
 * to see if the admin reinstated — prevents permanent lockout.
 */
async function actionEnforce() {
  const stdinData = await readStdinAsync();
  const config = readJSON(CONFIG_FILE);

  if (isPersonalAccount(config)) {
    debugLog("ENFORCE bypassed — personal account");
    return; // no output = allow
  }

  const policy = serverPolicy(config);

  // Block workflow/subagent tool calls if not allowed. Only on an explicit
  // false from the server: right after setup there is no cached response yet.
  const toolName = stdinData.tool_name || "";
  if ((toolName === "Workflow" || toolName === "Agent") && policy.allowWorkflows === false) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Workflows y subagentes están deshabilitados para tu cuenta.\nContactá al admin para habilitar esta funcionalidad.",
      },
    }));
    debugLog(`ENFORCE BLOCKED: workflow tool ${toolName} denied`);
    return;
  }

  // Block effort level over cap
  const effortLevel = (stdinData.effort && stdinData.effort.level) || null;
  const maxEffort = policy.maxEffort;
  if (effortLevel && maxEffort !== "max") {
    const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max"];
    const reqIdx = EFFORT_ORDER.indexOf(effortLevel);
    const maxIdx = EFFORT_ORDER.indexOf(maxEffort);
    if (reqIdx !== -1 && maxIdx !== -1 && reqIdx > maxIdx) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `Effort level "${effortLevel}" no permitido. Nivel máximo: "${maxEffort}". Usá /effort ${maxEffort} para cambiar el nivel.`,
        },
      }));
      debugLog(`ENFORCE BLOCKED: effort ${effortLevel} > max ${maxEffort}`);
      return;
    }
  }

  const cached = readJSON(CACHE_FILE);
  const status = (cached && cached.status) || "active";

  if (status === "killed" || status === "paused") {
    // Re-check with server — admin may have reinstated
    const serverResp = await serverRequest("/api/v1/check", {
      model: "default",
      local_usage: {},
    }, 2000);

    if (serverResp && serverResp.status === "active") {
      // Reinstated! Update local cache and allow
      writeJSON(CACHE_FILE, serverResp);
      debugLog(`ENFORCE reinstated — server says active`);
      return; // no output = allow
    }

    // Still killed/paused
    const currentStatus = (serverResp && serverResp.status) || status;
    const msg = currentStatus === "killed"
      ? "Tu acceso a Claude Code fue revocado por el admin.\nContactá al admin para restaurar el acceso."
      : "Tu acceso a Claude Code fue pausado por el admin.\nContactá al admin para reanudar el acceso.";
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: msg,
      },
    }));
    return;
  }
  // Active — no output = allow
}

/**
 * STATUS — Terminal command for humans.
 */
function actionStatus(config) {
  const model = detectModel({}, config);
  const usage = loadUsage();
  const userName = config.user_name || "Unknown";
  const serverConfig = readJSON(SERVER_FILE);

  console.log("");
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║     Limitador de Claude Code — Estado         ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log("");
  console.log(`  Usuario:       ${userName}`);
  console.log(`  Fecha:         ${TODAY}`);
  console.log(`  Modelo activo: ${model}`);
  console.log(`  Config:        ${CONFIG_FILE}`);
  if (serverConfig && serverConfig.url) console.log(`  Servidor:      ${serverConfig.url}`);
  console.log("");

  const limits = (config && config.limits) || [];
  const creditWeights = (config && config.credit_weights) || { fable: 15, opus: 10, sonnet: 3, haiku: 1 };

  if (limits.length === 0) {
    console.log("  Sin límites configurados — modo ilimitado\n");
    return;
  }

  console.log("  ┌────────────┬───────┬───────┬──────────────────────┬──────────┐");
  console.log("  │ Modelo     │ Uso   │ Tope  │ Progreso             │ Restan   │");
  console.log("  ├────────────┼───────┼───────┼──────────────────────┼──────────┤");

  for (const m of ["fable", "opus", "sonnet", "haiku"]) {
    const used = usage[m] || 0;
    const rule = limits.find((r) => r.type === "per_model" && (r.model === m || !r.model));
    const limit = rule ? rule.value : -1;
    let limitStr, bar, leftStr;
    if (limit < 0) {
      limitStr = "  ∞  "; bar = "  ∞ unlimited     "; leftStr = "   ∞    ";
    } else {
      const remaining = Math.max(0, limit - used);
      limitStr = String(limit).padStart(3) + "  ";
      leftStr = String(remaining).padStart(4) + "    ";
      const total = 18;
      const filled = limit > 0 ? Math.min(total, Math.round((used / limit) * total)) : 0;
      bar = "█".repeat(filled) + "░".repeat(total - filled);
    }
    console.log(`  │ ${m.padEnd(10)} │ ${String(used).padStart(3)}   │ ${limitStr} │ ${bar} │ ${leftStr} │`);
  }

  console.log("  └────────────┴───────┴───────┴──────────────────────┴──────────┘");

  const creditRule = limits.find((r) => r.type === "credits");
  if (creditRule && creditRule.value >= 0) {
    let totalCredits = 0;
    for (const [m, count] of Object.entries(usage)) {
      totalCredits += count * (creditWeights[m] || 1);
    }
    console.log(`\n  Créditos: ${Math.max(0, creditRule.value - totalCredits)}/${creditRule.value} restantes`);
  }
  console.log("");
}

// ════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════

async function main() {
  const action = process.argv[2] || "check";
  bootLog(`ENTER action=${action} argv=${JSON.stringify(process.argv)} cwd=${process.cwd()}`);
  const config = readJSON(CONFIG_FILE);
  _debugEnabled = !!(config && config.debug);
  bootLog(`config_loaded=${!!config} debug=${_debugEnabled}`);

  if (!config || Object.keys(config).length === 0) {
    if (action === "status") {
      console.log("\n  No se encontró configuración del limitador — modo ilimitado.");
      console.log(`  Ruta de config: ${CONFIG_FILE}\n`);
      return;
    }
    if (action !== "status") {
      // Fail-closed if server.json exists (limiter installed but config deleted)
      const serverConfig = readJSON(SERVER_FILE);
      if (serverConfig && serverConfig.url) {
        if (action === "check") {
          readStdin();
          process.stdout.write(JSON.stringify({ decision: "block", reason: "Falta configuración del limitador. Contactá a tu admin." }));
        } else if (action === "enforce") {
          readStdin();
          process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Falta configuración del limitador. Contactá a tu admin." } }));
        } else {
          readStdin();
        }
        return;
      }
      // No server.json — limiter not installed, allow
      readStdin();
    }
    return;
  }

  switch (action) {
    case "sync": await actionSync(config); break;
    case "check": await actionCheck(config); break;
    case "count": await actionCount(config); break;
    case "enforce": await actionEnforce(); break;
    case "status": actionStatus(config); break;
    default:
      process.stderr.write(`claude-code-limiter hook: unknown action "${action}"\n`);
      process.exit(1);
  }
}

try {
  main().catch((err) => {
    try { fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ASYNC_ERROR: ${err.stack || err.message}\n`); } catch {}
  });
} catch (err) {
  try { fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] FATAL: ${err.stack || err.message}\n`); } catch {}
}
