import { useState } from 'react';
import { api } from '../lib/api';
import { slugify, copyToClipboard } from '../lib/utils';
import type { LimitRule } from '../lib/types';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../components/Modal';
import { Button } from '../components/Button';
import { Input } from '../components/Input';

interface AddUserModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  showToast: (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error', duration?: number) => void;
}

type Preset = 'light' | 'medium' | 'heavy' | 'unlimited' | 'custom';

const PRESETS: Record<Exclude<Preset, 'custom'>, {
  credits: number;
  opus: number;
  sonnet: number;
  haiku: number;
  desc: string;
}> = {
  light: { credits: 50, opus: 3, sonnet: 10, haiku: 30, desc: '50 créditos/día. Opus: 3, Sonnet: 10, Haiku: 30.' },
  medium: { credits: 100, opus: 5, sonnet: 20, haiku: 50, desc: '100 créditos/día. Opus: 5, Sonnet: 20, Haiku: 50.' },
  heavy: { credits: 200, opus: 10, sonnet: 40, haiku: 100, desc: '200 créditos/día. Opus: 10, Sonnet: 40, Haiku: 100.' },
  unlimited: { credits: -1, opus: -1, sonnet: -1, haiku: -1, desc: 'Sin límites. El usuario tiene acceso completo.' },
};

const PRESET_LABELS: Record<Preset, string> = {
  light: 'Ligero',
  medium: 'Medio',
  heavy: 'Intensivo',
  unlimited: 'Ilimitado',
  custom: 'Personalizado',
};

