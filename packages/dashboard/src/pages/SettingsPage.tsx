import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import type { Team } from '../lib/types';
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
  const [opusWeight, setOpusWeight] = useState('10');
  const [sonnetWeight, setSonnetWeight] = useState('3');
  const [haikuWeight, setHaikuWeight] = useState('1');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [savingWeights, setSavingWeights] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    const stored = api.getStoredTeam();
    if (stored) {
      setTeam(stored);
      setTeamName(stored.name);
      setOpusWeight(String(stored.credit_weights?.opus ?? 10));
      setSonnetWeight(String(stored.credit_weights?.sonnet ?? 3));
      setHaikuWeight(String(stored.credit_weights?.haiku ?? 1));
    }
    // Also do a fresh fetch via getUsers to refresh team data
    api.getUsers().catch(() => {
      // noop
    });
  }, []);

  const handleSaveName = async () => {
    if (!teamName.trim()) {
      showToast('Error', 'El nombre del equipo no puede estar vacío', 'error');
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
          <div className="grid grid-cols-3 gap-4 mb-4">
            <WeightCard model="Opus" value={opusWeight} onChange={setOpusWeight} color="bg-purple-500" />
            <WeightCard model="Sonnet" value={sonnetWeight} onChange={setSonnetWeight} color="bg-blue-500" />
            <WeightCard model="Haiku" value={haikuWeight} onChange={setHaikuWeight} color="bg-green-500" />
          </div>
          <Button size="sm" variant="primary" onClick={handleSaveWeights} disabled={savingWeights}>
            {savingWeights ? 'Guardando...' : 'Guardar Pesos'}
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
