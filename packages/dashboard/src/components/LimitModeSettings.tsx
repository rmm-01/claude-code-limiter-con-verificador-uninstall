import { useState } from 'react';
import { api } from '../lib/api';
import type { Team, LimitMode, PriceTable } from '../lib/types';
import { Card, CardBody } from './Card';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';

const FAMILIES = [
  ['fable', 'Fable', 'bg-teal-400'],
  ['opus', 'Opus', 'bg-purple-500'],
  ['sonnet', 'Sonnet', 'bg-blue-500'],
  ['haiku', 'Haiku', 'bg-green-500'],
] as const;

const FIELDS = [
  ['input', 'Entrada'],
  ['output', 'Salida'],
  ['cache_read', 'Caché (lectura)'],
  ['cache_write', 'Caché (escritura)'],
] as const;

// Same table the server seeds: newest version of each family on Anthropic's pricing page.
const SUGGESTED: PriceTable = {
  fable: { input: 10, output: 50, cache_read: 0.25, cache_write: 12.5 },
  opus: { input: 4, output: 20, cache_read: 0.2, cache_write: 5 },
  sonnet: { input: 2, output: 10, cache_read: 0.1, cache_write: 2.5 },
  haiku: { input: 0.1, output: 0.5, cache_read: 0.01, cache_write: 0.125 },
};

const toForm = (t?: PriceTable) =>
  Object.fromEntries(FAMILIES.map(([f]) => [f, Object.fromEntries(FIELDS.map(([k]) => [k, String(t?.[f]?.[k] ?? '')]))]));

const windowLabel: Record<string, string> = { daily: 'diario', weekly: 'semanal', monthly: 'mensual', sliding_24h: 'últimas 24h' };

