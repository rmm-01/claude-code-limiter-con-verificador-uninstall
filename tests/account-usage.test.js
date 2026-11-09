// Run: node --test tests/account-usage.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { combineReports, pruneReports } = require('../packages/server/src/server/services/accountUsage');

const NOW = 1_800_000_000_000;
const sec = NOW / 1000;
const w = (pct, resetsIn) => ({ used_percentage: pct, resets_at: sec + resetsIn });
const r = (name, seven, agoMs = 1000, five = null) => ({ name, five_hour: five, seven_day: seven, at: NOW - agoMs });

test('same window: the highest reading wins, whoever reported last', () => {
  const c = combineReports({ a: r('Ana', w(60, 86400), 5000), b: r('Beto', w(56, 86402), 1000) }, NOW);
  assert.strictEqual(c.seven_day.used_percentage, 60);
  assert.strictEqual(c.reported_by, 'Ana');
  assert.deepStrictEqual(c.reporters.sort(), ['Ana', 'Beto']);
});

test('a newer window beats an older one even with a lower percentage (after a reset)', () => {
  const c = combineReports({ a: r('Ana', w(95, 3600)), b: r('Beto', w(3, 7 * 86400)) }, NOW);
  assert.strictEqual(c.seven_day.used_percentage, 3);
});

test('readings older than 10 minutes stop counting; windows already reset are ignored', () => {
  const c = combineReports({ a: r('Ana', w(99, 86400), 11 * 60 * 1000), b: r('Beto', w(40, 86400)) }, NOW);
  assert.strictEqual(c.seven_day.used_percentage, 40);
  assert.deepStrictEqual(c.reporters, ['Beto']);
  assert.strictEqual(combineReports({ a: r('Ana', w(80, -10)) }, NOW).seven_day, null);
});

test('windows are combined independently; empty input is safe', () => {
  const c = combineReports({ a: r('Ana', null, 1000, w(10, 3600)), b: r('Beto', w(50, 86400)) }, NOW);
  assert.strictEqual(c.five_hour.used_percentage, 10);
  assert.strictEqual(c.seven_day.used_percentage, 50);
  const e = combineReports({}, NOW);
  assert.strictEqual(e.seven_day, null);
  assert.strictEqual(e.reported_by, null);
});

test('pruneReports drops stale readings only', () => {
  const p = pruneReports({ a: r('Ana', w(1, 100), 11 * 60 * 1000), b: r('Beto', w(1, 100)) }, NOW);
  assert.deepStrictEqual(Object.keys(p), ['b']);
});

// ---- client: when the hook reports the account usage ----
const fs = require('node:fs');
const path = require('node:path');
const hookSrc = fs.readFileSync(path.join(__dirname, '..', 'packages/cli/src/hook.js'), 'utf8');
const grab = (name) => hookSrc.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}`, 'm'))[0];
const due = new Function(
  'ACCOUNT_USAGE_INTERVAL_MS', 'ACCOUNT_USAGE_MIN_GAP_MS',
  `${grab('accountUsageSnapshot')}\n${grab('accountUsageReportDue')}\nreturn accountUsageReportDue;`,
)(60000, 3000);
const rl = (seven) => ({ seven_day: { used_percentage: seven, resets_at: 1 } });

test('hook: a changed percentage is reported after 3 s even inside the minute (the last reading is not lost)', () => {
  const stamp = { at: 1_000_000, seven: 55, five: null };
  assert.strictEqual(due(stamp, rl(58), 1_000_000 + 10_000), true);
  assert.strictEqual(due(stamp, rl(58), 1_000_000 + 1_000), false); // burst of statusLine runs
  assert.strictEqual(due(stamp, rl(55), 1_000_000 + 10_000), false); // unchanged: wait for the minute
  assert.strictEqual(due(stamp, rl(55), 1_000_000 + 61_000), true);
  assert.strictEqual(due(null, rl(55), 5), true);
});