export function AddUserModal({ open, onClose, onCreated, showToast }: AddUserModalProps) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [preset, setPreset] = useState<Preset>('light');
  const [customCredits, setCustomCredits] = useState('100');
  const [customOpus, setCustomOpus] = useState('5');
  const [customSonnet, setCustomSonnet] = useState('20');
  const [customHaiku, setCustomHaiku] = useState('50');
  const [loading, setLoading] = useState(false);
  const [installCode, setInstallCode] = useState('');
  const [showInstall, setShowInstall] = useState(false);
  const [serverUrl, setServerUrl] = useState(() => localStorage.getItem('clm_server_url') || window.location.origin);

  const resetForm = () => {
    setName('');
    setSlug('');
    setPreset('light');
    setCustomCredits('100');
    setCustomOpus('5');
    setCustomSonnet('20');
    setCustomHaiku('50');
    setInstallCode('');
    setShowInstall(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const buildLimits = (): LimitRule[] => {
    const p = preset === 'custom'
      ? {
          credits: parseInt(customCredits, 10) || -1,
          opus: parseInt(customOpus, 10) || -1,
          sonnet: parseInt(customSonnet, 10) || -1,
          haiku: parseInt(customHaiku, 10) || -1,
        }
      : PRESETS[preset];

    const limits: LimitRule[] = [];
    if (p.credits !== -1) limits.push({ type: 'credits', window: 'daily', value: p.credits });
    if (p.opus !== -1) limits.push({ type: 'per_model', model: 'opus', window: 'daily', value: p.opus });
    if (p.sonnet !== -1) limits.push({ type: 'per_model', model: 'sonnet', window: 'daily', value: p.sonnet });
    if (p.haiku !== -1) limits.push({ type: 'per_model', model: 'haiku', window: 'daily', value: p.haiku });
    return limits;
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      showToast('Error', 'El nombre es requerido', 'error');
      return;
    }
    if (!slug.trim()) {
      showToast('Error', 'El slug es requerido', 'error');
      return;
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      showToast('Error', 'El slug debe ser minúsculas, números y guiones', 'error');
      return;
    }

    setLoading(true);
    try {
      const result = await api.createUser({
        name: name.trim(),
        slug: slug.trim(),
        limits: buildLimits(),
      });

      showToast('Usuario Creado', `${name.trim()} ha sido agregado`, 'success');
      onCreated();
      setInstallCode(result.install_code);
      setShowInstall(true);
    } catch (err) {
      showToast('Error', err instanceof Error ? err.message : 'No se pudo crear el usuario', 'error');
    } finally {
      setLoading(false);
    }
  };

  const copyCmd = async (text: string) => {
    try {
      await copyToClipboard(text);
      showToast('Copiado', 'Copiado al portapapeles', 'success', 2500);
    } catch {
      showToast('Error', 'No se pudo copiar', 'error');
    }
  };

  const REPO_URL = 'https://github.com/rmm-01/claude-code-limiter-con-verificador-uninstall.git';
  const REPO_DIR = 'claude-code-limiter-con-verificador-uninstall';

  const effectiveServer = serverUrl.trim() || 'TU-SERVIDOR-AQUÍ';
  const cloneCmd = `git clone ${REPO_URL}`;
  const linuxCmd = `cd ${REPO_DIR} && sudo node packages/cli/src/installer.js setup --code ${installCode} --server ${effectiveServer}`;
  const windowsCmd = `cd ${REPO_DIR}; node packages\\cli\\src\\installer.js setup --code ${installCode} --server ${effectiveServer}`;

  // Install command screen
  if (showInstall) {
    return (
      <Modal open={open} onClose={handleClose} size="lg">
        <ModalHeader onClose={handleClose}>Comando de Instalación</ModalHeader>
        <ModalBody>
          <div className="space-y-4">
            {/* Why-clone notice */}
            <div className="text-xs text-zinc-400 bg-amber-950/30 border border-amber-900/40 rounded-lg p-3 leading-relaxed">
              <div className="font-semibold text-amber-300 mb-1">Importante — usar este repo, NO <code>npx @howincodes</code></div>
              Este fork incluye fixes específicos sobre el upstream (TLS con CA del sistema, paths escribibles en Windows, verificador de auto-uninstall). El package de npm <code>@howincodes/claude-code-limiter</code> es el original y no tiene estos parches. Por eso el comando usa <code>git clone</code> + <code>node installer.js</code>.
            </div>

            {/* Server URL setup */}
            <div className="text-xs text-zinc-500 space-y-1 bg-zinc-900 rounded-lg p-3 border border-zinc-800">
              <div className="text-zinc-300 font-medium mb-1">¿Qué URL del servidor usar?</div>
              <div>• <span className="text-zinc-400">LAN local:</span> <span className="font-mono">http://192.168.x.x:3000</span></div>
              <div>• <span className="text-zinc-400">VPS / Azure:</span> <span className="font-mono">https://tu-dominio.azurewebsites.net</span></div>
              <div>• <span className="text-zinc-400">Dashboard actual:</span> <span className="font-mono text-zinc-300">{window.location.origin}</span></div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-400">URL del servidor para esta invitación (opcional)</label>
              <input
                type="text"
                value={serverUrl}
                onChange={(e) => {
                  setServerUrl(e.target.value);
                  localStorage.setItem('clm_server_url', e.target.value);
                }}
                placeholder="https://tu-servidor.com"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
              />
              <p className="text-xs text-zinc-600">Si la dejas vacía, los comandos mostrarán TU-SERVIDOR-AQUÍ. Se recuerda para próximas invitaciones.</p>
            </div>

            <hr className="border-zinc-800" />

            {/* Step 1 — clone */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Paso 1 — Clonar el repo (solo la primera vez)</span>
                <Button size="sm" variant="primary" onClick={() => copyCmd(cloneCmd)}>Copiar</Button>
              </div>
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
                <code className="text-xs text-zinc-200 font-mono break-all">{cloneCmd}</code>
              </div>
              <p className="text-xs text-zinc-600 mt-1">Si ya tenés el repo clonado, salteá este paso y andá directo al Paso 2 dentro de esa carpeta.</p>
            </div>

            {/* Step 2 — setup */}
            <div className="space-y-3">
              <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider block">Paso 2 — Setup (elegí tu OS)</span>

              {/* Linux / macOS */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Linux / macOS</span>
                  <Button size="sm" variant="primary" onClick={() => copyCmd(linuxCmd)}>Copiar</Button>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
                  <code className="text-xs text-green-400 font-mono break-all">{linuxCmd}</code>
                </div>
              </div>

              {/* Windows */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Windows (PowerShell como Administrador)</span>
                  <Button size="sm" variant="primary" onClick={() => copyCmd(windowsCmd)}>Copiar</Button>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
                  <code className="text-xs text-blue-400 font-mono break-all">{windowsCmd}</code>
                </div>
              </div>

              {/* Code only */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Código de instalación (por si falla copiar)</span>
                  <Button size="sm" variant="ghost" onClick={() => copyCmd(installCode)}>Copiar</Button>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
                  <code className="text-sm text-[#cc5500] font-mono">{installCode}</code>
                </div>
              </div>
            </div>

            <p className="text-xs text-zinc-600">
              Este código solo puede usarse una vez. Generá uno nuevo desde el detalle del usuario si es necesario. Después del Paso 2 hay que reiniciar Claude Code para que los hooks tomen efecto.
            </p>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" onClick={handleClose}>Listo</Button>
        </ModalFooter>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={handleClose} size="md">
      <ModalHeader onClose={handleClose}>Agregar Usuario</ModalHeader>
      <ModalBody>
        <div className="space-y-4">
          <Input
            label="Nombre"
            placeholder="ej. Alice, Equipo Dev, Pasante"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSlug(slugify(e.target.value));
            }}
            autoFocus
          />

          <Input
            label="Slug (usuario)"
            placeholder="ej. alice, equipo-dev, pasante"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            hint="Minúsculas, sin espacios. Usado en comandos de instalación y logs."
          />

          <hr className="border-zinc-800" />

          <div>
            <h4 className="text-sm font-medium text-zinc-300 mb-2">Preset de Límites</h4>
            <div className="flex flex-wrap gap-2">
              {(['light', 'medium', 'heavy', 'unlimited', 'custom'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPreset(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                    preset === p
                      ? 'bg-[#cc5500]/20 border-[#cc5500]/40 text-[#e06012]'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'
                  }`}
                >
                  {PRESET_LABELS[p]}
                </button>
              ))}
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              {preset === 'custom' ? 'Configura tus propios límites abajo.' : PRESETS[preset as Exclude<Preset, 'custom'>]?.desc}
            </p>
          </div>

          {preset === 'custom' && (
            <div className="space-y-3 animate-fade-in">
              <Input
                label="Presupuesto de Créditos (diario)"
                type="number"
                value={customCredits}
                onChange={(e) => setCustomCredits(e.target.value)}
                hint="-1 para ilimitado"
              />
              <div className="grid grid-cols-3 gap-3">
                <Input
                  label="Opus"
                  type="number"
                  value={customOpus}
                  onChange={(e) => setCustomOpus(e.target.value)}
                />
                <Input
                  label="Sonnet"
                  type="number"
                  value={customSonnet}
                  onChange={(e) => setCustomSonnet(e.target.value)}
                />
                <Input
                  label="Haiku"
                  type="number"
                  value={customHaiku}
                  onChange={(e) => setCustomHaiku(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={handleClose}>Cancelar</Button>
        <Button variant="primary" onClick={handleSubmit} disabled={loading}>
          {loading ? 'Creando...' : 'Crear Usuario'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
