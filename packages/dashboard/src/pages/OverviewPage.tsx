import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { User, FeedItem, UsageEvent } from '../lib/types';
import { hashColor, getInitials, getModelLimit, getCreditRule, nextFeedId } from '../lib/utils';
import { Card, CardHeader, CardBody } from '../components/Card';
import { StatusBadge } from '../components/Badge';
import { ProgressBar } from '../components/ProgressBar';
import { Button } from '../components/Button';
import { LiveFeed } from '../components/LiveFeed';
import { SkeletonPage } from '../components/Skeleton';
import { AddUserModal } from './AddUserModal';
import { Modal, ModalHeader, ModalBody } from '../components/Modal';

interface OverviewPageProps {
  wsEvents: FeedItem[];
  showToast: (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error', duration?: number) => void;
}

export function OverviewPage({ wsEvents, showToast }: OverviewPageProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [creditsModalOpen, setCreditsModalOpen] = useState(false);
  const navigate = useNavigate();
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [usersRes, eventsRes] = await Promise.all([
        api.getUsers(),
        api.getEvents({ limit: 30 }),
      ]);
      setUsers(usersRes.users);

      const items: FeedItem[] = (eventsRes.events ?? []).map((evt: UsageEvent) => ({
        id: nextFeedId(),
        type: 'counted' as const,
        user: evt.user_name ?? 'Desconocido',
        detail: `${evt.model} (+${evt.credit_cost} créditos)`,
        time: evt.timestamp,
      }));
      setFeedItems(items);
    } catch {
      // handled by API interceptor
    } finally {
      setLoading(false);
    }
  }, []);

  const silentRefresh = useCallback(async () => {
    try {
      const res = await api.getUsers();
      setUsers(res.users);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    loadData();
    refreshTimerRef.current = setInterval(silentRefresh, 30000);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [loadData, silentRefresh]);

  const allFeedItems = [...wsEvents, ...feedItems].slice(0, 50);

  const handleUserAction = async (userId: string, action: 'pause' | 'kill' | 'reinstate', userName: string) => {
    const statusMap = { pause: 'paused', kill: 'killed', reinstate: 'active' } as const;
    try {
      await api.updateUser(userId, { status: statusMap[action] });
      showToast(
        action === 'pause' ? 'Usuario Pausado' : action === 'kill' ? 'Acceso Revocado' : 'Usuario Restaurado',
        `${userName} ha sido ${action === 'pause' ? 'pausado' : action === 'kill' ? 'revocado' : 'restaurado'}`,
        action === 'kill' ? 'error' : action === 'pause' ? 'warning' : 'success'
      );
      silentRefresh();
    } catch (err) {
      showToast('Error', err instanceof Error ? err.message : 'Acción fallida', 'error');
    }
  };

  if (loading) return <SkeletonPage />;

  const totalUsers = users.length;
  const activeUsers = users.filter((u) => u.status === 'active').length;
  const pausedUsers = users.filter((u) => u.status === 'paused').length;
  const killedUsers = users.filter((u) => u.status === 'killed').length;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-semibold text-zinc-100">Resumen</h2>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setCreditsModalOpen(true)}>
            ¿Cómo funcionan los créditos?
          </Button>
          <Button variant="primary" onClick={() => setAddModalOpen(true)}>
            + Agregar Usuario
          </Button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Usuarios" value={totalUsers} />
        <StatCard label="Activos" value={activeUsers} color="text-green-400" />
        <StatCard label="Pausados" value={pausedUsers} color="text-yellow-400" />
        <StatCard label="Eliminados" value={killedUsers} color="text-red-400" />
      </div>

      {/* Two columns: users + live feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-zinc-200">Usuarios</h3>
            </CardHeader>
            <CardBody>
              {users.length === 0 ? (
                <div className="flex flex-col items-center py-8 text-zinc-500">
                  <p className="text-sm">Sin usuarios. Click en "Agregar Usuario" para comenzar.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {users.map((user) => (
                    <UserCard
                      key={user.id}
                      user={user}
                      onClick={() => navigate(`/dashboard/users/${user.id}`)}
                      onAction={handleUserAction}
                    />
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-zinc-200">Actividad en Vivo</h3>
            </CardHeader>
            <CardBody flush>
              <LiveFeed events={allFeedItems} />
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Add User Modal */}
      <AddUserModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onCreated={() => { silentRefresh(); }}
        showToast={showToast}
      />

      {/* Credits Explainer Modal */}
      <Modal open={creditsModalOpen} onClose={() => setCreditsModalOpen(false)} size="lg">
        <ModalHeader onClose={() => setCreditsModalOpen(false)}>¿Cómo funcionan los créditos?</ModalHeader>
        <ModalBody>
          <div className="space-y-5 text-sm text-zinc-300">
            <p>
              Los <span className="text-[#cc5500] font-semibold">créditos</span> son una unidad de medida unificada que permite controlar el costo de uso de distintos modelos de Claude con un solo número.
            </p>
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-2">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Costo por turno (pesos por defecto)</p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-purple-500" /><span className="font-medium">Opus</span></div>
                <span className="font-mono text-zinc-300">10 créditos / turno</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-blue-500" /><span className="font-medium">Sonnet</span></div>
                <span className="font-mono text-zinc-300">3 créditos / turno</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-green-500" /><span className="font-medium">Haiku</span></div>
                <span className="font-mono text-zinc-300">1 crédito / turno</span>
              </div>
              <p className="text-xs text-zinc-600 pt-1">Un "turno" es cada vez que el usuario envía un mensaje a Claude Code.</p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Ejemplo práctico</p>
              <p className="text-zinc-400 text-xs">Con un presupuesto de <span className="text-zinc-200 font-semibold">50 créditos/día</span>:</p>
              <div className="mt-2 space-y-1 text-xs font-mono">
                <div className="flex justify-between"><span className="text-purple-400">Opus</span><span className="text-zinc-400">50 ÷ 10 = <span className="text-zinc-200">5 turnos/día</span></span></div>
                <div className="flex justify-between"><span className="text-blue-400">Sonnet</span><span className="text-zinc-400">50 ÷ 3 = <span className="text-zinc-200">~16 turnos/día</span></span></div>
                <div className="flex justify-between"><span className="text-green-400">Haiku</span><span className="text-zinc-400">50 ÷ 1 = <span className="text-zinc-200">50 turnos/día</span></span></div>
                <div className="flex justify-between pt-1 border-t border-zinc-800"><span className="text-zinc-400">Mezcla</span><span className="text-zinc-400">2 Opus + 10 Sonnet + 10 Haiku = <span className="text-zinc-200">50 créditos</span></span></div>
              </div>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Orden de verificación (primer bloqueo gana)</p>
              <ol className="space-y-2 text-xs text-zinc-400">
                <li className="flex gap-2"><span className="text-red-400 font-bold flex-shrink-0">1.</span><span>¿El usuario está <span className="text-red-400">revocado o pausado</span>? → Bloqueo inmediato</span></li>
                <li className="flex gap-2"><span className="text-yellow-400 font-bold flex-shrink-0">2.</span><span>¿Hay <span className="text-yellow-400">restricción horaria</span> activa? → Bloqueo si fuera del horario</span></li>
                <li className="flex gap-2"><span className="text-orange-400 font-bold flex-shrink-0">3.</span><span>¿Se superó el <span className="text-orange-400">límite por modelo</span>? → Bloqueo si se agotó</span></li>
                <li className="flex gap-2"><span className="text-[#cc5500] font-bold flex-shrink-0">4.</span><span>¿El <span className="text-[#cc5500]">balance de créditos</span> alcanza para el próximo turno? → Bloqueo si no alcanza</span></li>
                <li className="flex gap-2"><span className="text-green-400 font-bold flex-shrink-0">5.</span><span className="text-green-400">Permitido ✓</span></li>
              </ol>
            </div>
            <p className="text-xs text-zinc-500">Los pesos se ajustan en <span className="text-zinc-300">Configuración → Pesos de Créditos</span>. Los límites por modelo y horarios se configuran en <span className="text-zinc-300">Editar Límites</span> de cada usuario.</p>
          </div>
        </ModalBody>
      </Modal>
    </div>
  );
}

