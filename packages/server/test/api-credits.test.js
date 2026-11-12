'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseSnapshot, fetchFrom, computeCredits } = require('../src/server/services/apiCredits.js');

// Real ERP answer of 2026-11-12 (Console showed 35.63 spent this month).
const dias = [
  { fecha: '2026-11-01T00:00:00Z', usd: 0 },
  { fecha: '2026-11-02T00:00:00Z', usd: 11.1016 },
  { fecha: '2026-11-03T00:00:00Z', usd: 22.4452 },
  { fecha: '2026-11-10T00:00:00Z', usd: 0.0092 },
  { fecha: '2026-11-11T00:00:00Z', usd: 0.2161 },
];

test('only days after the snapshot are subtracted; month counts from the 1st', () => {
  const r = computeCredits({ amount_usd: 144.02, date: '2026-11-10' }, dias, '2026-11-12');
  assert.deepStrictEqual(r, { balance_usd: 143.8, spent_since_usd: 0.22, month_usd: 33.77 });
});

test('snapshot taken today subtracts nothing yet', () => {
  const r = computeCredits({ amount_usd: 144.02, date: '2026-11-12' }, dias, '2026-11-12');
  assert.strictEqual(r.balance_usd, 144.02);
});

test('fetch starts at the earlier of day-after-snapshot and month start', () => {
  assert.strictEqual(fetchFrom({ date: '2026-11-10' }, '2026-11-12'), '2026-11-01');
  assert.strictEqual(fetchFrom({ date: '2026-10-20' }, '2026-11-12'), '2026-10-21');
  assert.strictEqual(fetchFrom({ date: '2026-10-31' }, '2026-11-12'), '2026-11-01');
});

test('snapshot validation', () => {
  assert.deepStrictEqual(parseSnapshot({ amount_usd: '144.024', date: '2026-11-12' }, '2026-11-12'), { amount_usd: 144.02, date: '2026-11-12' });
  assert.strictEqual(typeof parseSnapshot({ amount_usd: -1, date: '2026-11-12' }, '2026-11-12'), 'string');
  assert.strictEqual(typeof parseSnapshot({ amount_usd: '', date: '2026-11-12' }, '2026-11-12'), 'string');
  assert.strictEqual(typeof parseSnapshot({ amount_usd: 10, date: '2026-11-13' }, '2026-11-12'), 'string');
  assert.strictEqual(typeof parseSnapshot({ amount_usd: 10, date: '12/11/2026' }, '2026-11-12'), 'string');
});
