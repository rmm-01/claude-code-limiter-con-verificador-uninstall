'use strict';

/**
 * /install/*
 * Endpoints that serve installer/updater scripts for client machines.
 *
 * These are reached by the user with a one-shot URL of the form
 *   https://<server>/install/update.ps1?token=<user.auth_token>
 * and return a tailored PowerShell script that does the uninstall + setup
 * with the user's own install code embedded. No admin password is exposed
 * in the script: the server grants a 5-minute pending-uninstall window in
 * the DB instead, which is honored by /api/v1/uninstall-check.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');

const router = express.Router();

const REPO_URL = process.env.CLM_REPO_URL
  || 'https://github.com/rmm-01/claude-code-limiter-con-verificador-uninstall.git';

const PENDING_UNINSTALL_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Resolve the server URL from the request (used so the script doesn't need
 * the server URL hardcoded).
 */
function resolveServerUrl(req) {
  if (process.env.CLM_SERVER_URL) return process.env.CLM_SERVER_URL;
  // Trust X-Forwarded-Proto / Host when behind Azure App Service / proxy.
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

/**
 * Escape a value so it's safe to embed inside a single-quoted PowerShell
 * string literal. Single quotes are doubled per PS rules.
 */
function psQuote(value) {
  return String(value).replace(/'/g, "''");
}

/**
 * GET /install/cli-bundle?code=<install code>
 * The installer files (packages/cli/src) for the updater, so the client needs
 * neither git nor access to the (private) GitHub repo. Gated by the unused
 * install code the updater script was rendered with.
 */
router.get('/cli-bundle', (req, res) => {
  const code = String((req.query && req.query.code) || '');
  const ok = code && db.getDb().prepare('SELECT 1 FROM install_code WHERE code = ? AND used = 0').get(code);
  if (!ok) return res.status(403).json({ error: 'Código inválido o ya usado' });
  const dir = path.join(__dirname, '..', '..', '..', '..', 'cli', 'src');
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Instalador no disponible en este servidor' });
  const files = fs.readdirSync(dir).filter((n) => n.endsWith('.js')).map((n) => ({
    path: `packages/cli/src/${n}`,
    content: fs.readFileSync(path.join(dir, n)).toString('base64'),
  }));
  res.set('Cache-Control', 'no-store').json({ files });
});

/**
 * GET /install/update.ps1?token=<auth_token>
 *
 * Steps performed by the server:
 *   1. Look up the user by auth_token.
 *   2. Grant a 5-minute pending-uninstall window in the DB so the
 *      subsequent `installer.js uninstall` call passes the server check
 *      without exposing the admin password.
 *   3. Create a fresh single-use install code for the upcoming setup.
 *   4. Render and serve a PowerShell script tailored for this user.
 */
router.get('/update.ps1', (req, res) => {
  const token = (req.query && req.query.token) || '';
  const link = (req.query && req.query.link) || '';
  if (!token && !link) {
    res.status(400).type('text/plain').send('# Falta el query string ?link=<link>\nWrite-Host "ERROR: este URL necesita ?link=<link>" -ForegroundColor Red\nexit 1\n');
    return;
  }

  let user;
  if (link) {
    // Expiring single-use link generated from the dashboard.
    const linkUserId = db.consumeUpdateLink(String(link));
    if (!linkUserId) {
      res.status(410).type('text/plain').send('# Link vencido o ya usado\nWrite-Host "ERROR: el link venció o ya fue usado. Pedile al admin que lo renueve." -ForegroundColor Red\nexit 1\n');
      return;
    }
    user = db.getUser(linkUserId);
  } else {
    // Legacy: permanent auth_token in the URL (kept so existing commands keep working).
    user = db.getUserByToken(token);
  }
  if (!user) {
    res.status(404).type('text/plain').send('# Token desconocido\nWrite-Host "ERROR: token no reconocido por el server. Pedile al admin un link nuevo." -ForegroundColor Red\nexit 1\n');
    return;
  }

  if (user.status === 'killed') {
    res.status(403).type('text/plain').send('# Usuario revocado\nWrite-Host "ERROR: tu acceso fue revocado. Contactá al admin." -ForegroundColor Red\nexit 1\n');
    return;
  }

  try {
    // 1) Open the 5-minute pending-uninstall window
    const expiresAt = new Date(Date.now() + PENDING_UNINSTALL_TTL_MS).toISOString();
    db.updateUser(user.id, { pending_uninstall_expires_at: expiresAt });

    // 2) Invalidate any old unused codes, then create a fresh one for the setup step
    db.invalidateUnusedInstallCodes(user.id);
    const installCode = db.createInstallCode(user.id);

    const serverUrl = resolveServerUrl(req);

    // 3) Render the PowerShell script
    const script = renderUpdateScript({
      userName: user.name,
      installCode,
      serverUrl,
      repoUrl: REPO_URL,
    });

    res.status(200)
      .type('text/plain; charset=utf-8')
      .set('Cache-Control', 'no-store')
      .send(script);
  } catch (err) {
    console.error('update.ps1 generation failed:', err);
    res.status(500).type('text/plain').send(`# Server error generating script\nWrite-Host "ERROR: ${psQuote(err.message || 'unknown')}" -ForegroundColor Red\nexit 1\n`);
  }
});

function renderUpdateScript({ userName, installCode, serverUrl, repoUrl }) {
  // Variables embedded into the script. Single-quoted PowerShell literals;
  // doubled single quotes inside via psQuote.
  return `# ─────────────────────────────────────────────────────────────
# claude-code-limiter — auto-update script
# Generated by server for user: ${psQuote(userName)}
# This script is a one-shot. The server granted a 5-minute window
# to uninstall without admin password; after that it will refuse
# again until a new link is generated.
# ─────────────────────────────────────────────────────────────

$ErrorActionPreference = 'Stop'

# Require admin
$current = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($current)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host '[X] Este script necesita PowerShell como Administrador.' -ForegroundColor Red
  Write-Host '    Cerrá esta ventana y reabrí PowerShell con clic derecho -> Ejecutar como administrador.' -ForegroundColor Yellow
  return
}

Write-Host ''
Write-Host '======================================================' -ForegroundColor Cyan
Write-Host 'claude-code-limiter — actualizando para ${psQuote(userName)}' -ForegroundColor Cyan
Write-Host '======================================================' -ForegroundColor Cyan
Write-Host ''

$installCode = '${psQuote(installCode)}'
$serverUrl   = '${psQuote(serverUrl)}'

# Working directory: a fresh temp folder filled with the installer files the
# server hands out (no GitHub or git needed; the repo may be private).
$workDir = Join-Path $env:TEMP ('clm-update-' + [guid]::NewGuid().ToString('N').Substring(0,8))
Write-Host ('[1/4] Descargando instalador en ' + $workDir)
try {
  $bundle = Invoke-RestMethod -Uri ($serverUrl.TrimEnd('/') + '/install/cli-bundle?code=' + $installCode) -UseBasicParsing
  foreach ($f in $bundle.files) {
    $dest = Join-Path $workDir ($f.path -replace '/', '\\')
    New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
    [IO.File]::WriteAllBytes($dest, [Convert]::FromBase64String($f.content))
  }
  if (-not (Test-Path (Join-Path $workDir 'packages\\cli\\src\\installer.js'))) { throw 'el servidor no entregó installer.js' }
} catch {
  Write-Host ('[X] No se pudo descargar el instalador del servidor: ' + $_.Exception.Message) -ForegroundColor Red
  return
}

Push-Location $workDir
try {
  # Uninstall the existing install. The server already opened a 5-minute
  # pending-uninstall window for this auth_token, so the GET /uninstall-check
  # succeeds without needing --force / --password.
  Write-Host ''
  Write-Host '[2/4] Desinstalando versión actual'
  node packages\\cli\\src\\installer.js uninstall --yes
  if ($LASTEXITCODE -ne 0) {
    Write-Host '[!] uninstall salió con código no cero. Continuando igual para reintentar setup.' -ForegroundColor Yellow
  }

  # Install the fresh code
  Write-Host ''
  Write-Host '[3/4] Instalando versión nueva'
  node packages\\cli\\src\\installer.js setup --code $installCode --server $serverUrl --yes
  if ($LASTEXITCODE -ne 0) {
    Write-Host '[X] setup falló. Revisá el output de arriba.' -ForegroundColor Red
    return
  }

  Write-Host ''
  Write-Host '[4/4] OK' -ForegroundColor Green
  Write-Host ''
  Write-Host 'Actualización completa. Reiniciá Claude Code (cerralo y abrilo de nuevo)' -ForegroundColor Green
  Write-Host 'para que los managed-settings nuevos tomen efecto.' -ForegroundColor Green
}
finally {
  Pop-Location
  # Limpiamos el clon temporal — el limiter ya quedó instalado bajo Program Files.
  try { Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue } catch {}
}
`;
}

module.exports = router;
module.exports.resolveServerUrl = resolveServerUrl;
