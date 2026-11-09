'use strict';

// Dollar cost of a turn from its real tokens and the team's price table.
// Prices are USD per million tokens, per model family:
//   { opus: { input, output, cache_read, cache_write }, ... }
// shortcut: priced by family (fable/opus/sonnet/haiku), not by exact version; split
// the table by version when two versions of one family are priced differently.

const FAMILIES = ['fable', 'opus', 'sonnet', 'haiku'];
const FIELDS = ['input', 'output', 'cache_read', 'cache_write'];

/** Validate/normalize a price table from the admin; returns null when malformed. */
function sanitizePrices(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const fam of FAMILIES) {
    if (raw[fam] === undefined || raw[fam] === null) continue;
    if (typeof raw[fam] !== 'object') return null;
    const p = {};
    for (const f of FIELDS) {
      const v = raw[fam][f];
      if (v === undefined || v === null || v === '') continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return null;
      p[f] = n;
    }
    out[fam] = p;
  }
  return out;
}

function parsePrices(team) {
  try { return sanitizePrices(JSON.parse((team && team.prices) || '{}')) || {}; } catch { return {}; }
}

/** Price row for a family, or null when input/output are not set. */
function priceFor(prices, family) {
  const p = prices && prices[family];
  return p && p.input != null && p.output != null ? p : null;
}

function familyOf(modelOrVersion) {
  const m = String(modelOrVersion || '').split('-')[0];
  return FAMILIES.includes(m) ? m : null;
}

function cost(p, { input = 0, output = 0, cacheRead = 0, cacheCreation = 0 }) {
  const write = p.cache_write != null ? p.cache_write : p.input * 1.25;
  const read = p.cache_read != null ? p.cache_read : p.input * 0.1;
  const plainInput = Math.max(0, input - cacheCreation); // hook sums cache writes into input
  return (plainInput * p.input + cacheCreation * write + cacheRead * read + output * p.output) / 1e6;
}

/**
 * USD cost of one turn, or null when it cannot be priced (old hook without
 * tokens, or no price for the model). `subagents` is { "<version>": { input,
 * output, cache_read } }, already included in input/output: it is priced at its
 * own model and the remainder at the turn's model.
 */
function computeCostUsd(prices, { model, input, output, cacheRead, cacheCreation, subagents }) {
  if (input == null && output == null) return null;
  const mainPrice = priceFor(prices, model);
  if (!mainPrice) return null;

  const main = { input: input || 0, output: output || 0, cacheRead: cacheRead || 0, cacheCreation: cacheCreation || 0 };
  let total = 0;
  for (const [version, s] of Object.entries(subagents || {})) {
    const sub = { input: s.input || 0, output: s.output || 0, cacheRead: s.cache_read || 0 };
    main.input = Math.max(0, main.input - sub.input);
    main.output = Math.max(0, main.output - sub.output);
    main.cacheRead = Math.max(0, main.cacheRead - sub.cacheRead);
    total += cost(priceFor(prices, familyOf(version)) || mainPrice, sub);
  }
  main.cacheCreation = Math.min(main.cacheCreation, main.input);
  total += cost(mainPrice, main);
  return Math.round(total * 1e6) / 1e6;
}

module.exports = { FAMILIES, sanitizePrices, parsePrices, priceFor, computeCostUsd };
