'use strict';

// Dollar cost of a turn from its real tokens and the team's price table.
// Prices are USD per million tokens, per model family:
//   { opus: { input, output, cache_read, cache_write }, ... }
// shortcut: priced by family (fable/opus/sonnet/haiku), not by exact version; split
// the table by version when two versions of one family are priced differently.

const FAMILIES = ['fable', 'opus', 'sonnet', 'haiku'];

// Suggested prices (USD per million tokens): the newest version of each family on
// Anthropic's public pricing page (Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5 for
// prompts up to 100k tokens). Older versions cost more (e.g. Opus 5 is $5/$25,
// Sonnet 4.6 is $3/$15), so the admin can edit them in Settings.
const DEFAULT_PRICES = {
  fable: { input: 10, output: 50, cache_read: 0.25, cache_write: 12.5 },
  opus: { input: 4, output: 20, cache_read: 0.2, cache_write: 5 },
  sonnet: { input: 2, output: 10, cache_read: 0.1, cache_write: 2.5 },
  haiku: { input: 0.1, output: 0.5, cache_read: 0.01, cache_write: 0.125 },
};
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
  const nn = (n) => (Number.isFinite(n) && n > 0 ? n : 0); // never let a bad count lower the cost
  const write = p.cache_write != null ? p.cache_write : p.input * 1.25;
  const read = p.cache_read != null ? p.cache_read : p.input * 0.1;
  const creation = Math.min(nn(cacheCreation), nn(input)); // cache writes sit inside input
  const plainInput = nn(input) - creation;
  return Math.max(0, (plainInput * p.input + creation * write + nn(cacheRead) * read + nn(output) * p.output) / 1e6);
}

/**
 * Pessimistic price table for turns whose model has no price: every family at the
 * dearest configured one, so an unpriced model cannot be used to dodge a dollar limit.
 * Returns null when nothing is configured.
 */
function fallbackPrices(prices) {
  let best = null;
  for (const fam of FAMILIES) {
    const p = priceFor(prices, fam);
    if (p && (!best || p.output + p.input > best.output + best.input)) best = p;
  }
  return best ? Object.fromEntries(FAMILIES.map((f) => [f, best])) : null;
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
  // Unpriced subagent model: dearest configured row (as the hook does), not the turn's own.
  const dearest = (fallbackPrices(prices) || {}).opus || mainPrice;
  for (const [version, s] of Object.entries(subagents || {})) {
    const sub = { input: s.input || 0, output: s.output || 0, cacheRead: s.cache_read || 0, cacheCreation: s.cache_creation || 0 };
    main.input = Math.max(0, main.input - sub.input);
    main.cacheCreation = Math.max(0, main.cacheCreation - sub.cacheCreation);
    main.output = Math.max(0, main.output - sub.output);
    main.cacheRead = Math.max(0, main.cacheRead - sub.cacheRead);
    total += cost(priceFor(prices, familyOf(version)) || dearest, sub);
  }
  main.cacheCreation = Math.min(main.cacheCreation, main.input);
  total += cost(mainPrice, main);
  return Math.round(total * 1e6) / 1e6;
}

module.exports = { FAMILIES, DEFAULT_PRICES, sanitizePrices, parsePrices, priceFor, computeCostUsd, fallbackPrices };
