'use strict';

// hook.js reads a session's /model switches from the transcript; the line
// format below is what Claude Code writes (captured from real transcripts).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// hook.js runs main() on require, so pull parseModelSwitch out of its source.
const src = fs.readFileSync(path.join(__dirname, '../../cli/src/hook.js'), 'utf8');
const body = src.match(/function parseModelSwitch\([\s\S]*?\r?\n}\r?\n/);
assert.ok(body, 'parseModelSwitch not found in hook.js');
const parseModelSwitch = new Function(`${body[0]}; return parseModelSwitch;`)();

const cmd = (args, out) => ({
  type: 'system', subtype: 'local_command',
  content: `<local-command-stdout>${out}</local-command-stdout>`,
  commandRun: { command: 'model', args },
});

test('reads the model a /model command set or kept', () => {
  assert.strictEqual(parseModelSwitch(cmd('claude-opus-4-8', 'Set model to `Opus 4.8` for this session only')), 'Opus 4.8');
  assert.strictEqual(parseModelSwitch(cmd('sonnet', 'Set model to `Sonnet 5.5` and saved as your default for new sessions')), 'Sonnet 5.5');
  assert.strictEqual(parseModelSwitch(cmd('', 'Kept model as `Opus 5.5`')), 'Opus 5.5');
});

test('ignores failed switches and unrelated entries', () => {
  assert.strictEqual(parseModelSwitch(cmd('haiky', "Model 'haiky' not found")), null);
  assert.strictEqual(parseModelSwitch({ type: 'system', commandRun: { command: 'effort' }, content: 'Set model to `X`' }), null);
  assert.strictEqual(parseModelSwitch({ type: 'assistant', message: { model: 'claude-opus-5-5' } }), null);
});
