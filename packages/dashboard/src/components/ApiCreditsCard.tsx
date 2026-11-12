import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { ApiCredits } from '../lib/types';
import { formatUsd } from '../lib/utils';
import { Card, CardHeader, CardBody } from './Card';
import { Button } from './Button';
import { Input } from './Input';

const REFRESH_MS = 60 * 1000;
const todayUtc = () => new Date().toISOString().slice(0, 10);

/**
 * Prepaid Anthropic API credits of the ERP chat assistant. Anthropic has no API
 * for the balance, so the admin enters the one shown in Console and the server
 * subtracts what the ERP's cost report adds up on the following days.
 */
export function ApiCreditsCard() {
  const [data, setData] = useState<ApiCredits | null>(null);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayUtc());
  const [creditUsd, setCreditUsd] = useState('0');
  const [creditDay, setCreditDay] = useState('1');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    const load = () => api.getApiCredits().then(setData).catch(() => {});
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const save = async () => {
    setSaving(true);
    setFormError('');
    try {
      setData(await api.setApiCredits({ amount_usd: Number(amount), date, credit_usd: Number(creditUsd || 0), credit_day: Number(creditDay || 1) }));
      setEditing(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  const openForm = () => {
    setAmount(data?.snapshot ? String(data.snapshot.amount_usd) : '');
    setDate(todayUtc());
    setCreditUsd(String(data?.snapshot?.credit_usd ?? 0));
    setCreditDay(String(data?.snapshot?.credit_day ?? 1));
    setFormError('');
    setEditing(true);
  };

  const low = data?.balance_usd !== undefined && data.balance_usd < 20;

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-zinc-200">Créditos API — Asistente del ERP</h3>
        {!editing && (
          <Button variant="ghost" size="sm" onClick={openForm}>
            Actualizar saldo
          </Button>
        )}
      </CardHeader>
      <CardBody>
        {editing ? (
          <div className="space-y-3">
            <p className="text-xs text-zinc-400">
              Copia «Créditos de la organización» de Anthropic Console (el total, con el crédito del plan incluido). Mejor al final del día laboral (antes de las 19:00 de Lima, que es fin del día UTC): lo que se gaste ese mismo día después de la lectura no se descuenta. Solo hace falta volver a hacerlo al comprar créditos: la renovación del plan se calcula sola.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Saldo en Console (US$)" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <Input label="Fecha de la lectura (UTC)" type="date" max={todayUtc()} value={date} onChange={(e) => setDate(e.target.value)} />
              <Input label="Crédito mensual del plan (US$)" hint="Ultra: 200. Sin plan: 0." type="number" min="0" step="0.01" value={creditUsd} onChange={(e) => setCreditUsd(e.target.value)} />
              <Input label="Día de renovación del crédito" hint="«Próximo crédito» en la página de tu plan." type="number" min="1" max="31" step="1" value={creditDay} onChange={(e) => setCreditDay(e.target.value)} />
            </div>
            {formError && <p className="text-xs text-red-400">{formError}</p>}
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancelar</Button>
              <Button variant="primary" size="sm" onClick={save} disabled={saving || amount === ''}>
                {saving ? 'Guardando…' : 'Guardar'}
              </Button>
            </div>
          </div>
        ) : !data ? (
          <p className="text-sm text-zinc-500">Cargando…</p>
        ) : !data.snapshot ? (
          <p className="text-sm text-zinc-400">Todavía no hay saldo. Pulsa «Actualizar saldo» e ingresa el que muestra Console.</p>
        ) : data.error ? (
          <div className="space-y-1">
            <p className="text-sm text-red-400">{data.error}</p>
            <p className="text-xs text-zinc-500">Último saldo ingresado: {formatUsd(data.snapshot.amount_usd)} el {data.snapshot.date}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-zinc-500">Saldo estimado</div>
              <div className={`text-2xl font-semibold ${low ? 'text-red-400' : 'text-zinc-100'}`}>{formatUsd(data.balance_usd)}</div>
              <div className="text-xs text-zinc-500 mt-1 space-y-0.5">
                {data.snapshot.credit_usd > 0 ? (
                  <>
                    <div>Plan: {formatUsd(data.plan_left_usd)} de {formatUsd(data.snapshot.credit_usd)}, se renueva el {data.plan_renews} (lo no usado vence)</div>
                    <div>Comprados: {formatUsd(data.purchased_usd)}</div>
                  </>
                ) : (
                  <div>{formatUsd(data.snapshot.amount_usd)} el {data.snapshot.date} − {formatUsd(data.spent_since_usd)} gastado después</div>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Gasto de este mes</div>
              <div className="text-2xl font-semibold text-zinc-100">{formatUsd(data.month_usd)}</div>
              <div className="text-xs text-zinc-500 mt-1">
                Informe de Anthropic{data.consulted_at ? `, consultado ${new Date(data.consulted_at).toLocaleTimeString()}` : ''}.{' '}
                {data.today_estimated_usd != null && `Incluye ${formatUsd(data.today_estimated_usd)} de hoy (UTC) estimados por el chat; Anthropic lo informa mañana.`}
              </div>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
