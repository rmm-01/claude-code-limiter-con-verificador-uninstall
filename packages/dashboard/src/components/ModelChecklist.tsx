import { api } from '../lib/api';
import type { User } from '../lib/types';

const MODELS = ['fable', 'opus', 'sonnet', 'haiku'];

interface ModelChecklistProps {
  user: Pick<User, 'id' | 'name' | 'limits'>;
  onSaved: () => void;
  showToast: (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
  className?: string;
}

/** Per-user allowed-models checklist: unticked = a per_model rule of value 0, saved on change. */
export function ModelChecklist({ user, onSaved, showToast, className }: ModelChecklistProps) {
  const limits = user.limits ?? [];

  const toggle = async (model: string, allowed: boolean) => {
    const rest = limits.filter((r) => !(r.type === 'per_model' && r.model === model));
    const next = allowed ? rest : [...rest, { type: 'per_model' as const, model, window: 'daily', value: 0 }];
    try {
      await api.updateUser(user.id, { limits: next });
      showToast('Modelos actualizados', `${model} ${allowed ? 'permitido' : 'bloqueado'} para ${user.name}`, allowed ? 'success' : 'warning');
      onSaved();
    } catch (err) {
      showToast('Error', err instanceof Error ? err.message : 'No se pudo guardar', 'error');
    }
  };

  return (
    <div className={`flex items-center gap-3 flex-wrap ${className ?? ''}`} onClick={(e) => e.stopPropagation()}>
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">Modelos permitidos</span>
      {MODELS.map((m) => {
        const blocked = limits.some((r) => r.type === 'per_model' && r.value === 0 && (!r.model || r.model === m));
        return (
          <label key={m} className={`flex items-center gap-1 text-xs capitalize cursor-pointer ${blocked ? 'text-red-400' : 'text-zinc-300'}`}>
            <input type="checkbox" checked={!blocked} onChange={(e) => toggle(m, e.target.checked)} />
            {m}
          </label>
        );
      })}
    </div>
  );
}
