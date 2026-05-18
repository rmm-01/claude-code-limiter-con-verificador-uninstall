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
          <CreditsExplainer />
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

export function CreditsExplainer() {
  return (
    <div className="space-y-5 text-sm text-zinc-300">

      {/* Intro */}
      <div className="space-y-2">
        <p>
          Claude Code es una herramienta de inteligencia artificial que los empleados usan para escribir y revisar código. Existen <span className="text-zinc-100 font-semibold">tres modelos</span> de IA disponibles, cada uno con distinta capacidad y costo:
        </p>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-purple-500 mt-1 flex-shrink-0" />
            <div>
              <span className="font-semibold text-zinc-100">Opus</span>
              <span className="text-zinc-500"> — el más potente y costoso. Ideal para tareas complejas.</span>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500 mt-1 flex-shrink-0" />
            <div>
              <span className="font-semibold text-zinc-100">Sonnet</span>
              <span className="text-zinc-500"> — equilibrio entre capacidad y costo. Es el modelo estándar.</span>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-green-500 mt-1 flex-shrink-0" />
            <div>
              <span className="font-semibold text-zinc-100">Haiku</span>
              <span className="text-zinc-500"> — el más rápido y económico. Para tareas simples y repetitivas.</span>
            </div>
          </div>
        </div>
      </div>

      {/* Qué es un crédito */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-2">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">¿Qué es un crédito?</p>
        <p className="text-zinc-400 text-xs leading-relaxed">
          Un <span className="text-[#cc5500] font-semibold">crédito</span> es una unidad interna de medida que usamos para controlar cuánto usa cada empleado, sin importar qué modelo elija. Es como una moneda virtual: cada vez que un empleado envía un mensaje a Claude Code (llamado un <span className="text-zinc-200">"turno"</span>), se descuentan créditos de su saldo diario según el modelo que usó.
        </p>
        <p className="text-zinc-400 text-xs leading-relaxed mt-2">
          Esto permite que el administrador ponga <span className="text-zinc-200">un solo límite</span> que cubre todos los modelos a la vez, en lugar de tener que configurar restricciones separadas para cada uno.
        </p>
      </div>

      {/* Costo por modelo */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-2">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Costo por turno (configuración por defecto)</p>
        <div className="space-y-2">
          <div className="flex items-center justify-between py-1 border-b border-zinc-800">
            <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-purple-500" /><span className="font-medium text-zinc-200">Opus</span></div>
            <span className="font-mono text-zinc-300 text-xs">10 créditos por turno</span>
          </div>
          <div className="flex items-center justify-between py-1 border-b border-zinc-800">
            <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-blue-500" /><span className="font-medium text-zinc-200">Sonnet</span></div>
            <span className="font-mono text-zinc-300 text-xs">3 créditos por turno</span>
          </div>
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-green-500" /><span className="font-medium text-zinc-200">Haiku</span></div>
            <span className="font-mono text-zinc-300 text-xs">1 crédito por turno</span>
          </div>
        </div>
        <p className="text-xs text-zinc-600 pt-1">Estos valores se pueden cambiar en <span className="text-zinc-400">Configuración → Pesos de Créditos</span>.</p>
      </div>

      {/* Ejemplo concreto */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Ejemplo concreto</p>
        <p className="text-zinc-400 text-xs mb-3">
          Supongamos que le asignamos a un empleado un límite de <span className="text-zinc-200 font-semibold">50 créditos por día</span>. Dependiendo de qué modelo use, su día de trabajo se vería así:
        </p>
        <div className="space-y-2 text-xs">
          <div className="flex items-start gap-3 p-2 rounded-md bg-purple-500/5 border border-purple-500/10">
            <div className="w-2 h-2 rounded-full bg-purple-500 mt-0.5 flex-shrink-0" />
            <div><span className="text-purple-300 font-medium">Solo Opus:</span><span className="text-zinc-400"> 50 ÷ 10 = </span><span className="text-zinc-200 font-semibold">5 mensajes al día.</span><span className="text-zinc-500"> Muy restringido — reservado para análisis profundos.</span></div>
          </div>
          <div className="flex items-start gap-3 p-2 rounded-md bg-blue-500/5 border border-blue-500/10">
            <div className="w-2 h-2 rounded-full bg-blue-500 mt-0.5 flex-shrink-0" />
            <div><span className="text-blue-300 font-medium">Solo Sonnet:</span><span className="text-zinc-400"> 50 ÷ 3 = </span><span className="text-zinc-200 font-semibold">~16 mensajes al día.</span><span className="text-zinc-500"> Uso moderado y productivo para la mayoría de tareas.</span></div>
          </div>
          <div className="flex items-start gap-3 p-2 rounded-md bg-green-500/5 border border-green-500/10">
            <div className="w-2 h-2 rounded-full bg-green-500 mt-0.5 flex-shrink-0" />
            <div><span className="text-green-300 font-medium">Solo Haiku:</span><span className="text-zinc-400"> 50 ÷ 1 = </span><span className="text-zinc-200 font-semibold">50 mensajes al día.</span><span className="text-zinc-500"> Uso intensivo para tareas repetitivas o simples.</span></div>
          </div>
          <div className="flex items-start gap-3 p-2 rounded-md bg-zinc-800/50 border border-zinc-700">
            <div className="w-2 h-2 rounded-full bg-zinc-400 mt-0.5 flex-shrink-0" />
            <div><span className="text-zinc-300 font-medium">Uso mixto:</span><span className="text-zinc-400"> 2 Opus (20) + 5 Sonnet (15) + 15 Haiku (15) = </span><span className="text-zinc-200 font-semibold">50 créditos usados.</span><span className="text-zinc-500"> El sistema descuenta automáticamente según cada modelo.</span></div>
          </div>
        </div>
      </div>

      {/* Qué pasa cuando se agotan */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">¿Qué pasa cuando se agotan los créditos?</p>
        <p className="text-zinc-400 text-xs leading-relaxed">
          Cuando el saldo de créditos de un empleado llega a cero (o no alcanza para pagar el costo del próximo mensaje), Claude Code le muestra automáticamente un mensaje de bloqueo y <span className="text-zinc-200">no permite continuar usando la IA</span> hasta que el saldo se renueve. El empleado puede ver cuántos créditos le quedan con el comando <span className="font-mono text-zinc-300">claude-limiter status</span>.
        </p>
        <p className="text-zinc-400 text-xs leading-relaxed mt-2">
          El saldo se <span className="text-zinc-200">renueva automáticamente</span> según la ventana configurada: al inicio del día, de la semana, del mes, o pasadas 24 horas desde el primer uso. No requiere intervención manual del administrador.
        </p>
      </div>

      {/* Capas de control */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Capas de control disponibles</p>
        <p className="text-zinc-400 text-xs mb-3">Los créditos son solo una de las formas de controlar el uso. El sistema verifica en este orden — <span className="text-zinc-200">si cualquier condición bloquea, el resto no se evalúa</span>:</p>
        <ol className="space-y-2.5 text-xs">
          <li className="flex gap-3">
            <span className="text-red-400 font-bold flex-shrink-0 w-5">1.</span>
            <div><span className="text-red-400 font-medium">Estado del usuario</span> — Si el admin pausó o revocó al usuario, queda bloqueado sin importar sus créditos.</div>
          </li>
          <li className="flex gap-3">
            <span className="text-yellow-400 font-bold flex-shrink-0 w-5">2.</span>
            <div><span className="text-yellow-400 font-medium">Restricción horaria</span> — Se puede limitar el uso a ciertos horarios (ej: solo de 9:00 a 18:00). Fuera de ese rango, el modelo queda bloqueado.</div>
          </li>
          <li className="flex gap-3">
            <span className="text-orange-400 font-bold flex-shrink-0 w-5">3.</span>
            <div><span className="text-orange-400 font-medium">Límite por modelo</span> — Se puede poner un tope independiente por modelo (ej: máximo 3 mensajes a Opus por día), además del presupuesto de créditos.</div>
          </li>
          <li className="flex gap-3">
            <span className="text-[#cc5500] font-bold flex-shrink-0 w-5">4.</span>
            <div><span className="text-[#cc5500] font-medium">Presupuesto de créditos</span> — Si el saldo no alcanza para pagar el costo del próximo mensaje, se bloquea.</div>
          </li>
          <li className="flex gap-3">
            <span className="text-green-400 font-bold flex-shrink-0 w-5">5.</span>
            <div className="text-green-400 font-medium">Acceso permitido ✓</div>
          </li>
        </ol>
      </div>

      <p className="text-xs text-zinc-600 leading-relaxed">
        Los límites se configuran por usuario desde el botón <span className="text-zinc-400">"Editar Límites"</span> en el perfil de cada empleado. Los pesos de créditos (el costo de cada modelo) se ajustan globalmente en <span className="text-zinc-400">Configuración → Pesos de Créditos</span>.
      </p>
    </div>
  );
}
