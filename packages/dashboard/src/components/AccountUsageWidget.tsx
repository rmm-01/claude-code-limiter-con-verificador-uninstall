import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { AccountUsage, RateWindow, WSEvent } from '../lib/types';

const OPEN_KEY = 'account_usage_widget_open';
const SEGMENTS = 10;

/** Percentage to show: a window whose reset already passed counts as 0. */
function effectivePct(w: RateWindow | null, nowSec: number): number | null {
  if (!w) return null;
  if (w.resets_at <= nowSec) return 0;
  return Math.round(w.used_percentage);
}

function pctColor(pct: number): { bar: string; text: string } {
  if (pct >= 80) return { bar: 'bg-red-500', text: 'text-red-400' };
  if (pct >= 50) return { bar: 'bg-orange-400', text: 'text-orange-300' };
  return { bar: 'bg-emerald-500', text: 'text-emerald-400' };
}

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return 'reiniciado';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(m, 1)}m`;
}

function formatAgo(iso: string, nowMs: number): string {
  const min = Math.floor((nowMs - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

function WindowRow({ label, w, nowSec }: { label: string; w: RateWindow | null; nowSec: number }) {
  const pct = effectivePct(w, nowSec);
  if (pct === null || !w) {
    return (
      <div className="flex items-center gap-3 text-xs">
        <span className="w-6 text-zinc-500">{label}</span>
        <span className="text-zinc-600">sin datos</span>
      </div>
    );
  }
  const color = pctColor(pct);
  const filled = Math.round((pct / 100) * SEGMENTS);
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-6 text-zinc-500">{label}</span>
      <div className="flex gap-0.5">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <div key={i} className={`w-3 h-3 rounded-sm ${i < filled ? color.bar : 'bg-zinc-700'}`} />
        ))}
      </div>
      <span className={`font-mono ${color.text}`}>
        {pct}% · {formatRemaining(w.resets_at - nowSec)}
      </span>
    </div>
  );
}

/**
 * Floating corner widget with the shared Claude account's 5h / 7d usage, as
 * last reported by any client's statusLine. Collapses to a pill; the
 * open/closed state is remembered across reloads.
 */
export function AccountUsageWidget({ lastEvent }: { lastEvent: WSEvent | null }) {
  const [usage, setUsage] = useState<AccountUsage | null>(null);
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) !== '0');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    api.getAccountUsage().then((res) => setUsage(res.usage)).catch(() => {});
  }, []);

  useEffect(() => {
    if (lastEvent?.type === 'account_usage' && lastEvent.usage) setUsage(lastEvent.usage);
  }, [lastEvent]);

  // Countdowns and "updated ago" tick without new data.
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const toggle = () => {
    setOpen((v) => {
      localStorage.setItem(OPEN_KEY, v ? '0' : '1');
      return !v;
    });
  };

  const nowSec = Math.floor(nowMs / 1000);
  const five = effectivePct(usage?.five_hour ?? null, nowSec);
  const seven = effectivePct(usage?.seven_day ?? null, nowSec);

  if (!open) {
    const worst = Math.max(five ?? 0, seven ?? 0);
    const color = pctColor(worst);
    return (
      <button
        onClick={toggle}
        title="Uso de la cuenta Claude"
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/95 px-3 py-1.5 text-xs font-mono shadow-lg hover:border-zinc-500 transition-colors"
      >
        <span className={`w-2 h-2 rounded-full ${usage ? color.bar : 'bg-zinc-600'}`} />
        <span className="text-zinc-400">5h</span>
        <span className="text-zinc-200">{five === null ? '–' : `${five}%`}</span>
        <span className="text-zinc-600">·</span>
        <span className="text-zinc-400">7d</span>
        <span className="text-zinc-200">{seven === null ? '–' : `${seven}%`}</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-72 rounded-lg border border-zinc-700 bg-zinc-900/95 shadow-lg animate-fade-in">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <span className="text-xs font-semibold text-zinc-300">Uso de la cuenta Claude</span>
        <button onClick={toggle} title="Minimizar" className="text-zinc-500 hover:text-zinc-200 text-sm leading-none px-1">
          –
        </button>
      </div>
      <div className="px-3 py-3 space-y-2">
        <WindowRow label="5h" w={usage?.five_hour ?? null} nowSec={nowSec} />
        <WindowRow label="7d" w={usage?.seven_day ?? null} nowSec={nowSec} />
      </div>
      <div className="px-3 pb-2 text-[11px] text-zinc-500">
        {usage
          ? `Actualizado ${formatAgo(usage.updated_at, nowMs)} · ${usage.reported_by}`
          : 'Sin reportes aún: llegan desde el statusLine de los clientes actualizados.'}
      </div>
    </div>
  );
}
