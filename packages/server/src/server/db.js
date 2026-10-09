'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

let db = null;

/**
 * Initialize the database: open/create, set up tables, indexes.
 * @param {string} [dbPath] - Optional path to the SQLite file.
 */
function init(dbPath) {
  if (db) return db;

  if (!dbPath) {
    const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
    dbPath = path.join(DATA_DIR, 'limiter.db');
  }

  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = new Database(dbPath);
  // Rollback journal, not WAL: in production the file lives on /home (Azure
  // Files / SMB) and SQLite's WAL needs shared memory that network
  // filesystems don't provide. With two containers open during a deploy,
  // WAL produced the recurring index corruption and lost schema changes.
  // DELETE mode coordinates through file locks instead.
  db.pragma('busy_timeout = 5000');
  useRollbackJournal(db);
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS team (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      admin_password  TEXT NOT NULL,
      credit_weights  TEXT NOT NULL DEFAULT '{"fable":15,"opus":10,"sonnet":3,"haiku":1}',
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user (
      id                              TEXT PRIMARY KEY,
      team_id                         TEXT NOT NULL REFERENCES team(id),
      slug                            TEXT NOT NULL,
      name                            TEXT NOT NULL,
      auth_token                      TEXT NOT NULL UNIQUE,
      status                          TEXT NOT NULL DEFAULT 'active',
      killed_at                       DATETIME,
      last_seen                       DATETIME,
      created_at                      DATETIME DEFAULT CURRENT_TIMESTAMP,
      allow_self_uninstall            INTEGER NOT NULL DEFAULT 0,
      allow_agents                    INTEGER NOT NULL DEFAULT 0,
      pending_uninstall_expires_at    DATETIME,
      expected_managed_settings_hash  TEXT,
      last_tampering_at               DATETIME,
      UNIQUE(team_id, slug)
    );

    CREATE TABLE IF NOT EXISTS limit_rule (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      type            TEXT NOT NULL,
      model           TEXT,
      window          TEXT,
      value           INTEGER,
      schedule_start  TEXT,
      schedule_end    TEXT,
      schedule_tz     TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS usage_event (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      model           TEXT NOT NULL,
      model_version   TEXT,
      credit_cost     INTEGER NOT NULL,
      timestamp       DATETIME NOT NULL,
      source          TEXT NOT NULL DEFAULT 'hook'
    );

    CREATE TABLE IF NOT EXISTS install_code (
      code        TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      used        BOOLEAN DEFAULT 0,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS device (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      hostname        TEXT,
      platform        TEXT,
      arch            TEXT,
      os_version      TEXT,
      node_version    TEXT,
      claude_version  TEXT,
      subscription_type TEXT,
      default_model   TEXT,
      first_seen      DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen       DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_ip         TEXT,
      UNIQUE(user_id, hostname)
    );

    CREATE TABLE IF NOT EXISTS session_event (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      device_id       TEXT REFERENCES device(id),
      type            TEXT NOT NULL,
      model           TEXT,
      model_version   TEXT,
      prompt_length   INTEGER,
      project_dir     TEXT,
      tools_used      INTEGER,
      session_id      TEXT,
      blocked_reason  TEXT,
      response_length INTEGER,
      timestamp       DATETIME NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_session_event_user_ts ON session_event(user_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_session_event_type ON session_event(user_id, type, timestamp);

    CREATE INDEX IF NOT EXISTS idx_usage_user_ts ON usage_event(user_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_usage_model_ts ON usage_event(user_id, model, timestamp);
    CREATE INDEX IF NOT EXISTS idx_user_auth_token ON user(auth_token);
    CREATE INDEX IF NOT EXISTS idx_user_team ON user(team_id);
    CREATE INDEX IF NOT EXISTS idx_limit_rule_user ON limit_rule(user_id);
    CREATE INDEX IF NOT EXISTS idx_install_code_user ON install_code(user_id);
    CREATE INDEX IF NOT EXISTS idx_device_user ON device(user_id);
  `);

  runMigrations(db);

  console.log(`Database initialized at ${dbPath}`);
  return db;
}

/**
 * Switch to journal_mode=DELETE. Fails with "database is locked" while
 * another process (the previous container during a deploy) still has the
 * file open in WAL mode, so it is retried later. Returns the active mode.
 */
function useRollbackJournal(database) {
  try {
    const mode = database.pragma('journal_mode = DELETE', { simple: true });
    console.log(`[db] journal_mode=${mode}`);
    return mode;
  } catch (err) {
    console.warn('[db] could not switch journal_mode to DELETE yet:', err && err.message);
    return database.pragma('journal_mode', { simple: true });
  }
}

/**
 * Additive, idempotent schema migrations. Safe to run any number of times.
 *
 * Runs at init and again from runStartupMaintenance(): on App Service the
 * previous container keeps the database open for a while after the new one
 * starts, and on 2026-09-30 its writes wiped the columns this function had
 * just added. Re-running once the old container is gone restores them.
 */
function runMigrations(db) {
  const cols = db.pragma('table_info(user)').map(c => c.name);
  if (!cols.includes('allow_self_uninstall')) {
    db.exec('ALTER TABLE user ADD COLUMN allow_self_uninstall INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('pending_uninstall_expires_at')) {
    db.exec('ALTER TABLE user ADD COLUMN pending_uninstall_expires_at DATETIME');
  }
  if (!cols.includes('expected_managed_settings_hash')) {
    db.exec('ALTER TABLE user ADD COLUMN expected_managed_settings_hash TEXT');
  }
  if (!cols.includes('last_tampering_at')) {
    db.exec('ALTER TABLE user ADD COLUMN last_tampering_at DATETIME');
  }

  // Add allow_agents to user (v1.4)
  if (!cols.includes('allow_agents')) {
    db.exec('ALTER TABLE user ADD COLUMN allow_agents INTEGER NOT NULL DEFAULT 0');
  }

  // Per-user opt-out of allowManagedHooksOnly (lets the user keep their own
  // hooks, e.g. a custom statusLine). Default 0 = hooks stay locked.
  if (!cols.includes('allow_user_hooks')) {
    db.exec('ALTER TABLE user ADD COLUMN allow_user_hooks INTEGER NOT NULL DEFAULT 0');
  }

  // Add model_version to usage_event and session_event (v1.4)
  const usageCols = db.pragma('table_info(usage_event)').map(c => c.name);
  if (!usageCols.includes('model_version')) {
    db.exec('ALTER TABLE usage_event ADD COLUMN model_version TEXT');
  }
  const sessionCols = db.pragma('table_info(session_event)').map(c => c.name);
  if (!sessionCols.includes('model_version')) {
    db.exec('ALTER TABLE session_event ADD COLUMN model_version TEXT');
  }

  // v1.5 — effort, workflows, token tracking
  if (!cols.includes('allow_workflows')) {
    db.exec('ALTER TABLE user ADD COLUMN allow_workflows INTEGER NOT NULL DEFAULT 0');
    // Users that existed before this column already had Agent/Workflow
    // available — keep it that way. New users start OFF (column default).
    db.exec('UPDATE user SET allow_workflows = 1');
  }
  if (!cols.includes('max_effort_level')) {
    db.exec("ALTER TABLE user ADD COLUMN max_effort_level TEXT DEFAULT 'max'");
  }
  if (!usageCols.includes('effort_level')) {
    db.exec('ALTER TABLE usage_event ADD COLUMN effort_level TEXT');
  }
  if (!usageCols.includes('is_subagent')) {
    db.exec('ALTER TABLE usage_event ADD COLUMN is_subagent INTEGER NOT NULL DEFAULT 0');
  }
  if (!usageCols.includes('input_tokens')) {
    db.exec('ALTER TABLE usage_event ADD COLUMN input_tokens INTEGER');
  }
  if (!usageCols.includes('output_tokens')) {
    db.exec('ALTER TABLE usage_event ADD COLUMN output_tokens INTEGER');
  }
  // Prompt-cache reads, kept apart from input_tokens: they re-read the whole
  // context on every call and would dwarf the tokens actually processed.
  if (!usageCols.includes('cache_read_tokens')) {
    db.exec('ALTER TABLE usage_event ADD COLUMN cache_read_tokens INTEGER');
  }
  // Subagent share of the turn's tokens, per model version (JSON object).
  // Already included in input/output_tokens; NULL for hooks older than 1.6.
  if (!usageCols.includes('subagent_tokens')) {
    db.exec('ALTER TABLE usage_event ADD COLUMN subagent_tokens TEXT');
  }
  if (!sessionCols.includes('effort_level')) {
    db.exec('ALTER TABLE session_event ADD COLUMN effort_level TEXT');
  }
  if (!sessionCols.includes('agent_id')) {
    db.exec('ALTER TABLE session_event ADD COLUMN agent_id TEXT');
  }
  if (!sessionCols.includes('agent_type')) {
    db.exec('ALTER TABLE session_event ADD COLUMN agent_type TEXT');
  }
  if (!sessionCols.includes('input_tokens')) {
    db.exec('ALTER TABLE session_event ADD COLUMN input_tokens INTEGER');
  }
  if (!sessionCols.includes('output_tokens')) {
    db.exec('ALTER TABLE session_event ADD COLUMN output_tokens INTEGER');
  }
  const teamCols = db.pragma('table_info(team)').map(c => c.name);
  if (!teamCols.includes('effort_multipliers')) {
    db.exec(`ALTER TABLE team ADD COLUMN effort_multipliers TEXT NOT NULL DEFAULT '{"low":0.5,"medium":1,"high":2,"xhigh":4,"max":6}'`);
  }
  // When the Claude subscription's weekly limit resets. The default keeps the
  // original behavior (Monday 00:00 UTC).
  if (!teamCols.includes('weekly_reset')) {
    db.exec(`ALTER TABLE team ADD COLUMN weekly_reset TEXT NOT NULL DEFAULT '{"day":1,"hour":0,"tz":"UTC"}'`);
  }
}

/**
 * Integrity check + self-repair, then migrations again. Called after the
 * server is listening: integrity_check has taken up to 3 minutes on the
 * production database, and running it before listen() kept the warm-up
 * probe failing — which is exactly the window where App Service keeps the
 * old container alive against the same file.
 */
function runStartupMaintenance() {
  const database = getDb();
  try {
    autoRepairIfNeeded(database);
  } catch (err) {
    console.error('[db] auto-repair failed:', err && err.message);
  }
  try {
    runMigrations(database);
  } catch (err) {
    console.error('[db] post-repair migrations failed:', err && err.message);
  }
}

/**
 * Run PRAGMA integrity_check; if SQLite reports anything other than the
 * single "ok" row, run REINDEX + VACUUM to rebuild any damaged indexes and
 * compact orphaned pages. Logs every step so it's visible in App Service
 * log stream after a restart.
 *
 * Pure recovery for the corruption pattern we've actually hit
 * ("row N missing from index ..."). For deeper corruption (malformed
 * pages, schema damage) integrity_check still reports here and an admin
 * can decide whether to restore from backup.
 */
function autoRepairIfNeeded(database) {
  const startedAt = Date.now();
  const rows = database.pragma('integrity_check');
  const messages = rows.map((r) => r.integrity_check);
  const isOk = messages.length === 1 && messages[0] === 'ok';

  if (isOk) {
    console.log(`[db] integrity check: ok (${Date.now() - startedAt}ms)`);
    return;
  }

  // Truncate the log output so a huge corruption report doesn't spam the
  // entire console — first few lines are enough to identify the pattern.
  const preview = messages.slice(0, 5).join(' | ');
  console.warn(`[db] integrity check found ${messages.length} issue(s). First: ${preview}`);
  console.warn('[db] running REINDEX + VACUUM to self-repair...');

  try {
    database.exec('REINDEX;');
    database.exec('VACUUM;');
  } catch (err) {
    console.error('[db] REINDEX/VACUUM failed:', err && err.message);
    return;
  }

  const after = database.pragma('integrity_check');
  const afterMessages = after.map((r) => r.integrity_check);
  const afterOk = afterMessages.length === 1 && afterMessages[0] === 'ok';

  if (afterOk) {
    console.log(`[db] auto-repair completed in ${Date.now() - startedAt}ms`);
  } else {
    console.error(
      `[db] auto-repair could not fully fix the database. Remaining issues: ${afterMessages.slice(0, 5).join(' | ')}`
    );
  }
}

/**
 * Seed a default team if none exists.
 * @param {string} [adminPassword] - Plain-text admin password.
 */
function seed(adminPassword) {
  const conn = getDb();
  const row = conn.prepare('SELECT COUNT(*) AS count FROM team').get();
  if (row.count > 0) return;

  const password = adminPassword || process.env.ADMIN_PASSWORD || 'changeme';
  const hash = bcrypt.hashSync(password, 10);
  const teamId = uuidv4();

  conn.prepare(
    'INSERT INTO team (id, name, admin_password, credit_weights) VALUES (?, ?, ?, ?)'
  ).run(teamId, 'Default Team', hash, JSON.stringify({ fable: 15, opus: 10, sonnet: 3, haiku: 1 }));

  console.log(`Default team created (id: ${teamId})`);
  if (password === 'changeme') {
    console.warn('WARNING: Using default admin password "changeme". Set ADMIN_PASSWORD env var for production.');
  }
}

/**
 * Get the raw database instance.
 */
function getDb() {
  if (!db) throw new Error('Database not initialized. Call init() first.');
  return db;
}

/**
 * Close the database connection.
 */
function close() {
  if (db) {
    db.close();
    db = null;
  }
}

// --------------- Team helpers ---------------

function getTeam(teamId) {
  return getDb().prepare('SELECT * FROM team WHERE id = ?').get(teamId);
}

function getDefaultTeam() {
  return getDb().prepare('SELECT * FROM team ORDER BY created_at ASC LIMIT 1').get();
}

function updateTeam(teamId, fields) {
  const sets = [];
  const values = [];
  if (fields.name !== undefined) { sets.push('name = ?'); values.push(fields.name); }
  if (fields.credit_weights !== undefined) { sets.push('credit_weights = ?'); values.push(typeof fields.credit_weights === 'string' ? fields.credit_weights : JSON.stringify(fields.credit_weights)); }
  if (fields.effort_multipliers !== undefined) { sets.push('effort_multipliers = ?'); values.push(typeof fields.effort_multipliers === 'string' ? fields.effort_multipliers : JSON.stringify(fields.effort_multipliers)); }
  if (fields.weekly_reset !== undefined) { sets.push('weekly_reset = ?'); values.push(typeof fields.weekly_reset === 'string' ? fields.weekly_reset : JSON.stringify(fields.weekly_reset)); }
  if (fields.admin_password !== undefined) { sets.push('admin_password = ?'); values.push(fields.admin_password); }
  if (sets.length === 0) return;
  values.push(teamId);
  getDb().prepare(`UPDATE team SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

// --------------- User helpers ---------------

function getUser(userId) {
  return getDb().prepare('SELECT * FROM user WHERE id = ?').get(userId);
}

function getUserByToken(authToken) {
  return getDb().prepare('SELECT * FROM user WHERE auth_token = ?').get(authToken);
}

function getUserBySlug(teamId, slug) {
  return getDb().prepare('SELECT * FROM user WHERE team_id = ? AND slug = ?').get(teamId, slug);
}

function getAllUsers(teamId) {
  return getDb().prepare('SELECT * FROM user WHERE team_id = ? ORDER BY created_at ASC').all(teamId);
}

function createUser({ teamId, slug, name }) {
  const id = uuidv4();
  const authToken = uuidv4();
  getDb().prepare(
    'INSERT INTO user (id, team_id, slug, name, auth_token) VALUES (?, ?, ?, ?, ?)'
  ).run(id, teamId, slug, name, authToken);
  return getUser(id);
}

function updateUser(userId, fields) {
  const sets = [];
  const values = [];
  if (fields.name !== undefined) { sets.push('name = ?'); values.push(fields.name); }
  if (fields.slug !== undefined) { sets.push('slug = ?'); values.push(fields.slug); }
  if (fields.status !== undefined) {
    sets.push('status = ?');
    values.push(fields.status);
    if (fields.status === 'killed') {
      sets.push('killed_at = ?');
      values.push(new Date().toISOString());
    } else if (fields.status === 'active') {
      sets.push('killed_at = NULL');
    }
  }
  if (fields.last_seen !== undefined) { sets.push('last_seen = ?'); values.push(fields.last_seen); }
  if (fields.allow_self_uninstall !== undefined) { sets.push('allow_self_uninstall = ?'); values.push(fields.allow_self_uninstall ? 1 : 0); }
  if (fields.allow_agents !== undefined) { sets.push('allow_agents = ?'); values.push(fields.allow_agents ? 1 : 0); }
  if (fields.allow_user_hooks !== undefined) { sets.push('allow_user_hooks = ?'); values.push(fields.allow_user_hooks ? 1 : 0); }
  if (fields.pending_uninstall_expires_at !== undefined) {
    sets.push('pending_uninstall_expires_at = ?');
    values.push(fields.pending_uninstall_expires_at);
  }
  if (fields.expected_managed_settings_hash !== undefined) {
    sets.push('expected_managed_settings_hash = ?');
    values.push(fields.expected_managed_settings_hash);
  }
  if (fields.last_tampering_at !== undefined) {
    sets.push('last_tampering_at = ?');
    values.push(fields.last_tampering_at);
  }
  if (fields.allow_workflows !== undefined) {
    sets.push('allow_workflows = ?');
    values.push(fields.allow_workflows ? 1 : 0);
  }
  if (fields.max_effort_level !== undefined) {
    sets.push('max_effort_level = ?');
    values.push(fields.max_effort_level);
  }
  if (sets.length === 0) return;
  values.push(userId);
  getDb().prepare(`UPDATE user SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

function deleteUser(userId) {
  // session_event.device_id references device(id) WITHOUT ON DELETE CASCADE,
  // so the CASCADE-driven device delete (when we remove the user) would fail
  // with "FOREIGN KEY constraint failed" if any session_event row points at
  // one of this user's devices. Null those references first so the cascade
  // can proceed cleanly. We keep the session_event rows themselves — they're
  // already covered by their own ON DELETE CASCADE on user_id, which will
  // remove them as part of the same statement.
  const db = getDb();
  const tx = db.transaction((uid) => {
    db.prepare(
      `UPDATE session_event SET device_id = NULL
       WHERE device_id IN (SELECT id FROM device WHERE user_id = ?)`
    ).run(uid);
    db.prepare('DELETE FROM user WHERE id = ?').run(uid);
  });
  tx(userId);
}

// --------------- Limit Rule helpers ---------------

function getLimitRules(userId) {
  return getDb().prepare('SELECT * FROM limit_rule WHERE user_id = ? ORDER BY created_at ASC').all(userId);
}

function createLimitRule({ userId, type, model, window, value, schedule_start, schedule_end, schedule_tz }) {
  const id = uuidv4();
  getDb().prepare(
    'INSERT INTO limit_rule (id, user_id, type, model, window, value, schedule_start, schedule_end, schedule_tz) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, userId, type, model || null, window || null, value != null ? value : null, schedule_start || null, schedule_end || null, schedule_tz || null);
  return getDb().prepare('SELECT * FROM limit_rule WHERE id = ?').get(id);
}

function deleteLimitRule(ruleId) {
  getDb().prepare('DELETE FROM limit_rule WHERE id = ?').run(ruleId);
}

function deleteLimitRulesForUser(userId) {
  getDb().prepare('DELETE FROM limit_rule WHERE user_id = ?').run(userId);
}

// --------------- Usage Event helpers ---------------

function recordUsage({ userId, model, modelVersion, creditCost, timestamp, source, effortLevel, isSubagent, inputTokens, outputTokens, cacheReadTokens, subagentTokens }) {
  const ts = timestamp || new Date().toISOString();
  const src = source || 'hook';
  return getDb().prepare(
    'INSERT INTO usage_event (user_id, model, model_version, credit_cost, timestamp, source, effort_level, is_subagent, input_tokens, output_tokens, cache_read_tokens, subagent_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(userId, model, modelVersion || null, creditCost, ts, src, effortLevel || null, isSubagent ? 1 : 0, inputTokens != null ? inputTokens : null, outputTokens != null ? outputTokens : null, cacheReadTokens != null ? cacheReadTokens : null, sanitizeSubagentTokens(subagentTokens));
}

/**
 * Keep only { "<model_version>": { input, output, cache_read } } with numeric
 * values; anything else from the hook is dropped rather than failing the turn.
 */
function sanitizeSubagentTokens(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  for (const [key, t] of Object.entries(value).slice(0, 20)) {
    if (!t || typeof t !== 'object') continue;
    const num = (n) => (Number.isFinite(n) && n >= 0 ? Math.round(n) : 0);
    const entry = { input: num(t.input), output: num(t.output), cache_read: num(t.cache_read) };
    if (entry.input + entry.output + entry.cache_read > 0) out[String(key).slice(0, 64)] = entry;
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

/**
 * Get usage event count by model for a user since a given timestamp.
 * Returns { opus: N, sonnet: N, haiku: N, default: N }
 */
function getUsage(userId, since) {
  const rows = getDb().prepare(
    'SELECT model, COUNT(*) AS count FROM usage_event WHERE user_id = ? AND timestamp >= ? GROUP BY model'
  ).all(userId, since);

  const result = { fable: 0, opus: 0, sonnet: 0, haiku: 0, default: 0 };
  for (const row of rows) {
    result[row.model] = row.count;
  }
  return result;
}

/**
 * Get usage with credit sums for a user since a given timestamp.
 */
function getUsageWithCredits(userId, since) {
  const rows = getDb().prepare(
    'SELECT model, COUNT(*) AS count, SUM(credit_cost) AS total_credits FROM usage_event WHERE user_id = ? AND timestamp >= ? GROUP BY model'
  ).all(userId, since);

  const counts = { fable: 0, opus: 0, sonnet: 0, haiku: 0, default: 0 };
  let totalCredits = 0;
  for (const row of rows) {
    counts[row.model] = row.count;
    totalCredits += row.total_credits;
  }
  return { counts, totalCredits };
}

/**
 * Get usage broken down by model_version for a user since a given timestamp.
 * Returns array of { model, model_version, count, total_credits, input_tokens, output_tokens, cache_read_tokens }
 */
function getUsageByVersion(userId, since) {
  return getDb().prepare(
    `SELECT model, model_version, COUNT(*) AS count, SUM(credit_cost) AS total_credits,
            COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens,
            COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens
     FROM usage_event WHERE user_id = ? AND timestamp >= ?
     GROUP BY model, model_version
     ORDER BY model, count DESC`
  ).all(userId, since);
}

/**
 * Subagent tokens for a user since a given timestamp, by the model the
 * subagents actually ran. Only turns from hooks that report the breakdown.
 * Returns array of { model_version, turns, input_tokens, output_tokens, cache_read_tokens }
 */
function getSubagentUsage(userId, since) {
  return getDb().prepare(
    `SELECT j.key AS model_version,
            COUNT(*) AS turns,
            SUM(json_extract(j.value, '$.input')) AS input_tokens,
            SUM(json_extract(j.value, '$.output')) AS output_tokens,
            SUM(json_extract(j.value, '$.cache_read')) AS cache_read_tokens
     FROM usage_event e, json_each(e.subagent_tokens) j
     WHERE e.user_id = ? AND e.timestamp >= ? AND e.subagent_tokens IS NOT NULL
     GROUP BY j.key
     ORDER BY SUM(json_extract(j.value, '$.input')) + SUM(json_extract(j.value, '$.output')) DESC`
  ).all(userId, since);
}

/**
 * Get usage for a specific window type.
 * @param {string} userId
 * @param {string} windowType - daily | weekly | monthly | sliding_24h
 * @param {string} [tz] - IANA timezone (default UTC)
 * @returns {{ counts: object, totalCredits: number, windowStart: string }}
 */
function getUsageForWindow(userId, windowType, tz) {
  const windowStart = calculateWindowStart(windowType, tz);
  const data = getUsageWithCredits(userId, windowStart);
  return { ...data, windowStart };
}

/**
 * Calculate the start of a window in ISO string.
 */
function calculateWindowStart(windowType, tz) {
  const now = new Date();

  if (windowType === 'sliding_24h') {
    return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  }

  // For daily/weekly/monthly we compute midnight in the given timezone
  // then convert back to UTC ISO string for the DB query.
  const timeZone = tz || 'UTC';

  // Get current date parts in the target timezone
  const parts = getDatePartsInTZ(now, timeZone);

  let year = parts.year;
  let month = parts.month; // 1-based
  let day = parts.day;

  if (windowType === 'daily') {
    // midnight today in the timezone
  } else if (windowType === 'weekly') {
    return calculateWeeklyStart(now, getWeeklyReset());
  } else if (windowType === 'monthly') {
    day = 1;
  }

  // Build a date string in the target timezone and convert to UTC
  // Create the local midnight in the target timezone
  const localMidnight = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00`;

  // Use a trick: compute the UTC offset for this date in this timezone
  const utcDate = localDateToUTC(localMidnight, timeZone);
  return utcDate.toISOString();
}

/**
 * Weekly reset anchor of the (single) team: { day: 0-6 (0=Sun), hour: 0-23, tz }.
 * Mirrors the reset shown by Claude's /usage for the shared subscription.
 */
function getWeeklyReset() {
  const fallback = { day: 1, hour: 0, tz: 'UTC' };
  const team = getDefaultTeam();
  if (!team || !team.weekly_reset) return fallback;
  try {
    return normalizeWeeklyReset(JSON.parse(team.weekly_reset)) || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Validate a weekly reset anchor. Returns null when invalid.
 */
function normalizeWeeklyReset(value) {
  if (!value || typeof value !== 'object') return null;
  const day = Number(value.day);
  const hour = Number(value.hour);
  const tz = typeof value.tz === 'string' && value.tz ? value.tz : 'UTC';
  if (!Number.isInteger(day) || day < 0 || day > 6) return null;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    return null;
  }
  return { day, hour, tz };
}

/**
 * Most recent weekly reset at or before `now`, as UTC ISO string.
 */
function calculateWeeklyStart(now, anchor) {
  const parts = getDatePartsInTZ(now, anchor.tz);
  let daysBack = (parts.dayOfWeek - anchor.day + 7) % 7;
  if (daysBack === 0 && parts.hour < anchor.hour) daysBack = 7;

  // Calendar arithmetic on a UTC date so month/year rollover is handled.
  const dt = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - daysBack));
  const local = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}T${String(anchor.hour).padStart(2, '0')}:00:00`;
  return localDateToUTC(local, anchor.tz).toISOString();
}

/**
 * Get date components in a given timezone.
 */
function getDatePartsInTZ(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    // h23, not hour12:false: the latter prints midnight as "24".
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(date);
  const map = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }
  const dayOfWeekMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    hour: parseInt(map.hour, 10),
    minute: parseInt(map.minute, 10),
    dayOfWeek: dayOfWeekMap[map.weekday] ?? 0,
  };
}

/**
 * Convert a local date string (without TZ info) in a given timezone to a UTC Date object.
 */
function localDateToUTC(localDateStr, timeZone) {
  // Parse the local date string
  const [datePart, timePart] = localDateStr.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second] = (timePart || '00:00:00').split(':').map(Number);

  // Create a date in UTC first, then figure out the offset for this timezone
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second || 0));

  // Get what the local time would be at this UTC time in the target timezone
  const inTZ = getDatePartsInTZ(utcGuess, timeZone);

  // The offset: inTZ wall-clock read as UTC, minus utcGuess. Comparing full
  // dates (not day-of-month) keeps it right across month boundaries.
  const tzAsUTC = Date.UTC(inTZ.year, inTZ.month - 1, inTZ.day, inTZ.hour, inTZ.minute);
  const offsetMs = tzAsUTC - utcGuess.getTime();

  // The actual UTC time = local time - offset
  return new Date(utcGuess.getTime() - offsetMs);
}

/**
 * Get recent events for a user or all users.
 */
function getRecentEvents({ userId, limit, teamId }) {
  const lim = limit || 50;
  if (userId) {
    return getDb().prepare(
      'SELECT e.*, u.name AS user_name, u.slug AS user_slug FROM usage_event e JOIN user u ON e.user_id = u.id WHERE e.user_id = ? ORDER BY e.timestamp DESC LIMIT ?'
    ).all(userId, lim);
  }
  if (teamId) {
    return getDb().prepare(
      'SELECT e.*, u.name AS user_name, u.slug AS user_slug FROM usage_event e JOIN user u ON e.user_id = u.id WHERE u.team_id = ? ORDER BY e.timestamp DESC LIMIT ?'
    ).all(teamId, lim);
  }
  return getDb().prepare(
    'SELECT e.*, u.name AS user_name, u.slug AS user_slug FROM usage_event e JOIN user u ON e.user_id = u.id ORDER BY e.timestamp DESC LIMIT ?'
  ).all(lim);
}

/**
 * Count subagent turns for a user since a given timestamp.
 */
function getSubagentCount(userId, since) {
  const row = getDb().prepare(
    'SELECT COUNT(*) AS count FROM usage_event WHERE user_id = ? AND timestamp >= ? AND is_subagent = 1'
  ).get(userId, since);
  return row.count;
}

/**
 * Sum tokens (input + output) for a user since a given timestamp.
 */
function getTokenUsage(userId, since) {
  const row = getDb().prepare(
    'SELECT COALESCE(SUM(input_tokens), 0) AS input_total, COALESCE(SUM(output_tokens), 0) AS output_total FROM usage_event WHERE user_id = ? AND timestamp >= ?'
  ).get(userId, since);
  return { input: row.input_total, output: row.output_total, total: row.input_total + row.output_total };
}

/**
 * Delete events older than N days.
 */
function cleanupOldEvents(days) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return getDb().prepare('DELETE FROM usage_event WHERE timestamp < ?').run(cutoff);
}

// --------------- Install Code helpers ---------------

function createInstallCode(userId) {
  // Generate a human-readable code: CLM-<slug-prefix>-<random>
  const user = getUser(userId);
  const prefix = user ? user.slug.substring(0, 8) : 'user';
  const random = uuidv4().substring(0, 6);
  const code = `CLM-${prefix}-${random}`;

  getDb().prepare(
    'INSERT INTO install_code (code, user_id) VALUES (?, ?)'
  ).run(code, userId);

  return code;
}

function useInstallCode(code) {
  const row = getDb().prepare('SELECT * FROM install_code WHERE code = ? AND used = 0').get(code);
  if (!row) return null;

  getDb().prepare('UPDATE install_code SET used = 1 WHERE code = ?').run(code);
  return row;
}

function getUnusedInstallCode(userId) {
  return getDb().prepare(
    'SELECT code FROM install_code WHERE user_id = ? AND used = 0 ORDER BY created_at DESC LIMIT 1'
  ).get(userId) || null;
}

function invalidateUnusedInstallCodes(userId) {
  getDb().prepare(
    'UPDATE install_code SET used = 1 WHERE user_id = ? AND used = 0'
  ).run(userId);
}

// --------------- Device helpers ---------------

/**
 * Upsert a device record for a user.
 * @param {string} userId
 * @param {object} deviceInfo - { hostname, platform, arch, os_version, node_version, claude_version, subscription_type, default_model, ip }
 * @returns {object} the device row
 */
function upsertDevice(userId, deviceInfo) {
  const hostname = deviceInfo.hostname || 'unknown';
  const existing = getDb().prepare(
    'SELECT * FROM device WHERE user_id = ? AND hostname = ?'
  ).get(userId, hostname);

  if (existing) {
    const sets = ['last_seen = ?'];
    const values = [new Date().toISOString()];
    if (deviceInfo.platform) { sets.push('platform = ?'); values.push(deviceInfo.platform); }
    if (deviceInfo.arch) { sets.push('arch = ?'); values.push(deviceInfo.arch); }
    if (deviceInfo.os_version) { sets.push('os_version = ?'); values.push(deviceInfo.os_version); }
    if (deviceInfo.node_version) { sets.push('node_version = ?'); values.push(deviceInfo.node_version); }
    if (deviceInfo.claude_version) { sets.push('claude_version = ?'); values.push(deviceInfo.claude_version); }
    if (deviceInfo.subscription_type) { sets.push('subscription_type = ?'); values.push(deviceInfo.subscription_type); }
    if (deviceInfo.default_model) { sets.push('default_model = ?'); values.push(deviceInfo.default_model); }
    if (deviceInfo.ip) { sets.push('last_ip = ?'); values.push(deviceInfo.ip); }
    values.push(existing.id);
    getDb().prepare(`UPDATE device SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return getDb().prepare('SELECT * FROM device WHERE id = ?').get(existing.id);
  } else {
    const id = uuidv4();
    getDb().prepare(
      `INSERT INTO device (id, user_id, hostname, platform, arch, os_version, node_version, claude_version, subscription_type, default_model, last_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, userId, hostname,
      deviceInfo.platform || null,
      deviceInfo.arch || null,
      deviceInfo.os_version || null,
      deviceInfo.node_version || null,
      deviceInfo.claude_version || null,
      deviceInfo.subscription_type || null,
      deviceInfo.default_model || null,
      deviceInfo.ip || null
    );
    return getDb().prepare('SELECT * FROM device WHERE id = ?').get(id);
  }
}

/**
 * Get all devices for a user.
 * @param {string} userId
 * @returns {Array}
 */
function getDevices(userId) {
  return getDb().prepare('SELECT * FROM device WHERE user_id = ? ORDER BY last_seen DESC').all(userId);
}

/**
 * Get all devices for a team.
 * @param {string} teamId
 * @returns {Array}
 */
function getDevicesByTeam(teamId) {
  return getDb().prepare(
    `SELECT d.*, u.name AS user_name, u.slug AS user_slug
     FROM device d
     JOIN user u ON d.user_id = u.id
     WHERE u.team_id = ?
     ORDER BY d.last_seen DESC`
  ).all(teamId);
}

// --------------- Session Event helpers ---------------

/**
 * Record a session event.
 * @param {object} data - { user_id, device_id, type, model, prompt_length, project_dir, tools_used, session_id, blocked_reason, response_length, timestamp }
 */
function recordSessionEvent(data) {
  const ts = data.timestamp || new Date().toISOString();
  return getDb().prepare(
    `INSERT INTO session_event (user_id, device_id, type, model, model_version, prompt_length, project_dir, tools_used, session_id, blocked_reason, response_length, timestamp, effort_level, agent_id, agent_type, input_tokens, output_tokens)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.user_id,
    data.device_id || null,
    data.type,
    data.model || null,
    data.model_version || null,
    data.prompt_length != null ? data.prompt_length : null,
    data.project_dir || null,
    data.tools_used != null ? data.tools_used : null,
    data.session_id || null,
    data.blocked_reason || null,
    data.response_length != null ? data.response_length : null,
    ts,
    data.effort_level || null,
    data.agent_id || null,
    data.agent_type || null,
    data.input_tokens != null ? data.input_tokens : null,
    data.output_tokens != null ? data.output_tokens : null
  );
}

/**
 * Get session events for a user with optional filters.
 * @param {string} userId
 * @param {object} [opts] - { since, type, limit }
 * @returns {Array}
 */
function getSessionEvents(userId, opts) {
  opts = opts || {};
  const conditions = ['user_id = ?'];
  const params = [userId];

  if (opts.since) {
    conditions.push('timestamp >= ?');
    params.push(opts.since);
  }
  if (opts.type) {
    conditions.push('type = ?');
    params.push(opts.type);
  }

  const lim = opts.limit || 100;
  params.push(lim);

  return getDb().prepare(
    `SELECT * FROM session_event WHERE ${conditions.join(' AND ')} ORDER BY timestamp DESC LIMIT ?`
  ).all(...params);
}

/**
 * Get analytics data for a team.
 * @param {string} teamId
 * @param {object} [opts] - { days, user_id }
 * @returns {object} Analytics data
 */
function getAnalytics(teamId, opts) {
  opts = opts || {};
  const days = opts.days || 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const userFilter = opts.user_id ? ' AND se.user_id = ?' : '';
  const userFilterParams = opts.user_id ? [opts.user_id] : [];

  // Peak usage hours (group by hour of day, count events)
  const peakHours = getDb().prepare(
    `SELECT CAST(strftime('%H', se.timestamp) AS INTEGER) AS hour, COUNT(*) AS count
     FROM session_event se
     JOIN user u ON se.user_id = u.id
     WHERE u.team_id = ? AND se.timestamp >= ? AND se.type = 'prompt'${userFilter}
     GROUP BY hour
     ORDER BY hour`
  ).all(teamId, since, ...userFilterParams);

  // Per-project usage
  const projectUsage = getDb().prepare(
    `SELECT se.project_dir AS project, COUNT(*) AS count
     FROM session_event se
     JOIN user u ON se.user_id = u.id
     WHERE u.team_id = ? AND se.timestamp >= ? AND se.type = 'prompt' AND se.project_dir IS NOT NULL${userFilter}
     GROUP BY se.project_dir
     ORDER BY count DESC
     LIMIT 20`
  ).all(teamId, since, ...userFilterParams);

  // Model distribution
  const modelDistRows = getDb().prepare(
    `SELECT se.model, COUNT(*) AS count
     FROM session_event se
     JOIN user u ON se.user_id = u.id
     WHERE u.team_id = ? AND se.timestamp >= ? AND se.type = 'prompt' AND se.model IS NOT NULL${userFilter}
     GROUP BY se.model`
  ).all(teamId, since, ...userFilterParams);
  const modelDistribution = {};
  for (const row of modelDistRows) {
    modelDistribution[row.model] = row.count;
  }

  // Daily active users
  const dailyActive = getDb().prepare(
    `SELECT DATE(se.timestamp) AS date, COUNT(DISTINCT se.user_id) AS users
     FROM session_event se
     JOIN user u ON se.user_id = u.id
     WHERE u.team_id = ? AND se.timestamp >= ?${userFilter}
     GROUP BY DATE(se.timestamp)
     ORDER BY date`
  ).all(teamId, since, ...userFilterParams);

  // Block rate
  const totalPrompts = getDb().prepare(
    `SELECT COUNT(*) AS count FROM session_event se
     JOIN user u ON se.user_id = u.id
     WHERE u.team_id = ? AND se.timestamp >= ? AND se.type = 'prompt'${userFilter}`
  ).get(teamId, since, ...userFilterParams);

  const blockedCount = getDb().prepare(
    `SELECT COUNT(*) AS count FROM session_event se
     JOIN user u ON se.user_id = u.id
     WHERE u.team_id = ? AND se.timestamp >= ? AND se.type = 'blocked'${userFilter}`
  ).get(teamId, since, ...userFilterParams);

  const total = totalPrompts.count;
  const blocked = blockedCount.count;
  const blockRate = { total, blocked, rate: total > 0 ? +(blocked / total).toFixed(4) : 0 };

  // Average prompt length
  const avgPromptRow = getDb().prepare(
    `SELECT AVG(se.prompt_length) AS avg_len FROM session_event se
     JOIN user u ON se.user_id = u.id
     WHERE u.team_id = ? AND se.timestamp >= ? AND se.type = 'prompt' AND se.prompt_length IS NOT NULL${userFilter}`
  ).get(teamId, since, ...userFilterParams);
  const avgPromptLength = avgPromptRow.avg_len ? Math.round(avgPromptRow.avg_len) : 0;

  // Average response length
  const avgRespRow = getDb().prepare(
    `SELECT AVG(se.response_length) AS avg_len FROM session_event se
     JOIN user u ON se.user_id = u.id
     WHERE u.team_id = ? AND se.timestamp >= ? AND se.type = 'turn_complete' AND se.response_length IS NOT NULL${userFilter}`
  ).get(teamId, since, ...userFilterParams);
  const avgResponseLength = avgRespRow.avg_len ? Math.round(avgRespRow.avg_len) : 0;

  // Average prompts per session
  const sessionCounts = getDb().prepare(
    `SELECT se.session_id, COUNT(*) AS count
     FROM session_event se
     JOIN user u ON se.user_id = u.id
     WHERE u.team_id = ? AND se.timestamp >= ? AND se.type = 'prompt' AND se.session_id IS NOT NULL${userFilter}
     GROUP BY se.session_id`
  ).all(teamId, since, ...userFilterParams);
  let avgPromptsPerSession = 0;
  if (sessionCounts.length > 0) {
    const totalSessionPrompts = sessionCounts.reduce((sum, r) => sum + r.count, 0);
    avgPromptsPerSession = +(totalSessionPrompts / sessionCounts.length).toFixed(1);
  }

  // Devices
  const devicesQuery = opts.user_id
    ? getDb().prepare('SELECT * FROM device WHERE user_id = ? ORDER BY last_seen DESC').all(opts.user_id)
    : getDevicesByTeam(teamId);

  // Daily credits — sum of credit_cost per day from usage_event.
  // Lets the dashboard show historic token spend (jefe asked for this).
  // Filter uses ue.* (usage_event) instead of se.* (session_event).
  const ueUserFilter = opts.user_id ? ' AND ue.user_id = ?' : '';
  const dailyCredits = getDb().prepare(
    `SELECT DATE(ue.timestamp) AS date, SUM(ue.credit_cost) AS credits, COUNT(*) AS prompts,
            COALESCE(SUM(ue.input_tokens), 0) + COALESCE(SUM(ue.output_tokens), 0) AS tokens
     FROM usage_event ue
     JOIN user u ON ue.user_id = u.id
     WHERE u.team_id = ? AND ue.timestamp >= ?${ueUserFilter}
     GROUP BY DATE(ue.timestamp)
     ORDER BY date`
  ).all(teamId, since, ...userFilterParams);

  return {
    peak_hours: peakHours,
    model_distribution: modelDistribution,
    project_usage: projectUsage,
    daily_active: dailyActive,
    daily_credits: dailyCredits,
    block_rate: blockRate,
    avg_prompt_length: avgPromptLength,
    avg_response_length: avgResponseLength,
    avg_prompts_per_session: avgPromptsPerSession,
    devices: devicesQuery,
  };
}

module.exports = {
  init,
  runMigrations,
  runStartupMaintenance,
  useRollbackJournal,
  seed,
  close,
  getDb,
  // Team
  getTeam,
  getDefaultTeam,
  updateTeam,
  // User
  getUser,
  getUserByToken,
  getUserBySlug,
  getAllUsers,
  createUser,
  updateUser,
  deleteUser,
  // Limit Rules
  getLimitRules,
  createLimitRule,
  deleteLimitRule,
  deleteLimitRulesForUser,
  // Usage
  recordUsage,
  getUsage,
  getUsageWithCredits,
  getUsageByVersion,
  getSubagentUsage,
  getUsageForWindow,
  getRecentEvents,
  cleanupOldEvents,
  getSubagentCount,
  getTokenUsage,
  // Install Codes
  createInstallCode,
  useInstallCode,
  getUnusedInstallCode,
  invalidateUnusedInstallCodes,
  // Device
  upsertDevice,
  getDevices,
  getDevicesByTeam,
  // Session Events / Analytics
  recordSessionEvent,
  getSessionEvents,
  getAnalytics,
  // Helpers (exported for services)
  calculateWindowStart,
  calculateWeeklyStart,
  normalizeWeeklyReset,
  getDatePartsInTZ,
};
