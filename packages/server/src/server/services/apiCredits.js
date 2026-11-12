'use strict';

// Prepaid Anthropic API credits of the ERP chat assistant (GestorMinera).
// Anthropic has no API for the balance, only a daily cost report. Two pools:
// - the plan credit (Ultra: US$200 granted on credit_day, expires at the next grant),
// - purchased credits ("Añadir fondos", never expire).
// The admin types the TOTAL balance shown in Console and the UTC day it was read.
// The plan credit is assumed to be spent first (it is the one that expires), so the
// purchased part is what Console showed above the plan credit left on that day.
// The ERP owns the Anthropic admin key; this server only gets spend figures
// from GET api/AsistenteConfiguracion/costo-real-externo (X-Limiter-Token).

// Today comes from the ERP's per-reply estimate (Anthropic reports a day only the next
// day), so it changes by the minute; the ERP keeps its own 10 min cache of the report.
const CACHE_MS = 60 * 1000;
const DAY_MS = 86400000;
let cache = null; // { key, at, value }

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(`${s}T00:00:00Z`));
const r2 = (n) => Math.round(n * 100) / 100;

/** Grant day of the plan cycle that contains `day` (credit_day clamped to the month length, e.g. 31 → Feb 28). */
function cycleStart(day, creditDay) {
  const [y, m] = day.split('-').map(Number);
  const grant = (yy, mm) => iso(Date.UTC(yy, mm - 1, Math.min(creditDay, new Date(Date.UTC(yy, mm, 0)).getUTCDate())));
  const here = grant(y, m);
  return here <= day ? here : grant(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1);
}

/** Next grant after the cycle that contains `day` (cycles last 28-31 days, so +32 lands in the next one). */
const nextGrant = (day, creditDay) => cycleStart(iso(Date.parse(`${cycleStart(day, creditDay)}T00:00:00Z`) + 32 * DAY_MS), creditDay);

/** Validate an admin-entered snapshot. Returns the clean snapshot or an error string. */
function parseSnapshot(body, todayIso) {
  const amount = Number(body && body.amount_usd);
  const date = body && body.date;
  if (body?.amount_usd === '' || body?.amount_usd == null || !Number.isFinite(amount) || amount < 0) {
    return 'El saldo debe ser un número >= 0';
  }
  if (!isDay(date)) return 'Fecha inválida (AAAA-MM-DD)';
  if (date > todayIso) return 'La fecha no puede ser futura';
  const credit = body.credit_usd == null || body.credit_usd === '' ? 0 : Number(body.credit_usd);
  const creditDay = body.credit_day == null || body.credit_day === '' ? 1 : Number(body.credit_day);
  if (!Number.isFinite(credit) || credit < 0) return 'El crédito mensual debe ser un número >= 0';
  if (!Number.isInteger(creditDay) || creditDay < 1 || creditDay > 31) return 'Día de renovación inválido (1-31)';
  return { amount_usd: r2(amount), date, credit_usd: r2(credit), credit_day: creditDay };
}

/** First day to ask the ERP for: start of the snapshot's plan cycle or the 1st of this month, whichever is earlier. */
function fetchFrom(snapshot, todayIso) {
  const start = cycleStart(snapshot.date, snapshot.credit_day || 1);
  const monthStart = `${todayIso.slice(0, 7)}-01`;
  return start < monthStart ? start : monthStart;
}

/**
 * The whole snapshot day counts as already reflected in Console: the report is
 * daily, so what is spent that day after the reading is lost. Read Console late
 * in the UTC day (before 19:00 in Lima) to keep that small.
 * @param dias [{ fecha: ISO, usd }] from the ERP
 */
function computeCredits(snapshot, dias, todayIso) {
  const credit = snapshot.credit_usd || 0;
  const cd = snapshot.credit_day || 1;
  const monthStart = `${todayIso.slice(0, 7)}-01`;
  const snapCycle = cycleStart(snapshot.date, cd);
  const byCycle = new Map(); // cycle start -> spend
  let before = 0; // spend of the snapshot's cycle up to the snapshot day
  let spentSince = 0;
  let month = 0;
  for (const d of dias || []) {
    const day = String(d.fecha).slice(0, 10);
    const usd = Number(d.usd) || 0;
    if (day >= monthStart) month += usd;
    if (day > snapshot.date) spentSince += usd;
    const c = cycleStart(day, cd);
    if (c < snapCycle) continue;
    byCycle.set(c, (byCycle.get(c) || 0) + usd);
    if (day <= snapshot.date) before += usd;
  }
  let purchased = Math.max(0, snapshot.amount_usd - Math.max(0, credit - before));
  // Each cycle, only what goes past the plan credit comes out of purchased credits.
  for (const [c, spend] of byCycle) {
    const over = Math.max(0, spend - credit);
    purchased -= c === snapCycle ? over - Math.max(0, before - credit) : over;
  }
  purchased = Math.max(0, purchased); // Anthropic rejects calls at 0, it never goes negative
  const plan = Math.max(0, credit - (byCycle.get(cycleStart(todayIso, cd)) || 0));
  return {
    balance_usd: r2(purchased + plan),
    purchased_usd: r2(purchased),
    plan_left_usd: r2(plan),
    plan_renews: credit > 0 ? nextGrant(todayIso, cd) : null,
    spent_since_usd: r2(spentSince),
    month_usd: r2(month),
  };
}

async function fetchErp(desde) {
  const base = process.env.ERP_API_URL;
  const token = process.env.ERP_LIMITER_TOKEN;
  if (!base || !token) return { error: 'Falta configurar ERP_API_URL y ERP_LIMITER_TOKEN en el servidor.' };
  const url = `${base.replace(/\/+$/, '')}/AsistenteConfiguracion/costo-real-externo?desde=${desde}`;
  try {
    const res = await fetch(url, { headers: { 'X-Limiter-Token': token }, signal: AbortSignal.timeout(20000) });
    if (res.status === 401) return { error: 'El ERP rechazó el token (ERP_LIMITER_TOKEN distinto de Limiter__Token).' };
    if (res.status === 404) return { error: 'El ERP no tiene configurado Limiter__Token, o la URL es incorrecta.' };
    if (!res.ok) return { error: `El ERP respondió HTTP ${res.status}.` };
    const data = await res.json();
    if (!data.disponible) return { error: data.motivo || 'El ERP no pudo leer el informe de costos.' };
    return { dias: data.dias || [], consulted_at: data.consultadoUtc || null, today_estimated_usd: data.hoyEstimadoUsd ?? null };
  } catch (err) {
    return { error: `No se pudo contactar al ERP: ${err.message}` };
  }
}

/** Full payload for the dashboard. Never throws. */
async function getApiCredits(snapshot, nowMs = Date.now()) {
  if (!snapshot) return { snapshot: null };
  const todayIso = new Date(nowMs).toISOString().slice(0, 10);
  const desde = fetchFrom(snapshot, todayIso);
  const key = `${desde}|${JSON.stringify(snapshot)}`;
  let erp;
  if (cache && cache.key === key && nowMs - cache.at < CACHE_MS) erp = cache.value;
  else {
    erp = await fetchErp(desde);
    cache = { key, at: nowMs, value: erp };
  }
  if (erp.error) return { snapshot, error: erp.error };
  return { snapshot, ...computeCredits(snapshot, erp.dias, todayIso), consulted_at: erp.consulted_at, today_estimated_usd: erp.today_estimated_usd };
}

function clearCache() { cache = null; }

module.exports = { parseSnapshot, cycleStart, fetchFrom, computeCredits, getApiCredits, clearCache };
