import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { User, DailyUsageRow, UsageEvent, AnalyticsData } from '../lib/types';
import { hashColor, getInitials, getModelLimit, getCreditRule, timeAgo } from '../lib/utils';
import { Card, CardHeader, CardBody } from '../components/Card';
import { StatusBadge, Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Table } from '../components/Table';
import { CreditGauge } from '../components/CreditGauge';
import { HorizontalBarChart, TrendLineChart, PeakHoursChart } from '../components/Charts';
import { SkeletonPage } from '../components/Skeleton';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EditLimitsModal } from './EditLimitsModal';
import { Modal, ModalHeader, ModalBody } from '../components/Modal';

interface UserDetailPageProps {
  showToast: (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

export function UserDetailPage({ showToast }: UserDetailPageProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [usageDaily, setUsageDaily] = useState<DailyUsageRow[]>([]);
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editLimitsOpen, setEditLimitsOpen] = useState(false);
  const [creditsModalOpen, setCreditsModalOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    action: string;
    title: string;
    message: string;
    confirmLabel: string;
  } | null>(null);

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      const [u, usageRes, eventsRes, analyticsRes] = await Promise.all([
        api.getUser(id),
        api.getUsage({ user_id: id, days: 30 }),
        api.getEvents({ user_id: id, limit: 20 }),
        api.getAnalytics({ user_id: id, days: 30 }),
      ]);
      setUser(u);
      setUsageDaily(usageRes.daily ?? []);
      setEvents(eventsRes.events ?? []);
      setAnalytics(analyticsRes);
    } catch (err) {
      showToast('Error', err instanceof Error ? err.message : 'Failed to load user', 'error');
    } finally {
      setLoading(false);
    }
  }, [id, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleStatusAction = async (status: string) => {
    if (!id || !user) return;
    try {
      await api.updateUser(id, { status });
      showToast(
        status === 'paused' ? 'Usuario Pausado' : status === 'killed' ? 'Acceso Revocado' : 'Usuario Restaurado',
        `${user.name} ahora está ${status === 'paused' ? 'pausado' : status === 'killed' ? 'revocado' : 'activo'}`,
        status === 'killed' ? 'error' : status === 'paused' ? 'warning' : 'success'
      );
      setConfirmAction(null);
      loadData();
    } catch (err) {
      showToast('Error', err instanceof Error ? err.message : 'Action failed', 'error');
    }
  };

  const handleDelete = async () => {
    if (!id || !user) return;
    try {
      await api.deleteUser(id);
      showToast('Usuario Eliminado', `${user.name} ha sido eliminado`, 'success');
      navigate('/dashboard/');
    } catch (err) {
      showToast('Error', err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  };

  if (loading) return <SkeletonPage />;
  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
        <p>Usuario no encontrado</p>
        <Link to="/dashboard/" className="text-orange-400 hover:underline mt-2">Volver al inicio</Link>
      </div>
    );
  }

  const limits = user.limits ?? [];
  const usage = user.usage ?? {};
  const dailyUsage: Record<string, number> = usage.daily?.counts ?? {};
  const creditRule = getCreditRule(limits);
  const color = hashColor(user.name || user.slug);

  // Build bar chart data
  const barData = ['opus', 'sonnet', 'haiku'].map((m) => ({
    label: m.charAt(0).toUpperCase() + m.slice(1),
    value: dailyUsage[m] ?? 0,
    limit: getModelLimit(limits, m) > 0 ? getModelLimit(limits, m) : 0,
  }));

  // Build trend data
  const dayMap: Record<string, number> = {};
  for (const row of usageDaily) {
    dayMap[row.day] = (dayMap[row.day] ?? 0) + row.count;
  }
  const trendData: Array<{ day: string; value: number }> = [];
  const today = new Date();
  for (let td = 29; td >= 0; td--) {
    const d = new Date(today);
    d.setDate(d.getDate() - td);
    const key = d.toISOString().split('T')[0];
    trendData.push({ day: key, value: dayMap[key] ?? 0 });
  }

  const userDevices = user.devices ?? [];
  const userProjects = analytics?.project_usage ?? [];
  const userPeakHours = analytics?.peak_hours ?? [];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <Link to="/dashboard/" className="hover:text-zinc-300 transition-colors">Resumen</Link>
        <span>/</span>
        <span className="text-zinc-300">{user.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-semibold text-zinc-100">{user.name}</h2>
        <div className="flex gap-2 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => setCreditsModalOpen(true)}>
            ¿Cómo funcionan los créditos?
          </Button>
          <Button size="sm" onClick={() => setEditLimitsOpen(true)}>
            Editar Límites
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() =>
              setConfirmAction({
                action: 'delete',
                title: 'Eliminar Usuario',
                message: `¿Eliminar permanentemente a ${user.name}? Se borrán todos sus datos y no se puede deshacer.`,
                confirmLabel: 'Eliminar',
              })
            }
          >
            Eliminar Usuario
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left sidebar */}
        <div className="lg:col-span-1">
          <Card>
            <CardBody className="flex flex-col items-center text-center space-y-3">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl font-bold"
                style={{ background: color }}
              >
                {getInitials(user.name)}
              </div>
              <div>
                <div className="text-lg font-semibold text-zinc-100">{user.name}</div>
                <div className="text-sm text-zinc-500">@{user.slug}</div>
              </div>
              <StatusBadge status={user.status} />
              <div className="text-xs text-zinc-500 space-y-1 w-full text-left pt-2">
                <div>Última vez: {timeAgo(user.last_seen)}</div>
                <div>Creado: {user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}</div>
              </div>

              {/* Action buttons */}
              <div className="w-full space-y-2 pt-2">
                {user.status === 'active' && (
                  <>
                    <Button
                      size="sm"
                      variant="warning"
                      fullWidth
                      onClick={() =>
                        setConfirmAction({
                          action: 'paused',
                          title: 'Pausar Usuario',
                          message: `¿Pausar a ${user.name}? No podrá usar Claude Code hasta ser restaurado.`,
                          confirmLabel: 'Pausar',
                        })
                      }
                    >
                      Pausar Usuario
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      fullWidth
                      onClick={() =>
                        setConfirmAction({
                          action: 'killed',
                          title: 'Revocar Acceso',
                          message: `¿Revocar acceso a ${user.name}? No podrá usar Claude Code.`,
                          confirmLabel: 'Revocar',
                        })
                      }
                    >
                      Revocar Acceso
                    </Button>
                  </>
                )}
                {user.status === 'paused' && (
                  <>
                    <Button size="sm" variant="success" fullWidth onClick={() => handleStatusAction('active')}>
                      Restaurar
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      fullWidth
                      onClick={() =>
                        setConfirmAction({
                          action: 'killed',
                          title: 'Revocar Acceso',
                          message: `¿Revocar acceso a ${user.name}?`,
                          confirmLabel: 'Revocar',
                        })
                      }
                    >
                      Revocar Acceso
                    </Button>
                  </>
                )}
                {user.status === 'killed' && (
                  <Button size="sm" variant="success" fullWidth onClick={() => handleStatusAction('active')}>
                    Restaurar
                  </Button>
                )}
              </div>

              {/* Self-uninstall toggle */}
              <div className="w-full pt-2 border-t border-zinc-800">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium text-zinc-300">Permitir desinstalación propia</div>
                    <div className="text-xs text-zinc-600 mt-0.5">El usuario puede remover el hook de su máquina</div>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        await api.updateUser(user.id, { allow_self_uninstall: !user.allow_self_uninstall });
                        showToast('Guardado', `Desinstalación propia ${!user.allow_self_uninstall ? 'habilitada' : 'deshabilitada'}`, 'success');
                        loadData();
                      } catch (err) {
                        showToast('Error', err instanceof Error ? err.message : 'Falló', 'error');
                      }
                    }}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                      user.allow_self_uninstall ? 'bg-[#cc5500]' : 'bg-zinc-700'
                    }`}
                    role="switch"
                    aria-checked={user.allow_self_uninstall}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${
                        user.allow_self_uninstall ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Credit gauge */}
              {creditRule && user.credit_budget && user.credit_budget > 0 && (
                <div className="pt-4">
                  <CreditGauge
                    used={user.credit_budget - (user.credit_balance ?? 0)}
                    total={user.credit_budget}
                  />
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Right content */}
        <div className="lg:col-span-3 space-y-6">
          {/* Per-model usage */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-zinc-200">Uso por Modelo (Diario)</h3>
            </CardHeader>
            <CardBody>
              <HorizontalBarChart data={barData} />
            </CardBody>
          </Card>

          {/* Límites Activos */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-zinc-200">Límites Activos</h3>
              <Button size="sm" variant="ghost" onClick={() => setEditLimitsOpen(true)}>
                Edit
              </Button>
            </CardHeader>
            <CardBody>
              {limits.length === 0 ? (
                <p className="text-sm text-zinc-500">Sin límites configurados. Este usuario tiene acceso ilimitado.</p>
              ) : (
                <div className="space-y-2">
                  {limits.map((rule, idx) => (
                    <LimitItem key={idx} rule={rule} />
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {/* 30-day trend */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-zinc-200">Tendencia de Uso (30 días)</h3>
            </CardHeader>
            <CardBody>
              <TrendLineChart data={trendData} />
            </CardBody>
          </Card>

          {/* Devices */}
          {userDevices.length > 0 && (
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-zinc-200">Dispositivos</h3>
              </CardHeader>
              <CardBody flush>
                <Table
                  columns={[
                    { key: 'hostname', header: 'Hostname', render: (d) => <span className="text-zinc-200">{d.hostname || 'unknown'}</span> },
                    { key: 'platform', header: 'Platform', render: (d) => `${d.platform || ''}${d.arch ? ` (${d.arch})` : ''}` },
                    { key: 'claude', header: 'Claude', render: (d) => <span className="text-xs">{d.claude_version || ''}</span> },
                    { key: 'seen', header: 'Last Seen', render: (d) => <span className="text-xs">{timeAgo(d.last_seen)}</span> },
                    { key: 'ip', header: 'IP', render: (d) => <span className="font-mono text-xs">{d.last_ip || ''}</span> },
                  ]}
                  data={userDevices}
                  keyExtractor={(d) => d.id}
                />
              </CardBody>
            </Card>
          )}

          {/* Top Projects */}
          {userProjects.length > 0 && (
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-zinc-200">Proyectos Principales (30d)</h3>
              </CardHeader>
              <CardBody flush>
                <Table
                  columns={[
                    { key: 'project', header: 'Project', render: (p) => <span className="text-zinc-200">{p.project}</span> },
                    { key: 'count', header: 'Prompts', render: (p) => <span className="font-mono">{p.count}</span>, className: 'text-right' },
                  ]}
                  data={userProjects}
                  keyExtractor={(p) => p.project}
                />
              </CardBody>
            </Card>
          )}

          {/* Peak Hours */}
          {userPeakHours.length > 0 && (
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-zinc-200">Horas Pico (30d)</h3>
              </CardHeader>
              <CardBody>
                <PeakHoursChart data={userPeakHours} />
              </CardBody>
            </Card>
          )}

          {/* Recent activity */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-zinc-200">Actividad Reciente</h3>
            </CardHeader>
            <CardBody flush>
              <Table
                columns={[
                  { key: 'time', header: 'Time', render: (e) => <span className="font-mono text-xs">{timeAgo(e.timestamp)}</span> },
                  { key: 'model', header: 'Model', render: (e) => <Badge variant="model">{e.model}</Badge> },
                  { key: 'credits', header: 'Credits', render: (e) => <span className="font-mono">{e.credit_cost}</span>, className: 'text-right' },
                ]}
                data={events}
                keyExtractor={(e) => e.id ?? `${e.timestamp}-${e.model}`}
                emptyMessage="Sin actividad reciente"
              />
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Edit Limits Modal */}
      <EditLimitsModal
        open={editLimitsOpen}
        onClose={() => setEditLimitsOpen(false)}
        userId={id ?? null}
        onSaved={loadData}
        showToast={showToast}
      />

      {/* Credits Modal */}
      <Modal open={creditsModalOpen} onClose={() => setCreditsModalOpen(false)} size="lg">
        <ModalHeader onClose={() => setCreditsModalOpen(false)}>¿Cómo funcionan los créditos?</ModalHeader>
        <ModalBody>
          <div className="space-y-5 text-sm text-zinc-300">
            <p>
              Los <span className="text-[#cc5500] font-semibold">créditos</span> son una unidad de medida unificada que permite controlar el costo de uso de distintos modelos de Claude con un solo número.
            </p>

            {/* Pesos */}
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

            {/* Ejemplo */}
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

            {/* Orden de evaluación */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Orden de verificación (primer bloqueo gana)</p>
              <ol className="space-y-2 text-xs text-zinc-400">
                <li className="flex gap-2"><span className="text-red-400 font-bold flex-shrink-0">1.</span><span>¿El usuario está <span className="text-red-400">revocado o pausado</span>? → Bloqueo inmediato</span></li>
                <li className="flex gap-2"><span className="text-yellow-400 font-bold flex-shrink-0">2.</span><span>¿Hay una <span className="text-yellow-400">restricción horaria</span> activa para este modelo? → Bloqueo si fuera del horario</span></li>
                <li className="flex gap-2"><span className="text-orange-400 font-bold flex-shrink-0">3.</span><span>¿Se superó el <span className="text-orange-400">límite por modelo</span> (Opus, Sonnet, Haiku)? → Bloqueo si se agotó</span></li>
                <li className="flex gap-2"><span className="text-[#cc5500] font-bold flex-shrink-0">4.</span><span>¿El <span className="text-[#cc5500]">balance de créditos</span> alcanza para el próximo turno? → Bloqueo si no alcanza</span></li>
                <li className="flex gap-2"><span className="text-green-400 font-bold flex-shrink-0">5.</span><span className="text-green-400">Permitido ✓</span></li>
              </ol>
            </div>

            {/* Ventanas */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Tipos de ventana de tiempo</p>
              <div className="space-y-1 text-xs">
                <div className="flex gap-2"><span className="font-mono text-zinc-300 w-24 flex-shrink-0">daily</span><span className="text-zinc-500">Reinicia a medianoche en la zona horaria configurada</span></div>
                <div className="flex gap-2"><span className="font-mono text-zinc-300 w-24 flex-shrink-0">weekly</span><span className="text-zinc-500">Reinicia cada lunes</span></div>
                <div className="flex gap-2"><span className="font-mono text-zinc-300 w-24 flex-shrink-0">monthly</span><span className="text-zinc-500">Reinicia el día 1 de cada mes</span></div>
                <div className="flex gap-2"><span className="font-mono text-zinc-300 w-24 flex-shrink-0">sliding_24h</span><span className="text-zinc-500">Ventana deslizante de las últimas 24 horas</span></div>
              </div>
            </div>

            <p className="text-xs text-zinc-500">Los pesos se ajustan en <span className="text-zinc-300">Configuración → Pesos de Créditos</span>. Los límites por modelo y horarios se configuran en <span className="text-zinc-300">Editar Límites</span>.</p>
          </div>
        </ModalBody>
      </Modal>

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => {
          if (!confirmAction) return;
          if (confirmAction.action === 'delete') {
            handleDelete();
          } else {
            handleStatusAction(confirmAction.action);
          }
        }}
        title={confirmAction?.title ?? ''}
        message={confirmAction?.message ?? ''}
        confirmLabel={confirmAction?.confirmLabel ?? 'Confirm'}
      />
    </div>
  );
}

function LimitItem({ rule }: { rule: { type: string; model?: string; window?: string; value?: number; schedule_start?: string; schedule_end?: string; schedule_tz?: string } }) {
  let desc = '';
  if (rule.type === 'credits') {
    desc = `Presupuesto de Créditos (${rule.window ?? 'daily'})`;
  } else if (rule.type === 'per_model') {
    desc = `${rule.model ?? 'todos los modelos'} (${rule.window ?? 'daily'})`;
  } else if (rule.type === 'time_of_day') {
    desc = `${rule.model ?? 'todos'} restricción horaria`;
  }

  let valStr = '';
  if (rule.type === 'time_of_day') {
    valStr = `${rule.schedule_start ?? '?'} - ${rule.schedule_end ?? '?'} ${rule.schedule_tz ?? ''}`;
  } else {
    valStr = rule.value === -1 ? 'unlimited' : rule.value === 0 ? 'blocked' : String(rule.value ?? '');
  }

  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-zinc-800/30 border border-zinc-800">
      <div className="flex items-center gap-2">
        <Badge variant="model">{rule.type}</Badge>
        <span className="text-sm text-zinc-300">{desc}</span>
      </div>
      <span className="text-sm font-mono text-zinc-400">{valStr}</span>
    </div>
  );
}
