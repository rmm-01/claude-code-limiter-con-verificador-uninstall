/* ================================================================
   Shared utility functions
   ================================================================ */

export function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return 'never';
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  if (diff < 0) return 'just now';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export function formatDay(day: string): string {
  if (!day) return '';
  const parts = day.split('-');
  if (parts.length < 3) return day;
  return `${parts[1]}/${parts[2]}`;
}

export function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hues = [210, 150, 340, 40, 280, 180, 20, 100, 300, 60];
  const hue = hues[Math.abs(hash) % hues.length];
  return `hsl(${hue}, 60%, 55%)`;
}

export function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export function usagePct(used: number, limit: number): number {
  if (limit <= 0) return 0;
  const p = used / limit;
  return p > 1 ? 1 : p;
}

export function getModelLimit(
  limits: Array<{ type: string; model?: string; window?: string; value?: number }>,
  model: string,
  windowType: string = 'daily',
): number {
  for (const r of limits) {
    if (r.type === 'per_model' && r.model === model && r.window === windowType) {
      return r.value ?? -1;
    }
  }
  return -1;
}

export function getCreditRule(
  limits: Array<{ type: string; window?: string; value?: number }>,
): { type: string; window?: string; value?: number } | null {
  return limits.find((r) => r.type === 'credits') ?? null;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // Fallback
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      resolve();
    } catch {
      reject(new Error('Copy failed'));
    } finally {
      document.body.removeChild(ta);
    }
  });
}

/** 950 → "950", 12_345 → "12.3k", 4_038_609 → "4.04M" */
export function formatTokens(n: number | null | undefined): string {
  const v = n ?? 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 1 : 2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(v >= 100_000 ? 0 : 1)}k`;
  return String(v);
}

/** Shown wherever tokens are expected but the turn came from a pre-1.5 hook. */
export const TOKENS_NA = 'n/d';
export const TOKENS_NA_HINT = 'Sin datos de tokens: turnos registrados por un hook anterior a v1.5. Reinstalá el limiter en la máquina para medir tokens reales.';

/**
 * Live-feed text for a counted turn: "opus-4-6 (+10 créditos · 12.3k tokens)".
 * Falls back to the family, and to "tokens n/d" for events from older hooks.
 */
export function countedDetail(
  model: string | undefined,
  version: string | null | undefined,
  credits: number | undefined,
  inputTokens?: number | null,
  outputTokens?: number | null,
): string {
  const tokens = inputTokens != null || outputTokens != null
    ? `${formatTokens((inputTokens ?? 0) + (outputTokens ?? 0))} tokens`
    : `tokens ${TOKENS_NA}`;
  return `${version || model || ''} (+${credits ?? 0} créditos · ${tokens})`;
}

let feedIdCounter = 0;
export function nextFeedId(): string {
  return `feed-${++feedIdCounter}-${Date.now()}`;
}
