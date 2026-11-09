import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import type { UpdateLink } from '../lib/types';
import { Modal, ModalHeader, ModalBody } from './Modal';
import { Button } from './Button';

interface UpdateCommandModalProps {
  open: boolean;
  onClose: () => void;
  userId: string | null;
  userName?: string;
  showToast: (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

/** Expiring single-use updater command for one user, with countdown and renew. */
export function UpdateCommandModal({ open, onClose, userId, userName, showToast }: UpdateCommandModalProps) {
  const [link, setLink] = useState<UpdateLink | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Load the active command each time the modal opens.
  useEffect(() => {
    if (!open || !userId) return;
    setLink(null);
    setLoading(true);
    api.getUpdateLink(userId)
      .then(setLink)
      .catch(() => setLink(null))
      .finally(() => setLoading(false));
  }, [open, userId]);

  // Tick once a second only while open, for the countdown.
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open]);

  const generate = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      setLink(await api.createUpdateLink(userId));
      setNow(Date.now());
    } catch (err) {
      showToast('Error', err instanceof Error ? err.message : 'No se pudo generar', 'error');
    } finally {
      setLoading(false);
    }
  };

  const remainingMs = link?.expires_at ? new Date(link.expires_at).getTime() - now : 0;
  const active = !!link?.command && remainingMs > 0;
  const mm = String(Math.floor(remainingMs / 60000)).padStart(2, '0');
  const ss = String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, '0');

  return (
    <Modal open={open} onClose={onClose} size="lg">
      <ModalHeader onClose={onClose}>Comando de Actualización{userName ? `: ${userName}` : ''}</ModalHeader>
      <ModalBody>
        {loading && !link ? (
          <div className="py-4 text-center text-zinc-500 text-sm">Cargando...</div>
        ) : (
          <div className="space-y-4">
            {active ? (
              <>
                <p className="text-sm text-zinc-400">
                  Pegalo en PowerShell <strong>como Administrador</strong> en la máquina del usuario (requiere git).
                  Es de un solo uso.
                </p>
                <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-2">
                  <code className="block text-xs text-[#cc5500] font-mono break-all">{link?.command}</code>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-500">Vence en <span className="font-mono text-zinc-300">{mm}:{ss}</span></span>
                    <button
                      onClick={() => { navigator.clipboard.writeText(link?.command ?? ''); showToast('Copiado', 'Comando copiado al portapapeles', 'success'); }}
                      className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                    >Copiar</button>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-400">
                {link?.command
                  ? 'El comando anterior venció. Genera uno nuevo.'
                  : 'No hay un comando activo para este usuario. Dura 30 minutos y es de un solo uso.'}
              </p>
            )}
            <Button variant={active ? 'ghost' : 'primary'} size="sm" onClick={generate} disabled={loading}>
              {loading ? 'Generando...' : active ? 'Renovar (invalida el actual)' : 'Generar comando'}
            </Button>
          </div>
        )}
      </ModalBody>
    </Modal>
  );
}