/* ---- Sub-components ---- */

function StatCard({ label, value, color, sub }: { label: string; value: number | string; color?: string; sub?: string }) {
  return (
    <Card>
      <div className="p-4">
        <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{label}</div>
        <div className={`text-2xl font-bold mt-1 ${color ?? 'text-zinc-100'}`}>{value}</div>
        {sub && <div className="text-xs text-zinc-500 mt-0.5">{sub}</div>}
      </div>
    </Card>
  );
}

function UserCard({
  user,
  onClick,
  onAction,
}: {
  user: User;
  onClick: () => void;
  onAction: (userId: string, action: 'pause' | 'kill' | 'reinstate', userName: string) => void;
}) {
  const limits = user.limits ?? [];
  const usage = user.usage ?? {};
  const dailyUsage: Record<string, number> = usage.daily?.counts ?? {};
  const creditRule = getCreditRule(limits);
  const color = hashColor(user.name || user.slug);

  return (
    <div
      className="rounded-lg border border-zinc-800 bg-zinc-800/30 hover:bg-zinc-800/50 hover:border-zinc-700 p-4 cursor-pointer transition-all duration-150"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0"
            style={{ background: color }}
          >
            {getInitials(user.name)}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-zinc-100 truncate">{user.name}</div>
            <div className="text-xs text-zinc-500 truncate">@{user.slug}</div>
          </div>
        </div>
        <StatusBadge status={user.status} />
      </div>

      <div className="space-y-2 mb-3">
        {creditRule && user.credit_budget && user.credit_budget > 0 && (
          <ProgressBar
            label="Créditos"
            used={user.credit_budget - (user.credit_balance ?? 0)}
            limit={user.credit_budget}
          />
        )}
        {['opus', 'sonnet', 'haiku'].map((m) => {
          const mLimit = getModelLimit(limits, m);
          const mUsed = dailyUsage[m] ?? 0;
          if (mLimit > 0 || mUsed > 0) {
            return (
              <ProgressBar
                key={m}
                label={m}
                used={mUsed}
                limit={mLimit > 0 ? mLimit : 0}
              />
            );
          }
          return null;
        })}
        {!creditRule && !['opus', 'sonnet', 'haiku'].some((m) => {
          const mLimit = getModelLimit(limits, m);
          const mUsed = dailyUsage[m] ?? 0;
          return mLimit > 0 || mUsed > 0;
        }) && (
          <p className="text-xs text-zinc-600">Sin límites configurados</p>
        )}
      </div>

      <div className="flex gap-2">
        {user.status === 'active' ? (
          <>
            <Button
              size="sm"
              variant="warning"
              onClick={(e) => { e.stopPropagation(); onAction(user.id, 'pause', user.name); }}
            >
              Pausar
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={(e) => { e.stopPropagation(); onAction(user.id, 'kill', user.name); }}
            >
              Revocar
            </Button>
          </>
        ) : user.status === 'paused' ? (
          <>
            <Button
              size="sm"
              variant="success"
              onClick={(e) => { e.stopPropagation(); onAction(user.id, 'reinstate', user.name); }}
            >
              Restaurar
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={(e) => { e.stopPropagation(); onAction(user.id, 'kill', user.name); }}
            >
              Revocar
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="success"
            onClick={(e) => { e.stopPropagation(); onAction(user.id, 'reinstate', user.name); }}
          >
            Restaurar
          </Button>
        )}
      </div>
    </div>
  );
}
