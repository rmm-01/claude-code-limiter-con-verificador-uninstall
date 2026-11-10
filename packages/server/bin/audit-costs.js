#!/usr/bin/env node
'use strict';

// Audit stored turn costs against the current pricing code.
//   node bin/audit-costs.js            report only (no writes)
//   node bin/audit-costs.js --apply    back up the DB, then rewrite cost_usd
// Scope: turns since local midnight (team timezone) that have token data.
// Also lists turns whose timestamp is in the future or over a year old,
// which only a tampered hook could have stored before /count used the server clock.

const fs = require('fs');
const path = require('path');
const db = require('../src/server/db');
const { computeCostUsd, parsePrices } = require('../src/server/services/pricing');

const apply = process.argv.includes('--apply');
const dbPath = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'limiter.db');
db.init(dbPath);
const d = db.getDb();

const now = Date.now();
const suspicious = d.prepare(
  `SELECT ue.id, u.name, ue.timestamp FROM usage_event ue JOIN user u ON ue.user_id = u.id
   WHERE ue.timestamp > ? OR ue.timestamp < ? ORDER BY ue.timestamp`
).all(new Date(now + 5 * 60e3).toISOString(), new Date(now - 365 * 864e5).toISOString());
console.log(`Suspicious timestamps: ${suspicious.length}`);
for (const r of suspicious) console.log(`  #${r.id} ${r.name} ${r.timestamp}`);

const since = db.calculateWindowStart('daily');
const rows = d.prepare(
  `SELECT ue.id, u.name, u.team_id, ue.model, ue.input_tokens, ue.output_tokens, ue.cache_read_tokens,
          ue.cache_creation_tokens, ue.subagent_tokens, ue.cost_usd
   FROM usage_event ue JOIN user u ON ue.user_id = u.id
   WHERE ue.timestamp >= ? AND (ue.input_tokens IS NOT NULL OR ue.output_tokens IS NOT NULL)`
).all(since);

const prices = {};
const changes = [];
const perUser = {};
for (const r of rows) {
  prices[r.team_id] ??= parsePrices(db.getTeam(r.team_id));
  let subagents = null;
  try { subagents = r.subagent_tokens ? JSON.parse(r.subagent_tokens) : null; } catch { /* keep null */ }
  const next = computeCostUsd(prices[r.team_id], {
    model: r.model, input: r.input_tokens, output: r.output_tokens, cacheRead: r.cache_read_tokens,
    cacheCreation: r.cache_creation_tokens, subagents,
  });
  const u = (perUser[r.name] ??= { turns: 0, before: 0, after: 0 });
  u.turns++;
  u.before += r.cost_usd || 0;
  u.after += next != null ? next : r.cost_usd || 0;
  if (next != null && Math.abs(next - (r.cost_usd || 0)) > 1e-6) changes.push({ id: r.id, next });
}

console.log(`\nToday since ${since}: ${rows.length} turns, ${changes.length} would change`);
for (const [name, u] of Object.entries(perUser)) {
  console.log(`  ${name}: ${u.turns} turns  US$${u.before.toFixed(4)} -> US$${u.after.toFixed(4)}`);
}

if (!apply) {
  console.log('\nReport only. Run with --apply to back up the DB and write the new costs.');
  process.exit(0);
}
if (!changes.length) { console.log('\nNothing to write.'); process.exit(0); }

const backup = `${dbPath}.bak-${now}`;
d.prepare('VACUUM INTO ?').run(backup); // consistent copy even with WAL and a live server
const upd = d.prepare('UPDATE usage_event SET cost_usd = ? WHERE id = ?');
d.transaction(() => { for (const c of changes) upd.run(c.next, c.id); })();
console.log(`\nBackup: ${backup}\nUpdated ${changes.length} rows.`);
