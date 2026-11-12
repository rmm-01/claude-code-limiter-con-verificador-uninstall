'use strict';

// Prepaid Anthropic API credits of the ERP chat assistant (GestorMinera).
// Anthropic has no API for the credit balance, only a daily cost report. So the
// admin types the balance shown in Console plus the UTC day it was read, and
// the balance is that minus what the cost report adds up on the days after it.
// The ERP owns the Anthropic admin key; this server only gets spend figures
// from GET api/AsistenteConfiguracion/costo-real-externo (X-Limiter-Token).

const CACHE_MS = 10 * 60 * 1000; // the ERP and Anthropic already lag minutes behind
let cache = null; // { key, at, value }

const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(`${s}T00:00:00Z`));

/** Validate an admin-entered snapshot. Returns the clean snapshot or an error string. */
function parseSnapshot(body, todayIso) {
  const amount = Number(body && body.amount_usd);
  const date = body && body.date;
  if (body?.amount_usd === '' || body?.amount_usd == null || !Number.isFinite(amount) || amount < 0) {
    return 'El saldo debe ser un número >= 0';
  }
  if (!isDay(date)) return 'Fecha inválida (AAAA-MM-DD)';
  if (date > todayIso) return 'La fecha no puede ser futura';
  return { amount_usd: Math.round(amount * 100) / 100, date };
}

/** First day to ask the ERP for: the day after the snapshot or the 1st of the month, whichever is earlier. */
function fetchFrom(snapshot, todayIso) {
  const next = new Date(Date.parse(`${snapshot.date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const monthStart = `${todayIso.slice(0, 7)}-01`;
  return next < monthStart ? next : monthStart;
}

/**
 * The snapshot day itself is not subtracted: Console already showed what was
 * spent before the reading, and the report is daily, so the rest of that day is
 * lost. Read Console late in the UTC day (before 19:00 in Lima) to keep that small.
 * @param dias [{ fecha: ISO, usd }] from the ERP
 */
function computeCredits(snapshot, dias, todayIso) {
  const monthStart = `${todayIso.slice(0, 7)}-01`;
  let spentSince = 0;
  let month = 0;
  for (const d of dias || []) {
    const day = String(d.fecha).slice(0, 10);
    const usd = Number(d.usd) || 0;
    if (day > snapshot.date) spentSince += usd;
    if (day >= monthStart) month += usd;
  }
  const r = (n) => Math.round(n * 100) / 100;
  return { balance_usd: r(snapshot.amount_usd - spentSince), spent_since_usd: r(spentSince), month_usd: r(month) };
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
    return { dias: data.dias || [], consulted_at: data.consultadoUtc || null };
  } catch (err) {
    return { error: `No se pudo contactar al ERP: ${err.message}` };
  }
}

/** Full payload for the dashboard. Never throws. */
async function getApiCredits(snapshot, nowMs = Date.now()) {
  if (!snapshot) return { snapshot: null };
  const todayIso = new Date(nowMs).toISOString().slice(0, 10);
  const desde = fetchFrom(snapshot, todayIso);
  const key = `${desde}|${snapshot.date}|${snapshot.amount_usd}`;
  let erp;
  if (cache && cache.key === key && nowMs - cache.at < CACHE_MS) erp = cache.value;
  else {
    erp = await fetchErp(desde);
    // Errors are retried after a minute instead of ten.
    cache = { key, at: erp.error ? nowMs - CACHE_MS + 60000 : nowMs, value: erp };
  }
  if (erp.error) return { snapshot, error: erp.error };
  return { snapshot, ...computeCredits(snapshot, erp.dias, todayIso), consulted_at: erp.consulted_at };
}

function clearCache() { cache = null; }

module.exports = { parseSnapshot, fetchFrom, computeCredits, getApiCredits, clearCache };
