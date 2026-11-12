'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseSnapshot, cycleStart, fetchFrom, computeCredits } = require('../src/server/services/apiCredits.js');

// Real ERP answer of 2026-11-12 (Console showed 35.63 spent this month).
const dias = [
  { fecha: '2026-11-01T00:00:00Z', usd: 0 },
  { fecha: '2026-11-02T00:00:00Z', usd: 11.1016 },
  { fecha: '2026-11-03T00:00:00Z', usd: 22.4452 },
  { fecha: '2026-11-10T00:00:00Z', usd: 0.0092 },
  { fecha: '2026-11-11T00:00:00Z', usd: 0.2161 },
];

// Ultra: US$200 granted on the 27th. Spend of the cycle up to the reading = 55.98,
// so Console's 144.02 is exactly the plan credit left: no purchased credits.
const ultra = { amount_usd: 144.02, date: '2026-11-12', credit_usd: 200, credit_day: 27 };
const cycle = [
  { fecha: '2026-10-28T00:00:00Z', usd: 20.35 },
  ...dias.slice(1),
  { fecha: '2026-11-12T00:00:00Z', usd: 1.8579 },
];

test('without a plan credit: only days after the snapshot are subtracted', () => {
  const r = computeCredits({ amount_usd: 144.02, date: '2026-11-10' }, dias, '2026-11-12');
  assert.strictEqual(r.balance_usd, 143.8);
  assert.strictEqual(r.spent_since_usd, 0.22);
  assert.strictEqual(r.month_usd, 33.77);
  assert.strictEqual(r.plan_renews, null);
});

test('without a plan credit: snapshot taken today subtracts nothing yet', () => {
  assert.strictEqual(computeCredits({ amount_usd: 144.02, date: '2026-11-12' }, dias, '2026-11-12').balance_usd, 144.02);
});

test('plan credit is spent first; Console balance below it means no purchased credits', () => {
  const r = computeCredits(ultra, [...cycle, { fecha: '2026-11-13T00:00:00Z', usd: 10 }], '2026-11-14');
  assert.strictEqual(r.purchased_usd, 0);
  assert.strictEqual(r.plan_left_usd, 134.02);
  assert.strictEqual(r.balance_usd, 134.02);
  assert.strictEqual(r.plan_renews, '2026-11-27');
});

test('on renewal the unused plan credit expires and a fresh one starts', () => {
  const r = computeCredits(ultra, [...cycle, { fecha: '2026-11-27T00:00:00Z', usd: 5 }], '2026-11-28');
  assert.strictEqual(r.plan_left_usd, 195);
  assert.strictEqual(r.balance_usd, 195);
  assert.strictEqual(r.plan_renews, '2026-12-27');
});

test('spend past the plan credit comes out of purchased credits', () => {
  const r = computeCredits({ ...ultra, amount_usd: 250 }, [...cycle, { fecha: '2026-11-13T00:00:00Z', usd: 180 }], '2026-11-14');
  assert.strictEqual(r.plan_left_usd, 0);
  assert.strictEqual(r.purchased_usd, 70); // 250 - 144.02 left of the plan = 105.98, minus 35.98 over 200
  assert.strictEqual(r.balance_usd, 70);
});

test('cycle start clamps the grant day to the month length', () => {
  assert.strictEqual(cycleStart('2026-11-27', 27), '2026-11-27');
  assert.strictEqual(cycleStart('2026-11-26', 27), '2026-10-27');
  assert.strictEqual(cycleStart('2026-01-05', 27), '2025-12-27');
  assert.strictEqual(cycleStart('2026-02-15', 31), '2026-01-31');
  assert.strictEqual(cycleStart('2026-03-01', 31), '2026-02-28');
});

test('fetch starts at the earlier of the snapshot cycle start and month start', () => {
  assert.strictEqual(fetchFrom({ date: '2026-11-10' }, '2026-11-12'), '2026-11-01');
  assert.strictEqual(fetchFrom(ultra, '2026-11-14'), '2026-10-27');
  assert.strictEqual(fetchFrom(ultra, '2026-12-03'), '2026-10-27');
});

test('snapshot validation', () => {
  assert.deepStrictEqual(parseSnapshot({ amount_usd: '144.024', date: '2026-11-12' }, '2026-11-12'),
    { amount_usd: 144.02, date: '2026-11-12', credit_usd: 0, credit_day: 1 });
  assert.deepStrictEqual(parseSnapshot({ amount_usd: 144.02, date: '2026-11-12', credit_usd: '200', credit_day: '27' }, '2026-11-12'),
    { amount_usd: 144.02, date: '2026-11-12', credit_usd: 200, credit_day: 27 });
  for (const bad of [
    { amount_usd: -1, date: '2026-11-12' },
    { amount_usd: '', date: '2026-11-12' },
    { amount_usd: 10, date: '2026-11-13' },
    { amount_usd: 10, date: '12/11/2026' },
    { amount_usd: 10, date: '2026-11-12', credit_usd: -5 },
    { amount_usd: 10, date: '2026-11-12', credit_day: 32 },
    { amount_usd: 10, date: '2026-11-12', credit_day: 2.5 },
  ]) assert.strictEqual(typeof parseSnapshot(bad, '2026-11-12'), 'string', JSON.stringify(bad));
});
