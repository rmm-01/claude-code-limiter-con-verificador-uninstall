import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { getModelLimit, getCreditRule } from '../lib/utils';
import type { User, LimitRule } from '../lib/types';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../components/Modal';
import { Button } from '../components/Button';
import { Input, Select } from '../components/Input';

interface EditLimitsModalProps {
  open: boolean;
  onClose: () => void;
  userId: string | null;
  onSaved: () => void;
  showToast: (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

interface TimeRule {
  model: string;
  start: string;
  end: string;
  tz: string;
}

export function EditLimitsModal({ open, onClose, userId, onSaved, showToast }: EditLimitsModalProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [credits, setCredits] = useState('-1');
  const [creditsWindow, setCreditsWindow] = useState('daily');
  const [fable, setFable] = useState('-1');
  const [opus, setOpus] = useState('-1');
  const [sonnet, setSonnet] = useState('-1');
  const [haiku, setHaiku] = useState('-1');
  const [subagents, setSubagents] = useState('-1');
  const [subagentsWindow, setSubagentsWindow] = useState('daily');
  const [tokens, setTokens] = useState('-1');
  const [tokensWindow, setTokensWindow] = useState('daily');
  const [timeRules, setTimeRules] = useState<TimeRule[]>([]);

  useEffect(() => {
    if (!open || !userId) return;
    setLoading(true);
    api.getUser(userId)
      .then((u) => {
        setUser(u);
        const limits = u.limits ?? [];
        const creditRule = getCreditRule(limits);
        setCredits(creditRule ? String(creditRule.value) : '-1');
        setCreditsWindow(creditRule?.window ?? 'daily');
        setFable(String(getModelLimit(limits, 'fable', 'daily')));
        setOpus(String(getModelLimit(limits, 'opus', 'daily')));
        setSonnet(String(getModelLimit(limits, 'sonnet', 'daily')));
        setHaiku(String(getModelLimit(limits, 'haiku', 'daily')));
        const subagentRule = limits.find((r) => r.type === 'subagents');
        setSubagents(subagentRule ? String(subagentRule.value) : '-1');
        setSubagentsWindow(subagentRule?.window ?? 'daily');
        const tokenRule = limits.find((r) => r.type === 'tokens');
        setTokens(tokenRule ? String(tokenRule.value) : '-1');
        setTokensWindow(tokenRule?.window ?? 'daily');
        setTimeRules(
          limits
            .filter((r) => r.type === 'time_of_day')
            .map((r) => ({
              model: r.model ?? 'opus',
              start: r.schedule_start ?? '09:00',
              end: r.schedule_end ?? '18:00',
              tz: r.schedule_tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
            }))
        );
      })
      .catch((err) => {
        showToast('Error', err instanceof Error ? err.message : 'No se pudo cargar el usuario', 'error');
      })
      .finally(() => setLoading(false));
  }, [open, userId, showToast]);

  const handleSave = async () => {
    if (!userId) return;

    const limits: LimitRule[] = [];
    const creditsVal = parseInt(credits, 10);
    if (!isNaN(creditsVal) && creditsVal !== -1) {
      limits.push({ type: 'credits', window: creditsWindow, value: creditsVal });
    }

    for (const [model, val] of [['fable', fable], ['opus', opus], ['sonnet', sonnet], ['haiku', haiku]] as const) {
      const v = parseInt(val, 10);
      if (!isNaN(v) && v !== -1) {
        limits.push({ type: 'per_model', model, window: 'daily', value: v });
      }
    }

    const subagentsVal = parseInt(subagents, 10);
    if (!isNaN(subagentsVal) && subagentsVal !== -1) {
      limits.push({ type: 'subagents', window: subagentsWindow, value: subagentsVal });
    }

    const tokensVal = parseInt(tokens, 10);
    if (!isNaN(tokensVal) && tokensVal !== -1) {
      limits.push({ type: 'tokens', window: tokensWindow, value: tokensVal });
    }

    for (const tr of timeRules) {
      limits.push({
        type: 'time_of_day',
        model: tr.model,
        schedule_start: tr.start,
        schedule_end: tr.end,
        schedule_tz: tr.tz,
      });
    }

    setSaving(true);
    try {
      await api.updateUser(userId, { limits });
      showToast('Límites Actualizados', 'Los límites han sido guardados', 'success');
      onSaved();
      onClose();
    } catch (err) {
      showToast('Error', err instanceof Error ? err.message : 'No se pudo guardar', 'error');
    } finally {
      setSaving(false);
    }
  };

  const addTimeRule = () => {
    setTimeRules((prev) => [
      ...prev,
      { model: 'opus', start: '09:00', end: '18:00', tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
    ]);
  };

  const updateTimeRule = (idx: number, field: keyof TimeRule, value: string) => {
    setTimeRules((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  const removeTimeRule = (idx: number) => {
    setTimeRules((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <Modal open={open} onClose={onClose} size="lg">
      <ModalHeader onClose={onClose}>
        Editar Límites{user ? `: ${user.name}` : ''}
      </ModalHeader>
      <ModalBody>
        {loading ? (
          <div className="space-y-3">
            <div className="skeleton h-10 w-full" />
            <div className="skeleton h-10 w-full" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Presupuesto de créditos */}
            <div>
              <h4 className="text-sm font-medium text-zinc-300 mb-3">Presupuesto de Créditos</h4>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Valor (-1 = ilimitado, 0 = bloqueado)"
                  type="number"
                  value={credits}
                  onChange={(e) => setCredits(e.target.value)}
                />
                <Select
                  label="Ventana"
                  value={creditsWindow}
                  onChange={(e) => setCreditsWindow(e.target.value)}
                >
                  <option value="daily">Diaria</option>
                  <option value="weekly">Semanal</option>
                  <option value="monthly">Mensual</option>
                  <option value="sliding_24h">Últimas 24h</option>
                </Select>
              </div>
            </div>

            <hr className="border-zinc-800" />

            {/* Límites por modelo */}
            <div>
              <h4 className="text-sm font-medium text-zinc-300 mb-1">Límites por Modelo (Diario)</h4>
              <p className="text-xs text-zinc-500 mb-3">-1 = ilimitado, 0 = bloqueado</p>
              <div className="grid grid-cols-4 gap-3">
                <Input label="Fable" type="number" value={fable} onChange={(e) => setFable(e.target.value)} />
                <Input label="Opus" type="number" value={opus} onChange={(e) => setOpus(e.target.value)} />
                <Input label="Sonnet" type="number" value={sonnet} onChange={(e) => setSonnet(e.target.value)} />
                <Input label="Haiku" type="number" value={haiku} onChange={(e) => setHaiku(e.target.value)} />
              </div>
            </div>

            <hr className="border-zinc-800" />

            {/* Límite de subagentes/workflows */}
            <div>
              <h4 className="text-sm font-medium text-zinc-300 mb-3">Límite de Subagentes / Workflows</h4>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Máximo (-1 = ilimitado, 0 = bloqueado)"
                  type="number"
                  value={subagents}
                  onChange={(e) => setSubagents(e.target.value)}
                />
                <Select
                  label="Ventana"
                  value={subagentsWindow}
                  onChange={(e) => setSubagentsWindow(e.target.value)}
                >
                  <option value="daily">Diaria</option>
                  <option value="weekly">Semanal</option>
                  <option value="monthly">Mensual</option>
                  <option value="sliding_24h">Últimas 24h</option>
                </Select>
              </div>
            </div>

            <hr className="border-zinc-800" />

            {/* Límite de tokens */}
            <div>
              <h4 className="text-sm font-medium text-zinc-300 mb-3">Límite de Tokens</h4>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Máximo (-1 = ilimitado, 0 = bloqueado)"
                  type="number"
                  value={tokens}
                  onChange={(e) => setTokens(e.target.value)}
                  hint="Ej: 500000 = 500k tokens"
                />
                <Select
                  label="Ventana"
                  value={tokensWindow}
                  onChange={(e) => setTokensWindow(e.target.value)}
                >
                  <option value="daily">Diaria</option>
                  <option value="weekly">Semanal</option>
                  <option value="monthly">Mensual</option>
                  <option value="sliding_24h">Últimas 24h</option>
                </Select>
              </div>
            </div>

            <hr className="border-zinc-800" />

            {/* Restricciones horarias */}
            <div>
              <h4 className="text-sm font-medium text-zinc-300 mb-3">Restricciones Horarias</h4>
              <div className="space-y-3">
                {timeRules.map((tr, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-3">
                      <Select
                        label={idx === 0 ? 'Modelo' : undefined}
                        value={tr.model}
                        onChange={(e) => updateTimeRule(idx, 'model', e.target.value)}
                      >
                        <option value="fable">Fable</option>
                        <option value="opus">Opus</option>
                        <option value="sonnet">Sonnet</option>
                        <option value="haiku">Haiku</option>
                      </Select>
                    </div>
                    <div className="col-span-3">
                      <Input
                        label={idx === 0 ? 'Inicio' : undefined}
                        type="time"
                        value={tr.start}
                        onChange={(e) => updateTimeRule(idx, 'start', e.target.value)}
                      />
                    </div>
                    <div className="col-span-3">
                      <Input
                        label={idx === 0 ? 'Fin' : undefined}
                        type="time"
                        value={tr.end}
                        onChange={(e) => updateTimeRule(idx, 'end', e.target.value)}
                      />
                    </div>
                    <div className="col-span-2">
                      <Input
                        label={idx === 0 ? 'Zona horaria' : undefined}
                        value={tr.tz}
                        onChange={(e) => updateTimeRule(idx, 'tz', e.target.value)}
                      />
                    </div>
                    <div className="col-span-1 flex items-end pb-0.5">
                      <Button size="sm" variant="ghost" onClick={() => removeTimeRule(idx)}>
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M3 3l8 8M11 3l-8 8" />
                        </svg>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <Button size="sm" variant="ghost" onClick={addTimeRule} className="mt-2">
                + Agregar Restricción Horaria
              </Button>
            </div>
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" onClick={handleSave} disabled={saving || loading}>
          {saving ? 'Guardando...' : 'Guardar Límites'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
