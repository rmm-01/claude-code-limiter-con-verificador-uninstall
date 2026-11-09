// Run: node --test tests/pricing.test.js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { sanitizePrices, computeCostUsd } = require('../packages/server/src/server/services/pricing');

const prices = {
  sonnet: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
  haiku: { input: 1, output: 5 },
};

test('computeCostUsd: prices plain input, cache writes, cache reads and output apart', () => {
  // input 1M includes 200k cache writes: 800k*3 + 200k*3.75 + 500k*0.3 + 100k*15 = 2.4+0.75+0.15+1.5
  const c = computeCostUsd(prices, { model: 'sonnet', input: 1_000_000, output: 100_000, cacheRead: 500_000, cacheCreation: 200_000 });
  assert.strictEqual(c, 4.8);
});

test('computeCostUsd: without cache_creation everything in input is priced as plain input', () => {
  assert.strictEqual(computeCostUsd(prices, { model: 'sonnet', input: 1_000_000, output: 0, cacheRead: 0 }), 3);
});

test('computeCostUsd: missing cache prices default to 0.1x / 1.25x of input', () => {
  // haiku: 1M plain... 500k plain*1 + 500k writes*1.25 + 1M reads*0.1 = 0.5+0.625+0.1
  assert.strictEqual(computeCostUsd(prices, { model: 'haiku', input: 1_000_000, output: 0, cacheRead: 1_000_000, cacheCreation: 500_000 }), 1.225);
});

test('computeCostUsd: null when the turn has no tokens or the model has no price', () => {
  assert.strictEqual(computeCostUsd(prices, { model: 'sonnet', input: null, output: null }), null);
  assert.strictEqual(computeCostUsd(prices, { model: 'opus', input: 10, output: 10 }), null);
  assert.strictEqual(computeCostUsd(prices, { model: 'default', input: 10, output: 10 }), null);
});

test('computeCostUsd: subagent tokens are priced at their own model, the rest at the turn model', () => {
  // totals: input 1M, output 100k. haiku subagent: input 100k, output 10k -> 0.1 + 0.05 = 0.15
  // main remainder: 900k*3 + 90k*15 = 2.7 + 1.35 = 4.05
  const c = computeCostUsd(prices, {
    model: 'sonnet', input: 1_000_000, output: 100_000, cacheRead: 0,
    subagents: { 'haiku-4-5': { input: 100_000, output: 10_000, cache_read: 0 } },
  });
  assert.strictEqual(c, 4.2);
});

test('sanitizePrices: keeps valid numbers, rejects negatives and junk', () => {
  assert.deepStrictEqual(sanitizePrices({ opus: { input: '5', output: 25, cache_read: '' }, nope: { input: 1 } }), { opus: { input: 5, output: 25 } });
  assert.strictEqual(sanitizePrices({ opus: { input: -1 } }), null);
  assert.strictEqual(sanitizePrices({ opus: { input: 'abc' } }), null);
  assert.strictEqual(sanitizePrices([]), null);
  assert.strictEqual(sanitizePrices(null), null);
});
