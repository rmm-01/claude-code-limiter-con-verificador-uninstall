import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { User, DailyUsageRow, UsageEvent, AnalyticsData } from '../lib/types';
import { hashColor, getInitials, getModelLimit, getCreditRule, timeAgo } from '../lib/utils';
import { Card, CardHeader, CardBody } from '../components/Card';
import { StatusBadge, Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Select } from '../components/Input';
import { Table } from '../components/Table';
import { CreditGauge } from '../components/CreditGauge';
import { HorizontalBarChart, TrendLineChart, PeakHoursChart } from '../components/Charts';
import { SkeletonPage } from '../components/Skeleton';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EditLimitsModal } from './EditLimitsModal';
import { Modal, ModalHeader, ModalBody } from '../components/Modal';
import { CreditsExplainer } from './OverviewPage';

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
  const [days, setDays] = useState(30);
  const [editLimitsOpen, setEditLimitsOpen] = useState(false);
  const [creditsModalOpen, setCreditsModalOpen] = useState(false);
  const [installCodeModal, setInstallCodeModal] = useState(false);
  const [installCode, setInstallCode] = useState<string | null>(null);
  const [installCodeLoading, setInstallCodeLoading] = useState(false);
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
        api.getUsage({ user_id: id, days }),
        api.getEvents({ user_id: id, limit: 20 }),
        api.getAnalytics({ user_id: id, days }),
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
  }, [id, days, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openInstallCodeModal = async () => {
    if (!id) return;
    setInstallCodeLoading(true);
    setInstallCodeModal(true);
    try {
      const res = await api.getInstallCode(id);
      setInstallCode(res.install_code);
    } catch {
      setInstallCode(null);
    } finally {
      setInstallCodeLoading(false);
    }
  };

  const handleRegenerateCode = async () => {
    if (!id) return;
    setInstallCodeLoading(true);
    try {
      const res = await api.regenerateInstallCode(id);
      setInstallCode(res.install_code);
      showToast('Código generado', 'El código anterior fue invalidado', 'success');
    } catch (err) {
      showToast('Error', err instanceof Error ? err.message : 'No se pudo generar', 'error');
    } finally {
      setInstallCodeLoading(false);
    }
  };

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

  // Build trend data — promptsByDay (count) and creditsByDay (credit_cost sum)
  const promptsByDay: Record<string, number> = {};
  const creditsByDay: Record<string, number> = {};
  for (const row of usageDaily) {
    promptsByDay[row.day] = (promptsByDay[row.day] ?? 0) + row.count;
    creditsByDay[row.day] = (creditsByDay[row.day] ?? 0) + (row.credits ?? 0);
  }
  const trendData: Array<{ day: string; value: number }> = [];
  const creditsTrendData: Array<{ day: string; value: number }> = [];
  const today = new Date();
  for (let td = days - 1; td >= 0; td--) {
    const d = new Date(today);
    d.setDate(d.getDate() - td);
    const key = d.toISOString().split('T')[0];
    trendData.push({ day: key, value: promptsByDay[key] ?? 0 });
    creditsTrendData.push({ day: key, value: creditsByDay[key] ?? 0 });
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

      {/* Tamper banner — visible only when the hook recently reported a
          managed-settings hash that doesn't match the expected one. */}
      {user.last_tampering_at && Date.now() - new Date(user.last_tampering_at).getTime() < 2 * 60 * 60 * 1000 && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          <strong>⚠ Manipulación detectada.</strong>{' '}
          El hook reportó que <code>managed-settings.json</code> de este usuario no coincide con el hash esperado.
          Última detección: {new Date(user.last_tampering_at).toLocaleString()}.
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-zinc-100">{user.name}</h2>
          <button
            onClick={openInstallCodeModal}
            title="Código de instalación"
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="3" cy="8" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="13" cy="8" r="1.5" />
            </svg>
          </button>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <div className="w-36">
            <Select
              value={String(days)}
              onChange={(e) => setDays(parseInt(e.target.value, 10))}
            >
              <option value="7">Últimos 7 días</option>
              <option value="14">Últimos 14 días</option>
              <option value="30">Últimos 30 días</option>
              <option value="90">Últimos 90 días</option>
            </Select>
          </div>
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
                message: `¿Eliminar permanentemente a ${user.name}? Se borrarán todos sus datos y no se puede deshacer.`,
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
                Editar
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

          {/* Trend — prompts */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-zinc-200">Tendencia de Uso ({days} días) — prompts</h3>
            </CardHeader>
            <CardBody>
              <TrendLineChart data={trendData} />
            </CardBody>
          </Card>

          {/* Trend — credits consumed (historic) */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-zinc-200">Créditos Consumidos ({days} días)</h3>
            </CardHeader>
            <CardBody>
              <TrendLineChart data={creditsTrendData} />
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
                    { key: 'hostname', header: 'Hostname', render: (d) => <span className="text-zinc-200">{d.hostname || 'desconocido'}</span> },
                    { key: 'platform', header: 'Plataforma', render: (d) => `${d.platform || ''}${d.arch ? ` (${d.arch})` : ''}` },
                    { key: 'claude', header: 'Claude', render: (d) => <span className="text-xs">{d.claude_version || ''}</span> },
                    { key: 'seen', header: 'Última vez', render: (d) => <span className="text-xs">{timeAgo(d.last_seen)}</span> },
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
                  { key: 'time', header: 'Hora', render: (e) => <span className="font-mono text-xs">{timeAgo(e.timestamp)}</span> },
                  { key: 'model', header: 'Modelo', render: (e) => <Badge variant="model">{e.model}</Badge> },
                  { key: 'credits', header: 'Créditos', render: (e) => <span className="font-mono">{e.credit_cost}</span>, className: 'text-right' },
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

      {/* Install Code Modal */}
      <Modal open={installCodeModal} onClose={() => setInstallCodeModal(false)} size="md">
        <ModalHeader onClose={() => setInstallCodeModal(false)}>Código de Instalación</ModalHeader>
        <ModalBody>
          {installCodeLoading ? (
            <div className="py-4 text-center text-zinc-500 text-sm">Cargando...</div>
          ) : installCode ? (
            <div className="space-y-4">
              <p className="text-sm text-zinc-400">Código pendiente — aún no ha sido usado para vincular ninguna máquina.</p>
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 flex items-center justify-between gap-3">
                <code className="text-[#cc5500] font-mono text-sm">{installCode}</code>
                <button
                  onClick={() => { navigator.clipboard.writeText(installCode); showToast('Copiado', 'Código copiado al portapapeles', 'success'); }}
                  className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                >Copiar</button>
              </div>
              <button
                onClick={handleRegenerateCode}
                disabled={installCodeLoading}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer underline"
              >
                Generar nuevo código (invalida el actual)
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-zinc-400">No hay código pendiente para este usuario. El código anterior ya fue usado para vincular una máquina.</p>
              <button
                onClick={handleRegenerateCode}
                disabled={installCodeLoading}
                className="w-full py-2 px-4 rounded-lg bg-[#cc5500] hover:bg-[#e06012] text-white text-sm font-medium transition-colors cursor-pointer"
              >
                {installCodeLoading ? 'Generando...' : 'Generar nuevo código'}
              </button>
            </div>
          )}
        </ModalBody>
      </Modal>

      {/* Credits Modal */}
      <Modal open={creditsModalOpen} onClose={() => setCreditsModalOpen(false)} size="lg">
        <ModalHeader onClose={() => setCreditsModalOpen(false)}>¿Cómo funcionan los créditos?</ModalHeader>
        <ModalBody>
          <CreditsExplainer />
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
    const wLabel: Record<string, string> = { daily: 'diario', weekly: 'semanal', monthly: 'mensual', sliding_24h: 'últ. 24h' };
    desc = `Presupuesto de Créditos (${wLabel[rule.window ?? ''] ?? rule.window ?? 'diario'})`;
  } else if (rule.type === 'per_model') {
    const wLabel: Record<string, string> = { daily: 'diario', weekly: 'semanal', monthly: 'mensual', sliding_24h: 'últ. 24h' };
    desc = `${rule.model ?? 'todos los modelos'} (${wLabel[rule.window ?? ''] ?? rule.window ?? 'diario'})`;
  } else if (rule.type === 'time_of_day') {
    desc = `${rule.model ?? 'todos'} restricción horaria`;
  }

  let valStr = '';
  if (rule.type === 'time_of_day') {
    valStr = `${rule.schedule_start ?? '?'} - ${rule.schedule_end ?? '?'} ${rule.schedule_tz ?? ''}`;
  } else {
    valStr = rule.value === -1 ? 'ilimitado' : rule.value === 0 ? 'bloqueado' : String(rule.value ?? '');
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
