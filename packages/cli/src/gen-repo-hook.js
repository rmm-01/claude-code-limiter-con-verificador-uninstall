#!/usr/bin/env node

/**
 * gen-repo-hook — Generate repo-level hooks for Claude Code web coverage
 * ======================================================================
 * Creates .claude/hooks/limiter-hook.js and updates .claude/settings.json
 * so that the limiter fires in cloud sessions (claude.ai/code) too.
 *
 * Usage:
 *   npx @howincodes/claude-code-limiter gen-repo-hook --server URL --token TOKEN
 *
 * If --server/--token are omitted, reads from the local system config.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const supportsColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  red:    (s) => supportsColor ? `\x1b[31m${s}\x1b[0m` : s,
  green:  (s) => supportsColor ? `\x1b[32m${s}\x1b[0m` : s,
  yellow: (s) => supportsColor ? `\x1b[33m${s}\x1b[0m` : s,
  cyan:   (s) => supportsColor ? `\x1b[36m${s}\x1b[0m` : s,
  bold:   (s) => supportsColor ? `\x1b[1m${s}\x1b[0m`  : s,
  dim:    (s) => supportsColor ? `\x1b[2m${s}\x1b[0m`  : s,
};

function readJSON(filepath) {
  try {
    return JSON.parse(fs.readFileSync(filepath, "utf-8"));
  } catch {
    return null;
  }
}

function die(msg) {
  console.error(c.red("Error: ") + msg);
  process.exit(1);
}

module.exports = function genRepoHook(opts) {
  const { server, token, yes } = opts || {};

  // Resolve server URL and auth token
  let serverUrl = server;
  let authToken = token;

  if (!serverUrl || !authToken) {
    const IS_WIN = process.platform === "win32";
    const IS_MAC = process.platform === "darwin";
    const sysDir = IS_WIN
      ? path.join("C:", "Program Files", "ClaudeCode", "limiter")
      : IS_MAC
        ? path.join("/Library", "Application Support", "ClaudeCode", "limiter")
        : path.join("/etc", "claude-code", "limiter");

    const serverJson = readJSON(path.join(sysDir, "server.json"));
    if (serverJson) {
      if (!serverUrl) serverUrl = serverJson.url;
      if (!authToken) authToken = serverJson.auth_token;
    }
  }

  if (!serverUrl) {
    die("No se pudo determinar la URL del servidor.\n"
      + c.dim("Usá --server <URL> o instalá primero el limiter con 'setup'."));
  }
  if (!authToken) {
    die("No se pudo determinar el token de autenticación.\n"
      + c.dim("Usá --token <TOKEN> o instalá primero el limiter con 'setup'."));
  }

  // Find repo root (look for .git)
  let repoRoot = process.cwd();
  let found = false;
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(repoRoot, ".git"))) { found = true; break; }
    const parent = path.dirname(repoRoot);
    if (parent === repoRoot) break;
    repoRoot = parent;
  }
  if (!found) {
    die("No se encontró un repositorio git. Ejecutá este comando desde dentro de un repo.");
  }

  const claudeDir = path.join(repoRoot, ".claude");
  const hooksDir = path.join(claudeDir, "hooks");
  const settingsFile = path.join(claudeDir, "settings.json");
  const configFile = path.join(claudeDir, "limiter.json");
  const hookFile = path.join(hooksDir, "limiter-hook.js");

  console.log("");
  console.log(c.bold("claude-code-limiter — Generador de hooks de repo"));
  console.log("");
  console.log(`  Repo root:  ${repoRoot}`);
  console.log(`  Servidor:   ${serverUrl}`);
  console.log(`  Token:      ${authToken.slice(0, 8)}...`);
  console.log("");

  // 1. Create .claude/hooks/ directory
  fs.mkdirSync(hooksDir, { recursive: true });

  // 2. Copy repo-hook.js as limiter-hook.js
  const hookSource = path.join(__dirname, "repo-hook.js");
  fs.copyFileSync(hookSource, hookFile);
  console.log(c.green("  ✓") + ` Creado ${path.relative(repoRoot, hookFile)}`);

  // 3. Write limiter.json config
  const limiterConfig = { url: serverUrl, auth_token: authToken };
  fs.writeFileSync(configFile, JSON.stringify(limiterConfig, null, 2));
  console.log(c.green("  ✓") + ` Creado ${path.relative(repoRoot, configFile)}`);

  // 4. Update .claude/settings.json with hooks
  let settings = readJSON(settingsFile) || {};

  const hookEntries = [
    {
      matcher: "UserPromptSubmit",
      hooks: [{ type: "command", command: "node .claude/hooks/limiter-hook.js check" }],
    },
    {
      matcher: "Stop",
      hooks: [{ type: "command", command: "node .claude/hooks/limiter-hook.js count" }],
    },
    {
      matcher: "PreToolUse",
      hooks: [{ type: "command", command: "node .claude/hooks/limiter-hook.js enforce" }],
    },
  ];

  if (!settings.hooks) settings.hooks = [];

  for (const entry of hookEntries) {
    const existing = settings.hooks.find((h) => h.matcher === entry.matcher);
    if (existing) {
      if (!existing.hooks) existing.hooks = [];
      const alreadyHas = existing.hooks.some((h) => h.command && h.command.includes("limiter-hook.js"));
      if (!alreadyHas) {
        existing.hooks.push(...entry.hooks);
      }
    } else {
      settings.hooks.push(entry);
    }
  }

  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  console.log(c.green("  ✓") + ` Actualizado ${path.relative(repoRoot, settingsFile)}`);

  // 5. Update .gitignore to exclude limiter.json (contains auth token)
  const gitignoreFile = path.join(repoRoot, ".gitignore");
  let gitignore = "";
  try { gitignore = fs.readFileSync(gitignoreFile, "utf-8"); } catch {}

  if (!gitignore.includes(".claude/limiter.json")) {
    const newLine = gitignore.endsWith("\n") ? "" : "\n";
    fs.writeFileSync(gitignoreFile, gitignore + newLine + "# Claude Code Limiter config (contains auth token)\n.claude/limiter.json\n");
    console.log(c.green("  ✓") + ` Actualizado .gitignore (excluye limiter.json)`);
  }

  console.log("");
  console.log(c.bold("  Listo!") + " Los hooks de repo están configurados.");
  console.log("");
  console.log("  " + c.cyan("Para sesiones web (claude.ai/code):"));
  console.log("    Los hooks se ejecutarán automáticamente desde .claude/settings.json");
  console.log("");
  console.log("  " + c.cyan("Alternativa con variables de entorno:"));
  console.log("    Los usuarios pueden configurar en su entorno cloud:");
  console.log(`    ${c.dim("CLAUDE_LIMITER_URL")}=${serverUrl}`);
  console.log(`    ${c.dim("CLAUDE_LIMITER_TOKEN")}=<su-token-personal>`);
  console.log("");
  console.log("  " + c.yellow("Nota:") + " .claude/limiter.json contiene el auth token y");
  console.log("    fue agregado a .gitignore. Cada usuario debe generar el suyo o");
  console.log("    usar variables de entorno.");
  console.log("");
};
