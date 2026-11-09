import { useState } from 'react';
import { api } from '../lib/api';
import type { Team, LimitMode, PriceTable } from '../lib/types';
import { Card, CardBody } from './Card';
import { Button } from './Button';

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

interface LimitModeSettingsProps {
  team: Team | null;
  onTeamUpdate: (team: Team) => void;
  showToast: (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

/** Team-wide limit mode (credits or dollars) and the USD-per-million-tokens price table. */
export function LimitModeSettings({ team, onTeamUpdate, showToast }: LimitModeSettingsProps) {
  const mode: LimitMode = team?.limit_mode ?? 'credits';
  const [prices, setPrices] = useState<Record<string, Record<string, string>>>(() =>
    Object.fromEntries(FAMILIES.map(([f]) => [f, Object.fromEntries(FIELDS.map(([k]) => [k, String(team?.prices?.[f]?.[k] ?? '')]))])),
  );
  const [saving, setSaving] = useState(false);

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

        <h4 className="text-sm font-medium text-zinc-300 mb-1">Precios por millón de tokens (USD)</h4>
        <p className="text-xs text-zinc-500 mb-3">
          Son equivalentes a precios de API, no lo que se cobra por la suscripción. Si dejas el caché vacío se usa 0.1× (lectura) y 1.25× (escritura) de la entrada.
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
        <Button size="sm" variant="primary" onClick={savePrices} disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar Precios'}
        </Button>
      </CardBody>
    </Card>
  );
}
