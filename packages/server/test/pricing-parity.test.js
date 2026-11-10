'use strict';

// The hook (packages/cli/src/hook.js turnCostUsd) and the server (pricing.js
// computeCostUsd) price a turn independently; they must agree.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { computeCostUsd, DEFAULT_PRICES } = require('../src/server/services/pricing.js');

// hook.js runs main() on require, so pull turnCostUsd out of its source.
const src = fs.readFileSync(path.join(__dirname, '../../cli/src/hook.js'), 'utf8');
const body = src.match(/function turnCostUsd\([\s\S]*?\r?\n}\r?\n/);
assert.ok(body, 'turnCostUsd not found in hook.js');
const turnCostUsd = new Function(`${body[0]}; return turnCostUsd;`)();

const server = (prices, t, model) => computeCostUsd(prices, {
  model, input: t.input, output: t.output, cacheRead: t.cacheRead, cacheCreation: t.cacheCreation, subagents: t.subagents,
});
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `hook ${a} != server ${b}`);

const turns = [
  { input: 20600, output: 300, cacheRead: 0, cacheCreation: 18000 },
  { input: 5000, output: 2000, cacheRead: 900000, cacheCreation: 1200 },
  { input: 9000, output: 3000, cacheRead: 50000, cacheCreation: 4000,
    subagents: { 'haiku-5-5': { input: 3000, output: 1000, cache_read: 20000, cache_creation: 2500 } } },
];

test('hook and server agree with default prices', () => {
  for (const t of turns) for (const model of ['opus', 'sonnet', 'haiku']) {
    close(turnCostUsd(DEFAULT_PRICES, t, model), server(DEFAULT_PRICES, t, model));
  }
});

test('unpriced subagent model is charged at the dearest row on both sides', () => {
  const prices = { sonnet: DEFAULT_PRICES.sonnet, opus: DEFAULT_PRICES.opus };
  close(turnCostUsd(prices, turns[2], 'sonnet'), server(prices, turns[2], 'sonnet'));
});

test('subagent cache writes are priced at the subagent model', () => {
  const t = { input: 2000, output: 0, cacheRead: 0, cacheCreation: 1000,
    subagents: { 'haiku-5-5': { input: 1000, output: 0, cache_read: 0, cache_creation: 1000 } } };
  close(server(DEFAULT_PRICES, t, 'opus'), (1000 * 4 + 1000 * 0.125) / 1e6);
});
