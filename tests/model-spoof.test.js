// Run: node --test tests/model-spoof.test.js
// Covers the model-spoofing countermeasures: limiter.isModelBlocked (server)
// and hook.lastObservedModel (client). hook.js runs main() on load, so its
// functions are extracted from source instead of required.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---- server: isModelBlocked ----
const db = require('../packages/server/src/server/db');
const { isModelBlocked } = require('../packages/server/src/server/services/limiter');

function withRules(rules, fn) {
  const orig = db.getLimitRules;
  db.getLimitRules = () => rules;
  try { fn(); } finally { db.getLimitRules = orig; }
}

test('isModelBlocked: only per_model value 0 blocks', () => {
  const user = { id: 'u1' };
  withRules([{ type: 'per_model', model: 'opus', value: 0 }], () => {
    assert.strictEqual(isModelBlocked(user, 'opus'), true);
    assert.strictEqual(isModelBlocked(user, 'sonnet'), false);
  });
  // A cap is not a hard block: judged on the declared model elsewhere.
  withRules([{ type: 'per_model', model: 'opus', value: 5 }], () => {
    assert.strictEqual(isModelBlocked(user, 'opus'), false);
  });
  withRules([{ type: 'per_model', model: 'opus', value: -1 }], () => {
    assert.strictEqual(isModelBlocked(user, 'opus'), false);
  });
  withRules([{ type: 'per_model', model: null, value: 0 }], () => {
    assert.strictEqual(isModelBlocked(user, 'haiku'), true);
  });
});

// ---- client: lastObservedModel ----
const src = fs.readFileSync(path.join(__dirname, '..', 'packages/cli/src/hook.js'), 'utf8');
function extract(name) {
  const m = src.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}`, 'm'));
  assert.ok(m, `function ${name} not found in hook.js`);
  return m[0];
}
const lastObservedModel = new Function(
  'fs', 'path', 'debugLog',
  [extract('readTailLines'), extract('resolveContinuedTranscript'), extract('normalizeModel'), extract('lastObservedModel'),
    'return lastObservedModel;'].join('\n'),
)(fs, path, () => {});

function transcript(entries) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'spoof-')), 's.jsonl');
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const asst = (model, ms, extra) => ({ type: 'assistant', timestamp: ago(ms), message: { model }, ...extra });

test('lastObservedModel: returns the latest recent main-thread model', () => {
  const f = transcript([asst('claude-sonnet-4-6', 60000), asst('claude-opus-4-6', 10000)]);
  assert.strictEqual(lastObservedModel(f), 'claude-opus-4-6');
});

test('lastObservedModel: ignores sidechain and synthetic entries', () => {
  const f = transcript([
    asst('claude-sonnet-4-6', 20000),
    asst('claude-opus-4-6', 10000, { isSidechain: true }),
    asst('<synthetic>', 5000),
  ]);
  assert.strictEqual(lastObservedModel(f), 'claude-sonnet-4-6');
});

test('lastObservedModel: stale turn (>5 min) is not trusted', () => {
  const f = transcript([asst('claude-opus-4-6', 6 * 60 * 1000)]);
  assert.strictEqual(lastObservedModel(f), null);
});

test('lastObservedModel: missing path or file returns null', () => {
  assert.strictEqual(lastObservedModel(null), null);
  assert.strictEqual(lastObservedModel(path.join(os.tmpdir(), 'nope', 'x.jsonl')), null);
});

// ---- server: allowedModels (feeds managed `availableModels`) ----
const { allowedModels } = require('../packages/server/src/server/services/limiter');

test('allowedModels: ticked models only; null when nothing or everything is blocked', () => {
  const user = { id: 'u1' };
  withRules([], () => assert.strictEqual(allowedModels(user), null));
  withRules([{ type: 'per_model', model: 'opus', value: 0 }, { type: 'per_model', model: 'fable', value: 0 }], () => {
    assert.deepStrictEqual(allowedModels(user), ['sonnet', 'haiku']);
  });
  // caps do not restrict the list
  withRules([{ type: 'per_model', model: 'opus', value: 3 }], () => assert.strictEqual(allowedModels(user), null));
  withRules([{ type: 'per_model', model: null, value: 0 }], () => assert.strictEqual(allowedModels(user), null));
});
