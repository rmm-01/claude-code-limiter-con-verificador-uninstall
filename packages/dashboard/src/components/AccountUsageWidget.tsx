import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { ws } from '../lib/ws';
import type { AccountUsage, RateWindow } from '../lib/types';

const OPEN_KEY = 'account_usage_widget_open';
const SEGMENTS = 10;
const MUTE_KEY = 'account_usage_widget_muted';

let audioCtx: AudioContext | null = null;

/** Browsers keep audio locked until a user gesture: create/resume the context on the first one. */
function unlockAudio() {
  try {
    audioCtx ??= new AudioContext();
    void audioCtx.resume();
  } catch { /* no audio available */ }
}

/** Short two-tone chime. Browsers keep audio locked until the page has had a click/keypress; then it stays silent. */
function playChime() {
  try {
    if (audioCtx?.state !== 'running') return; // unlocked by unlockAudio() after the first click
    const t0 = audioCtx.currentTime;
    [660, 880].forEach((freq, i) => {
      const osc = audioCtx!.createOscillator();
      const gain = audioCtx!.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.12, t0 + i * 0.12 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.12 + 0.11);
      osc.connect(gain).connect(audioCtx!.destination);
      osc.start(t0 + i * 0.12);
      osc.stop(t0 + i * 0.12 + 0.12);
    });
  } catch { /* no audio available */ }
}

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

function WindowRow({ label, w, nowSec, onFill }: { label: string; w: RateWindow | null; nowSec: number; onFill: () => void }) {
  const pct = effectivePct(w, nowSec);
  const filledNow = pct === null ? null : Math.round((pct / 100) * SEGMENTS);
  const [prevFilled, setPrevFilled] = useState<number | null>(filledNow);
  const [pulseIdx, setPulseIdx] = useState<number | null>(null);

  // A new square filled since the last reading (not on first load, not when it drops).
  // Derived while rendering, so no setState runs inside an effect.
  if (filledNow !== prevFilled) {
    setPrevFilled(filledNow);
    if (prevFilled !== null && filledNow !== null && filledNow > prevFilled) setPulseIdx(filledNow - 1);
  }

  useEffect(() => {
    if (pulseIdx === null) return;
    onFill();
    const t = setTimeout(() => setPulseIdx(null), 1600);
    return () => clearTimeout(t);
  }, [pulseIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  if (pct === null || !w) {
    return (
      <div className="flex items-center gap-3 text-xs">
        <span className="w-6 text-zinc-500">{label}</span>
        <span className="text-zinc-600">sin datos</span>
      </div>
    );
  }
  const color = pctColor(pct);
  const filled = filledNow ?? 0;
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-6 text-zinc-500">{label}</span>
      <div className="flex gap-0.5">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <div key={i} className={`w-3 h-3 rounded-sm ${i < filled ? color.bar : 'bg-zinc-700'} ${i === pulseIdx ? 'animate-segment-pulse' : ''}`} />
        ))}
      </div>
      <span className={`font-mono ${color.text}`}>
        {pct}% · {formatRemaining(w.resets_at - nowSec)}
      </span>
    </div>
  );
}

/**
 * Floating corner widget with the shared Claude account's weekly (7d) usage, as
 * last reported by any client's statusLine. Collapses to a pill; the
 * open/closed state is remembered across reloads.
 */
export function AccountUsageWidget() {
  const [usage, setUsage] = useState<AccountUsage | null>(null);
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) !== '0');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
  }, []);

  // Live: listen to the WebSocket directly (a shared "last event" slot dropped
  // reports that arrived together with other events), refetch on every
  // (re)connect since events sent while disconnected are lost, and poll as a
  // safety net for connections that die silently.
  useEffect(() => {
    const refetch = () => { api.getAccountUsage().then((res) => setUsage(res.usage)).catch(() => {}); };
    refetch();
    const unsub = ws.onEvent((evt) => {
      if (evt.type === 'account_usage' && evt.usage) setUsage(evt.usage);
      else if (evt.type === 'ws_connected') refetch();
    });
    const poll = setInterval(() => { if (!document.hidden) refetch(); }, 30000);
    const onVisible = () => { if (!document.hidden) refetch(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsub();
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Countdowns and "updated ago" tick without new data.
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const [muted, setMuted] = useState(() => localStorage.getItem(MUTE_KEY) === '1');
  const lastChime = useRef(0);
  // Both windows can fill in one update: one chime is enough.
  const onFill = () => {
    if (muted || Date.now() - lastChime.current < 500) return;
    lastChime.current = Date.now();
    playChime();
  };
  const toggleMute = () => {
    setMuted((v) => {
      localStorage.setItem(MUTE_KEY, v ? '0' : '1');
      return !v;
    });
  };

  const toggle = () => {
    setOpen((v) => {
      localStorage.setItem(OPEN_KEY, v ? '0' : '1');
      return !v;
    });
  };

  const nowSec = Math.floor(nowMs / 1000);
  const seven = effectivePct(usage?.seven_day ?? null, nowSec);

  if (!open) {
    const color = pctColor(seven ?? 0);
    return (
      <button
        onClick={toggle}
        title="Uso de la cuenta Claude"
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/95 px-3 py-1.5 text-xs font-mono shadow-lg hover:border-zinc-500 transition-colors"
      >
        <span className={`w-2 h-2 rounded-full ${usage ? color.bar : 'bg-zinc-600'}`} />
        <span className="text-zinc-400">7d</span>
        <span className="text-zinc-200">{seven === null ? '–' : `${seven}%`}</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-72 rounded-lg border border-zinc-700 bg-zinc-900/95 shadow-lg animate-fade-in">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <span className="text-xs font-semibold text-zinc-300">Uso de la cuenta Claude</span>
        <div className="flex items-center gap-1">
          <button onClick={toggleMute} title={muted ? 'Activar sonido' : 'Silenciar'} className="text-zinc-500 hover:text-zinc-200 text-xs leading-none px-1">
            {muted ? '🔕' : '🔔'}
          </button>
          <button onClick={toggle} title="Minimizar" className="text-zinc-500 hover:text-zinc-200 text-sm leading-none px-1">
            –
          </button>
        </div>
      </div>
      <div className="px-3 py-3 space-y-2">
        <WindowRow label="7d" w={usage?.seven_day ?? null} nowSec={nowSec} onFill={onFill} />
      </div>
      <div className="px-3 pb-2 text-[11px] text-zinc-500">
        {usage
          ? `Actualizado ${formatAgo(usage.updated_at, nowMs)} · ${usage.reported_by}`
          : 'Sin reportes aún: llegan desde el statusLine de los clientes actualizados.'}
      </div>
    </div>
  );
}
