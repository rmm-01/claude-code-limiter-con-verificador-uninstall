#!/usr/bin/env node

/**
 * claude-code-limiter — Repo-level Hook (Stateless)
 * ===================================================
 * Lightweight, stateless hook designed to live inside a repo's
 * .claude/hooks/ directory. Works in both local and cloud (claude.ai/code)
 * sessions because repo-level hooks fire everywhere.
 *
 * Configuration priority:
 *   1. Environment variables: CLAUDE_LIMITER_URL, CLAUDE_LIMITER_TOKEN
 *   2. .claude/limiter.json in repo root (committed or gitignored)
 *   3. Local system config (only on local machines where hook.js is installed)
 *
 * Invoked via .claude/settings.json hooks:
 *   node .claude/hooks/limiter-hook.js check    → UserPromptSubmit
 *   node .claude/hooks/limiter-hook.js count    → Stop
 *   node .claude/hooks/limiter-hook.js enforce  → PreToolUse
 */

"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max"];

function readJSON(filepath) {
  try {
    return JSON.parse(fs.readFileSync(filepath, "utf-8"));
  } catch {
    return null;
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

function resolveConfig() {
  const url = process.env.CLAUDE_LIMITER_URL;
  const token = process.env.CLAUDE_LIMITER_TOKEN;
  if (url && token) return { url, auth_token: token };

  const repoRoot = findRepoRoot();
  if (repoRoot) {
    const cfg = readJSON(path.join(repoRoot, ".claude", "limiter.json"));
    if (cfg && cfg.url && cfg.auth_token) return cfg;
  }

  const IS_WIN = process.platform === "win32";
  const IS_MAC = process.platform === "darwin";
  const sysDir = IS_WIN
    ? path.join("C:", "Program Files", "ClaudeCode", "limiter")
    : IS_MAC
      ? path.join("/Library", "Application Support", "ClaudeCode", "limiter")
      : path.join("/etc", "claude-code", "limiter");
  const serverJson = readJSON(path.join(sysDir, "server.json"));
  if (serverJson && serverJson.url && serverJson.auth_token) return serverJson;

  return null;
}

function findRepoRoot() {
  let dir = process.cwd();
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, ".claude"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function normalizeModel(raw) {
  const lower = String(raw || "").toLowerCase();
  if (lower.includes("fable")) return "fable";
  if (lower.includes("opus")) return "opus";
  if (lower.includes("sonnet")) return "sonnet";
  if (lower.includes("haiku")) return "haiku";
  return "default";
}

function extractModelVersion(raw) {
  const lower = String(raw || "").toLowerCase().trim();
  const match = lower.match(/(fable|opus|sonnet|haiku)[- ](\d[\d.-]*\d)/);
  if (match) return match[1] + "-" + match[2].replace(/\./g, "-");
  return normalizeModel(raw);
}

function serverRequest(config, endpoint, payload, timeoutMs) {
  return new Promise((resolve) => {
    try {
      const url = new URL(endpoint, config.url);
      const body = JSON.stringify(payload);
      const client = url.protocol === "https:" ? https : http;

      const req = client.request(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${config.auth_token}`,
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try { resolve(JSON.parse(data)); } catch { resolve(null); }
          });
        },
      );

      req.on("error", () => resolve(null));
      req.setTimeout(timeoutMs || 3000, () => { req.destroy(); resolve(null); });
      req.write(body);
      req.end();
    } catch {
      resolve(null);
    }
  });
}

function parseTokensFromTranscript(transcriptPath) {
  const result = { input: null, output: null };
  if (!transcriptPath) return result;
  try {
    const stat = fs.statSync(transcriptPath);
    const bufSize = Math.min(stat.size, 8192);
    const buf = Buffer.alloc(bufSize);
    const fd = fs.openSync(transcriptPath, "r");
    fs.readSync(fd, buf, 0, bufSize, stat.size - bufSize);
    fs.closeSync(fd);
    const tail = buf.toString("utf-8");
    const lines = tail.split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        const usage = entry.usage || (entry.message && entry.message.usage);
        if (usage && (usage.input_tokens || usage.output_tokens)) {
          result.input = usage.input_tokens || 0;
          result.output = usage.output_tokens || 0;
          break;
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return result;
}

// ────────────────────────────────────────────────
// ACTIONS
// ────────────────────────────────────────────────

async function actionCheck(serverCfg, stdinData) {
  const rawModel = stdinData.model || "default";
  const model = normalizeModel(rawModel);
  const modelVersion = extractModelVersion(rawModel);
  const effortLevel = (stdinData.effort && stdinData.effort.level) || null;
  const agentId = stdinData.agent_id || null;
  const agentType = stdinData.agent_type || null;

  const resp = await serverRequest(serverCfg, "/api/v1/check", {
    model,
    model_version: modelVersion,
    effort_level: effortLevel,
    agent_id: agentId,
    agent_type: agentType,
    local_usage: {},
    prompt_length: (stdinData.prompt || "").length,
    project_dir: path.basename(stdinData.cwd || process.cwd()),
    session_id: stdinData.session_id || null,
    source: "repo-hook",
  }, 3000);

  if (!resp) return;

  if (!resp.allowed) {
    process.stdout.write(JSON.stringify({
      decision: "block",
      reason: resp.reason || "Bloqueado por el limitador.",
    }));
  }
}

async function actionCount(serverCfg, stdinData) {
  const rawModel = stdinData.model || "default";
  const model = normalizeModel(rawModel);
  const modelVersion = extractModelVersion(rawModel);
  const effortLevel = (stdinData.effort && stdinData.effort.level) || null;
  const agentId = stdinData.agent_id || null;
  const agentType = stdinData.agent_type || null;
  const tokens = parseTokensFromTranscript(stdinData.transcript_path);

  await serverRequest(serverCfg, "/api/v1/count", {
    model,
    model_version: modelVersion,
    effort_level: effortLevel,
    agent_id: agentId,
    agent_type: agentType,
    input_tokens: tokens.input,
    output_tokens: tokens.output,
    timestamp: new Date().toISOString(),
    session_id: stdinData.session_id || null,
    response_length: (stdinData.last_assistant_message || "").length,
    source: "repo-hook",
  }, 3000);
}

async function actionEnforce(serverCfg, stdinData) {
  const toolName = stdinData.tool_name || "";
  const effortLevel = (stdinData.effort && stdinData.effort.level) || null;

  const resp = await serverRequest(serverCfg, "/api/v1/check", {
    model: normalizeModel(stdinData.model || "default"),
    local_usage: {},
    effort_level: effortLevel,
    agent_id: stdinData.agent_id || null,
    agent_type: stdinData.agent_type || null,
    tool_name: toolName,
    source: "repo-hook-enforce",
  }, 2000);

  if (!resp) return;

  const blocked = !resp.allowed;
  const wfBlocked = (toolName === "Workflow" || toolName === "Agent") && resp.allow_workflows === false;
  const effortBlocked = effortLevel && resp.max_effort_level && resp.max_effort_level !== "max" && (function() {
    const reqIdx = EFFORT_ORDER.indexOf(effortLevel);
    const maxIdx = EFFORT_ORDER.indexOf(resp.max_effort_level);
    return reqIdx !== -1 && maxIdx !== -1 && reqIdx > maxIdx;
  })();

  if (blocked || wfBlocked || effortBlocked) {
    let reason = resp.reason || "Bloqueado por el limitador.";
    if (wfBlocked) reason = "Workflows y subagentes están deshabilitados para tu cuenta.\nContactá al admin para habilitar esta funcionalidad.";
    if (effortBlocked) reason = `Effort level "${effortLevel}" no permitido. Nivel máximo: "${resp.max_effort_level}".`;

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }));
  }
}

// ────────────────────────────────────────────────
// MAIN
// ────────────────────────────────────────────────

async function main() {
  const action = process.argv[2] || "check";
  const serverCfg = resolveConfig();

  if (!serverCfg) return;

  const stdinData = await readStdinAsync();

  switch (action) {
    case "check": await actionCheck(serverCfg, stdinData); break;
    case "count": await actionCount(serverCfg, stdinData); break;
    case "enforce": await actionEnforce(serverCfg, stdinData); break;
    default: break;
  }
}

main().catch(() => {});
