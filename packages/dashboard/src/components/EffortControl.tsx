import { api } from '../lib/api';
import type { User, EffortLevel } from '../lib/types';

const LEVELS: Array<[EffortLevel, string]> = [
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
  ['xhigh', 'XHigh'],
  ['max', 'Max (sin límite)'],
];

/** ultracode runs at xhigh, so it only gets through when the cap is xhigh or max. */
export function ultracodeAllowed(cap: EffortLevel | undefined): boolean {
  return cap === 'xhigh' || cap === 'max' || cap === undefined;
}

interface EffortControlProps {
  user: Pick<User, 'id' | 'name' | 'max_effort_level'>;
  onSaved: () => void;
  showToast: (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
  className?: string;
}

/** Per-user effort cap selector plus the ultracode status it implies. */
export function EffortControl({ user, onSaved, showToast, className }: EffortControlProps) {
  const cap = user.max_effort_level || 'max';
  const allowed = ultracodeAllowed(cap);

  const change = async (level: EffortLevel) => {
    try {
      await api.updateUser(user.id, { max_effort_level: level });
      showToast('Guardado', `Effort máximo de ${user.name}: ${level}`, 'success');
      onSaved();
    } catch (err) {
      showToast('Error', err instanceof Error ? err.message : 'No se pudo guardar', 'error');
    }
  };

  return (
    <div className={`flex items-center gap-3 flex-wrap ${className ?? ''}`} onClick={(e) => e.stopPropagation()}>
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">Effort máx</span>
      <select
        value={cap}
        onChange={(e) => change(e.target.value as EffortLevel)}
        className="rounded-md border border-zinc-700 bg-zinc-800/50 px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
      >
        {LEVELS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
      <span
        title="ultracode corre en xhigh: se bloquea con un tope High o menor"
        className={`text-xs ${allowed ? 'text-zinc-300' : 'text-red-400 line-through'}`}
      >
        ultracode
      </span>
    </div>
  );
}