interface LimitModeSettingsProps {
  team: Team | null;
  onTeamUpdate: (team: Team) => void;
  showToast: (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

/** Team-wide limit mode (credits or dollars) and the USD-per-million-tokens price table. */
export function LimitModeSettings({ team, onTeamUpdate, showToast }: LimitModeSettingsProps) {
  const mode: LimitMode = team?.limit_mode ?? 'credits';
  const [prices, setPrices] = useState<Record<string, Record<string, string>>>(() => toForm(team?.prices));
  const [saving, setSaving] = useState(false);
  const [budget, setBudget] = useState('10');
  const [budgetWindow, setBudgetWindow] = useState('daily');
  const [confirmBudget, setConfirmBudget] = useState(false);

  const applyBudget = async () => {
    setSaving(true);
    try {
      const res = await api.setTeamDollarBudget(Number(budget), budgetWindow);
      showToast('Presupuesto aplicado', `US$${Number(budget).toFixed(2)} (${windowLabel[budgetWindow]}) para ${res.updated} usuarios`, 'success');
      setConfirmBudget(false);
    } catch (err) {
      showToast('Error', err instanceof Error ? err.message : 'No se pudo aplicar', 'error');
    } finally {
      setSaving(false);
    }
  };
  const budgetValid = budget !== '' && Number.isFinite(Number(budget)) && (Number(budget) >= 0 || Number(budget) === -1);

  const apply = async (payload: { limit_mode?: LimitMode; prices?: PriceTable }, okMsg: string) => {
    setSaving(true);
    try {
      const res = await api.updateSettings(payload);
      api.setStoredTeam(res.team);
      onTeamUpdate(res.team);
      showToast('Guardado', okMsg, 'success');
    } catch (err) {
      showToast('Error', err instanceof Error ? err.message : 'No se pudo guardar', 'error');
    } finally {
      setSaving(false);
    }
  };

  const savePrices = () => {
    const table: PriceTable = {};
    for (const [f] of FAMILIES) {
      const row: Record<string, number> = {};
      for (const [k] of FIELDS) {
        const raw = prices[f]?.[k];
        if (raw !== undefined && raw !== '') row[k] = Number(raw);
      }
      if (Object.keys(row).length) table[f] = row;
    }
    apply({ prices: table }, 'Precios guardados; el historial con tokens y sin costo se recalculó');
  };

  const missing = FAMILIES.filter(([f]) => {
    const p = team?.prices?.[f];
    return !p || p.input == null || p.output == null;
  }).map(([, label]) => label);

  return (
    <Card>
      <CardBody>
        <h3 className="text-sm font-semibold text-zinc-200 mb-1">Modo de Límites</h3>
        <p className="text-xs text-zinc-500 mb-4">
          Define cómo se limita el consumo por defecto. Cada usuario puede usar otro modo desde «Editar Límites».
          Los límites del modo que no está activo se conservan, pero no se aplican.
        </p>
        <div className="inline-flex rounded-lg border border-zinc-700 overflow-hidden mb-5">
          {(['dollars', 'credits'] as const).map((m) => (
            <button
              key={m}
              disabled={saving}
              onClick={() => m !== mode && apply({ limit_mode: m }, `Modo del equipo: ${m === 'dollars' ? 'dólares' : 'créditos'}`)}
              className={`px-4 py-1.5 text-sm cursor-pointer transition-colors ${
                mode === m ? 'bg-[#cc5500] text-white' : 'bg-zinc-800/50 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {m === 'dollars' ? 'Dólares' : 'Créditos'}
            </button>
          ))}
        </div>

        {mode === 'dollars' && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-800/30 p-4 mb-5">
            <h4 className="text-sm font-medium text-zinc-300 mb-1">Presupuesto para todo el equipo</h4>
            <p className="text-xs text-zinc-500 mb-3">
              Fija el mismo presupuesto en dólares a todos los usuarios (reemplaza el de cada uno). Después puedes ajustar el de cada persona en «Editar Límites». -1 = ilimitado.
            </p>
            <div className="grid grid-cols-3 gap-3 items-end">
              <label className="block text-sm text-zinc-300 space-y-1.5">
                <span>Valor en US$</span>
                <input
                  type="number"
                  step="0.01"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </label>
              <label className="block text-sm text-zinc-300 space-y-1.5">
                <span>Ventana</span>
                <select
                  value={budgetWindow}
                  onChange={(e) => setBudgetWindow(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                >
                  <option value="daily">Diaria</option>
                  <option value="weekly">Semanal</option>
                  <option value="monthly">Mensual</option>
                  <option value="sliding_24h">Últimas 24h</option>
                </select>
              </label>
              <Button size="sm" variant="primary" disabled={saving || !budgetValid} onClick={() => setConfirmBudget(true)}>
                Aplicar a todo el equipo
              </Button>
            </div>
          </div>
        )}
        <ConfirmDialog
          open={confirmBudget}
          onClose={() => setConfirmBudget(false)}
          onConfirm={applyBudget}
          title="Aplicar presupuesto al equipo"
          message={`Se fijará ${Number(budget) === -1 ? 'presupuesto ilimitado' : `US$${Number(budget).toFixed(2)} (${windowLabel[budgetWindow]})`} a todos los usuarios, reemplazando su presupuesto en dólares actual.`}
          confirmLabel="Aplicar"
          variant="warning"
          loading={saving}
        />

        <h4 className="text-sm font-medium text-zinc-300 mb-1">Precios por millón de tokens (USD)</h4>
        <p className="text-xs text-zinc-500 mb-3">
          Son equivalentes a precios de API, no lo que se cobra por la suscripción. Los valores sugeridos son los de las versiones más recientes
          (Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5); las versiones anteriores cuestan más, así que ajústalos si las usan. Si dejas el caché vacío se usa 0.1× (lectura) y 1.25× (escritura) de la entrada.
        </p>
        <div className="space-y-2 mb-4">
          <div className="grid grid-cols-5 gap-2 text-xs text-zinc-500">
            <span />
            {FIELDS.map(([k, label]) => <span key={k} className="text-center">{label}</span>)}
          </div>
          {FAMILIES.map(([f, label, color]) => (
            <div key={f} className="grid grid-cols-5 gap-2 items-center">
              <span className="flex items-center gap-2 text-sm text-zinc-300">
                <span className={`w-2.5 h-2.5 rounded-full ${color}`} />{label}
              </span>
              {FIELDS.map(([k]) => (
                <input
                  key={k}
                  type="number"
                  min="0"
                  step="0.01"
                  value={prices[f]?.[k] ?? ''}
                  onChange={(e) => setPrices((p) => ({ ...p, [f]: { ...p[f], [k]: e.target.value } }))}
                  className="w-full text-center rounded-md border border-zinc-700 bg-zinc-800/50 px-2 py-1.5 text-sm font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              ))}
            </div>
          ))}
        </div>
        {missing.length > 0 && (
          <p className="text-xs text-yellow-400 mb-3">
            Sin precio de entrada y salida para: {missing.join(', ')}. Esos turnos no se pueden valorar y cuentan como US$0.
          </p>
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="primary" onClick={savePrices} disabled={saving}>
            {saving ? 'Guardando...' : 'Guardar Precios'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPrices(toForm(SUGGESTED))} disabled={saving}>
            Restaurar sugeridos
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
