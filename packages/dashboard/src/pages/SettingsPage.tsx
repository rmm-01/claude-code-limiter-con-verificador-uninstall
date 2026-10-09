import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import type { Team, RateWindow } from '../lib/types';
import { Card, CardBody } from '../components/Card';
import { Button } from '../components/Button';
import { Input } from '../components/Input';

interface SettingsPageProps {
  showToast: (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
  onTeamUpdate: (team: Team) => void;
}

export function SettingsPage({ showToast, onTeamUpdate }: SettingsPageProps) {
  const [team, setTeam] = useState<Team | null>(null);
  const [teamName, setTeamName] = useState('');
  const [fableWeight, setFableWeight] = useState('15');
  const [opusWeight, setOpusWeight] = useState('10');
  const [sonnetWeight, setSonnetWeight] = useState('3');
  const [haikuWeight, setHaikuWeight] = useState('1');
  const [effortLow, setEffortLow] = useState('0.5');
  const [effortMedium, setEffortMedium] = useState('1');
  const [effortHigh, setEffortHigh] = useState('2');
  const [effortXhigh, setEffortXhigh] = useState('4');
  const [effortMax, setEffortMax] = useState('6');
  const [resetDay, setResetDay] = useState('1');
  const [resetHour, setResetHour] = useState('0');
  const [resetTz, setResetTz] = useState('UTC');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [savingWeights, setSavingWeights] = useState(false);
  const [savingEffort, setSavingEffort] = useState(false);
  const [savingReset, setSavingReset] = useState(false);
  const [reportedWeek, setReportedWeek] = useState<RateWindow | null>(null);
  const [reportedBy, setReportedBy] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    const stored = api.getStoredTeam();
    if (stored) {
      setTeam(stored);
      setTeamName(stored.name);
      setFableWeight(String(stored.credit_weights?.fable ?? 15));
      setOpusWeight(String(stored.credit_weights?.opus ?? 10));
      setSonnetWeight(String(stored.credit_weights?.sonnet ?? 3));
      setHaikuWeight(String(stored.credit_weights?.haiku ?? 1));
      setEffortLow(String(stored.effort_multipliers?.low ?? 0.5));
      setEffortMedium(String(stored.effort_multipliers?.medium ?? 1));
      setEffortHigh(String(stored.effort_multipliers?.high ?? 2));
      setEffortXhigh(String(stored.effort_multipliers?.xhigh ?? 4));
      setEffortMax(String(stored.effort_multipliers?.max ?? 6));
      setResetDay(String(stored.weekly_reset?.day ?? 1));
      setResetHour(String(stored.weekly_reset?.hour ?? 0));
      setResetTz(stored.weekly_reset?.tz ?? 'UTC');
    }
    // Also do a fresh fetch via getUsers to refresh team data
    api.getUsers().catch(() => {
      // noop
    });
    api.getAccountUsage().then((res) => {
      setReportedWeek(res.usage?.seven_day ?? null);
      setReportedBy(res.usage?.reported_by ?? '');
    }).catch(() => {});
  }, []);

  // Day/hour of the 7d reset reported by the clients' statusLine, in the
  // selected timezone. Only a suggestion: any user can post a report, so the
  // admin checks it against /usage (reporter shown) and applies it explicitly.
  const reported = reportedWeek ? anchorFromReset(reportedWeek.resets_at, resetTz.trim() || 'UTC') : null;

  const handleUseReported = () => {
    if (!reported) return;
    setResetDay(String(reported.day));
    setResetHour(String(reported.hour));
  };

  const handleSaveName = async () => {
    if (!teamName.trim()) {
      showToast('Error', 'El nombre del equipo no puede estar vacío', 'error');
      return;
    }
    if (teamName.trim().length > 50) {
      showToast('Error', 'El nombre no puede superar los 50 caracteres', 'error');
      return;
    }
    setSavingName(true);
    try {
      const res = await api.updateSettings({ name: teamName.trim() });
      setTeam(res.team);
      api.setStoredTeam(res.team);
      onTeamUpdate(res.team);
      showToast('Guardado', 'Nombre del equipo actualizado', 'success');
    } catch (err) {
      showToast('Error', err instanceof Error ? err.message : 'Failed to save', 'error');
    } finally {
      setSavingName(false);
    }
  };

  const handleSaveWeights = async () => {
    const cw = {
      fable: parseInt(fableWeight, 10) || 0,
      opus: parseInt(opusWeight, 10) || 0,
      sonnet: parseInt(sonnetWeight, 10) || 0,
      haiku: parseInt(haikuWeight, 10) || 0,
    };
    setSavingWeights(true);
    try {
      const res = await api.updateSettings({ credit_weights: cw });
      setTeam(res.team);
      api.setStoredTeam(res.team);
      onTeamUpdate(res.team);
      showToast('Guardado', 'Pesos de créditos actualizados', 'success');
    } catch (err) {
      showToast('Error', err instanceof Error ? err.message : 'Failed to save', 'error');
    } finally {
      setSavingWeights(false);
    }
  };

  const handleSaveEffort = async () => {
    const em = {
      low: parseFloat(effortLow) || 0.5,
      medium: parseFloat(effortMedium) || 1,
      high: parseFloat(effortHigh) || 2,
      xhigh: parseFloat(effortXhigh) || 4,
      max: parseFloat(effortMax) || 6,
    };
    setSavingEffort(true);
    try {
      const res = await api.updateSettings({ effort_multipliers: em });
      setTeam(res.team);
      api.setStoredTeam(res.team);
      onTeamUpdate(res.team);
      showToast('Guardado', 'Multiplicadores de effort actualizados', 'success');
    } catch (err) {
      showToast('Error', err instanceof Error ? err.message : 'Failed to save', 'error');
    } finally {
      setSavingEffort(false);
    }
  };

  const handleSaveReset = async () => {
    const wr = {
      day: parseInt(resetDay, 10),
      hour: parseInt(resetHour, 10),
      tz: resetTz.trim() || 'UTC',
    };
    setSavingReset(true);
    try {
      const res = await api.updateSettings({ weekly_reset: wr });
      setTeam(res.team);
      api.setStoredTeam(res.team);
      onTeamUpdate(res.team);
      showToast('Guardado', 'Reinicio semanal actualizado', 'success');
    } catch (err) {
      showToast('Error', err instanceof Error ? err.message : 'Failed to save', 'error');
    } finally {
      setSavingReset(false);
    }
  };

  const handleChangePassword = async () => {
    if (!newPassword) {
      showToast('Error', 'La contraseña no puede estar vacía', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('Error', 'Las contraseñas no coinciden', 'error');
      return;
    }
    if (newPassword.length < 6) {
      showToast('Error', 'La contraseña debe tener al menos 6 caracteres', 'error');
      return;
    }
    setSavingPassword(true);
    try {
      await api.updateSettings({ admin_password: newPassword });
      showToast('Guardado', 'Contraseña cambiada. Debes iniciar sesión nuevamente.', 'success');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      showToast('Error', err instanceof Error ? err.message : 'Failed to change password', 'error');
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <h2 className="text-xl font-semibold text-zinc-100">Configuración</h2>

      {/* Team Name */}
      <Card>
        <CardBody>
          <h3 className="text-sm font-semibold text-zinc-200 mb-3">Nombre del Equipo</h3>
          <div className="space-y-3">
            <Input
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Nombre del equipo"
              maxLength={50}
              hint={`${teamName.length}/50 caracteres`}
            />
            <Button size="sm" variant="primary" onClick={handleSaveName} disabled={savingName}>
              {savingName ? 'Guardando...' : 'Guardar Nombre'}
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Credit Weights */}
      <Card>
        <CardBody>
          <h3 className="text-sm font-semibold text-zinc-200 mb-1">Pesos de Créditos</h3>
          <p className="text-xs text-zinc-500 mb-4">
            Define cuántos créditos cuesta cada modelo por turno. Mayor peso = más caro.
          </p>
          <div className="grid grid-cols-4 gap-4 mb-4">
            <WeightCard model="Fable" value={fableWeight} onChange={setFableWeight} color="bg-teal-400" />
            <WeightCard model="Opus" value={opusWeight} onChange={setOpusWeight} color="bg-purple-500" />
            <WeightCard model="Sonnet" value={sonnetWeight} onChange={setSonnetWeight} color="bg-blue-500" />
            <WeightCard model="Haiku" value={haikuWeight} onChange={setHaikuWeight} color="bg-green-500" />
          </div>
          <Button size="sm" variant="primary" onClick={handleSaveWeights} disabled={savingWeights}>
            {savingWeights ? 'Guardando...' : 'Guardar Pesos'}
          </Button>
        </CardBody>
      </Card>

      {/* Effort Multipliers */}
      <Card>
        <CardBody>
          <h3 className="text-sm font-semibold text-zinc-200 mb-1">Multiplicadores de Effort</h3>
          <p className="text-xs text-zinc-500 mb-4">
            Multiplica el costo de créditos según el nivel de effort. Ej: Opus (10 cr) × Max (6x) = 60 créditos por turno.
          </p>
          <div className="grid grid-cols-5 gap-3 mb-4">
            <EffortCard level="Low" value={effortLow} onChange={setEffortLow} color="bg-green-500" />
            <EffortCard level="Medium" value={effortMedium} onChange={setEffortMedium} color="bg-blue-500" />
            <EffortCard level="High" value={effortHigh} onChange={setEffortHigh} color="bg-yellow-500" />
            <EffortCard level="XHigh" value={effortXhigh} onChange={setEffortXhigh} color="bg-orange-500" />
            <EffortCard level="Max" value={effortMax} onChange={setEffortMax} color="bg-red-500" />
          </div>
          <Button size="sm" variant="primary" onClick={handleSaveEffort} disabled={savingEffort}>
            {savingEffort ? 'Guardando...' : 'Guardar Multiplicadores'}
          </Button>
        </CardBody>
      </Card>

      {/* Weekly Reset */}
      <Card>
        <CardBody>
          <h3 className="text-sm font-semibold text-zinc-200 mb-1">Reinicio Semanal</h3>
          <p className="text-xs text-zinc-500 mb-4">
            Cuándo reinicia el límite semanal de la suscripción de Claude. Copialo de <code>/usage</code> en Claude Code
            (ej: "Resets Thu 10am"). Los límites <code>weekly</code> se reinician en ese momento.
          </p>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <label className="text-xs text-zinc-400">
              Día
              <select
                value={resetDay}
                onChange={(e) => setResetDay(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800/50 px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              >
                {DAY_NAMES.map((name, i) => (
                  <option key={i} value={i}>{name}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-zinc-400">
              Hora
              <select
                value={resetHour}
                onChange={(e) => setResetHour(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800/50 px-2 py-1.5 text-sm font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                ))}
              </select>
            </label>
            <Input
              label="Zona horaria"
              value={resetTz}
              onChange={(e) => setResetTz(e.target.value)}
              placeholder="America/Lima"
            />
          </div>
          {reported && (
            <div className="flex items-center justify-between gap-3 mb-4 rounded-md border border-zinc-800 bg-zinc-800/30 px-3 py-2 text-xs text-zinc-400">
              <span>
                Reinicio reportado por <span className="text-zinc-200">{reportedBy || 'desconocido'}</span>:{' '}
                <span className="text-zinc-200">{DAY_NAMES[reported.day]} {String(reported.hour).padStart(2, '0')}:00</span>
                <span className="block text-zinc-500">Verificalo con <code>/usage</code> antes de aplicarlo.</span>
              </span>
              <Button size="sm" variant="secondary" onClick={handleUseReported}>
                Usar este
              </Button>
            </div>
          )}
          <Button size="sm" variant="primary" onClick={handleSaveReset} disabled={savingReset}>
            {savingReset ? 'Guardando...' : 'Guardar Reinicio'}
          </Button>
        </CardBody>
      </Card>

      {/* Change Password */}
      <Card>
        <CardBody>
          <h3 className="text-sm font-semibold text-zinc-200 mb-3">Cambiar Contraseña de Admin</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <Input
              type="password"
              label="Nueva Contraseña"
              placeholder="Nueva contraseña"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
            <Input
              type="password"
              label="Confirmar Contraseña"
              placeholder="Confirmar contraseña"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <Button size="sm" variant="danger" onClick={handleChangePassword} disabled={savingPassword}>
            {savingPassword ? 'Cambiando...' : 'Cambiar Contraseña'}
          </Button>
        </CardBody>
      </Card>

      {/* Server Info */}
      <Card>
        <CardBody>
          <h3 className="text-sm font-semibold text-zinc-200 mb-3">Info del Servidor</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="text-zinc-500">URL del Servidor</div>
            <div className="font-mono text-zinc-300">{window.location.origin}</div>
            <div className="text-zinc-500">Team ID</div>
            <div className="font-mono text-zinc-300">{team?.id ?? 'N/A'}</div>
            <div className="text-zinc-500">Dashboard</div>
            <div className="font-mono text-zinc-300">React + Tailwind v1.0</div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Day (0=Sun) and hour of a reset timestamp in a timezone, rounded to the hour. Null for a bad tz. */
function anchorFromReset(resetsAtSec: number, tz: string): { day: number; hour: number } | null {
  try {
    const rounded = new Date(Math.round(resetsAtSec / 3600) * 3600 * 1000);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(rounded);
    const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    if (!(weekday in WEEKDAY_INDEX) || !Number.isInteger(hour)) return null;
    return { day: WEEKDAY_INDEX[weekday], hour };
  } catch {
    return null;
  }
}

function EffortCard({
  level,
  value,
  onChange,
  color,
}: {
  level: string;
  value: string;
  onChange: (v: string) => void;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-800/30 p-3 text-center">
      <div className="flex items-center justify-center gap-1.5 mb-2">
        <div className={`w-2 h-2 rounded-full ${color}`} />
        <span className="text-xs font-medium text-zinc-300">{level}</span>
      </div>
      <input
        type="number"
        min="0"
        step="0.5"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-center rounded-md border border-zinc-700 bg-zinc-800/50 px-1 py-1.5 text-sm font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
      />
      <div className="text-xs text-zinc-600 mt-1">×</div>
    </div>
  );
}

function WeightCard({
  model,
  value,
  onChange,
  color,
}: {
  model: string;
  value: string;
  onChange: (v: string) => void;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-800/30 p-3 text-center">
      <div className="flex items-center justify-center gap-2 mb-2">
        <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
        <span className="text-sm font-medium text-zinc-300">{model}</span>
      </div>
      <input
        type="number"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-center rounded-md border border-zinc-700 bg-zinc-800/50 px-2 py-1.5 text-lg font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
      />
    </div>
  );
}
