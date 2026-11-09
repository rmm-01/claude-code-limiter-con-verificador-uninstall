'use strict';

// The Claude subscription is shared, so every machine reports the same 5h / 7d
// windows, each from its own (slightly different) moment. Keeping only the last
// report let a late or low reading overwrite a newer one. Instead each user's
// latest reading is kept and the shown value is combined from the recent ones.

const FRESH_MS = 10 * 60 * 1000; // a reading older than this stops counting
const SAME_WINDOW_SEC = 300;     // resets_at of one window differs by seconds across machines

/** Combine one window across readings: newest window wins, highest use inside it. */
function combineWindow(readings, nowSec) {
  const live = readings.filter((r) => r && r.resets_at > nowSec);
  if (!live.length) return null;
  const newest = Math.max(...live.map((r) => r.resets_at));
  const same = live.filter((r) => r.resets_at >= newest - SAME_WINDOW_SEC);
  // used_percentage only grows inside a window, so the highest reading is the latest truth.
  return same.reduce((best, r) => (r.used_percentage > best.used_percentage ? r : best));
}

/**
 * @param {object} reports  { [userId]: { name, five_hour, seven_day, at(ms) } }
 * @returns {{ five_hour, seven_day, reported_by, reporters }}
 */
function combineReports(reports, nowMs) {
  const nowSec = nowMs / 1000;
  const fresh = Object.values(reports || {}).filter((r) => nowMs - r.at <= FRESH_MS);
  const five = combineWindow(fresh.map((r) => r.five_hour), nowSec);
  const seven = combineWindow(fresh.map((r) => r.seven_day), nowSec);
  const source = (win, key) => fresh.find((r) => r[key] === win);
  const lead = source(seven, 'seven_day') || source(five, 'five_hour') || fresh[fresh.length - 1];
  return {
    five_hour: five,
    seven_day: seven,
    reported_by: lead ? lead.name : null,
    reporters: fresh.map((r) => r.name),
  };
}

/** Drop stale readings so the stored map stays small. */
function pruneReports(reports, nowMs) {
  return Object.fromEntries(Object.entries(reports || {}).filter(([, r]) => nowMs - r.at <= FRESH_MS));
}

module.exports = { combineReports, pruneReports, FRESH_MS };
