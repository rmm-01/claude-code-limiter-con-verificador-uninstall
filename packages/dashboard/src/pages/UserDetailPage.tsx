import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { User, DailyUsageRow, UsageEvent, ModelMismatch, AnalyticsData, VersionUsage, SubagentUsage } from '../lib/types';
import { hashColor, getInitials, getModelLimit, getCreditRule, timeAgo, TOKENS_NA_HINT } from '../lib/utils';
import { TokensLine, TokenValue } from '../components/Tokens';
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
import { UpdateCommandModal } from '../components/UpdateCommandModal';
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
  const [mismatches, setMismatches] = useState<ModelMismatch[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [versionData, setVersionData] = useState<VersionUsage[]>([]);
  const [subagentData, setSubagentData] = useState<SubagentUsage[]>([]);
  const [days, setDays] = useState(30);
  const [editLimitsOpen, setEditLimitsOpen] = useState(false);
  const [creditsModalOpen, setCreditsModalOpen] = useState(false);
  const [installCodeModal, setInstallCodeModal] = useState(false);
  const [installCode, setInstallCode] = useState<string | null>(null);
  const [installCodeLoading, setInstallCodeLoading] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    action: string;
    title: string;
    message: string;
    confirmLabel: string;
  } | null>(null);

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      const [u, usageRes, eventsRes, analyticsRes, versionsRes, mismatchRes] = await Promise.all([
        api.getUser(id),
        api.getUsage({ user_id: id, days }),
        api.getEvents({ user_id: id, limit: 20 }),
        api.getAnalytics({ user_id: id, days }),
        api.getUsageVersions({ user_id: id, days }),
        api.getMismatches(id),
      ]);
      setUser(u);
      setMismatches(mismatchRes.mismatches ?? []);
      setUsageDaily(usageRes.daily ?? []);
      setEvents(eventsRes.events ?? []);
      setAnalytics(analyticsRes);
      setVersionData(versionsRes.versions ?? []);
      setSubagentData(versionsRes.subagents ?? []);
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
  const barData = ['fable', 'opus', 'sonnet', 'haiku'].map((m) => ({
    label: m.charAt(0).toUpperCase() + m.slice(1),
    value: dailyUsage[m] ?? 0,
    limit: getModelLimit(limits, m) > 0 ? getModelLimit(limits, m) : 0,
  }));

  // Build trend data — prompts (count), credits (credit_cost sum) and real
  // tokens (input + output) per day
  const promptsByDay: Record<string, number> = {};
  const creditsByDay: Record<string, number> = {};
  const tokensByDay: Record<string, number> = {};
  const periodTokens = { input: 0, output: 0, cache_read: 0, total: 0, turns_with_tokens: 0 };
  for (const row of usageDaily) {
    promptsByDay[row.day] = (promptsByDay[row.day] ?? 0) + row.count;
    creditsByDay[row.day] = (creditsByDay[row.day] ?? 0) + (row.credits ?? 0);
    const t = (row.input_tokens ?? 0) + (row.output_tokens ?? 0);
    tokensByDay[row.day] = (tokensByDay[row.day] ?? 0) + t;
    periodTokens.input += row.input_tokens ?? 0;
    periodTokens.output += row.output_tokens ?? 0;
    periodTokens.cache_read += row.cache_read_tokens ?? 0;
    periodTokens.total += t;
    periodTokens.turns_with_tokens += row.turns_with_tokens ?? 0;
  }
  const periodCredits = Object.values(creditsByDay).reduce((s, n) => s + n, 0);
  const trendData: Array<{ day: string; value: number }> = [];
  const creditsTrendData: Array<{ day: string; value: number }> = [];
  const tokensTrendData: Array<{ day: string; value: number }> = [];
  const today = new Date();
  for (let td = days - 1; td >= 0; td--) {
    const d = new Date(today);
    d.setDate(d.getDate() - td);
    const key = d.toISOString().split('T')[0];
    trendData.push({ day: key, value: promptsByDay[key] ?? 0 });
    creditsTrendData.push({ day: key, value: creditsByDay[key] ?? 0 });
    tokensTrendData.push({ day: key, value: tokensByDay[key] ?? 0 });
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
          <Button size="sm" variant="ghost" onClick={() => setUpdateOpen(true)}>Comando de actualización</Button>
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

              {/* Agent View / Remote Control toggle */}
              <div className="w-full pt-2 border-t border-zinc-800">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium text-zinc-300">Permitir Agent View / Remote Control</div>
                    <div className="text-xs text-zinc-600 mt-0.5">El conteo de uso podría no ser preciso en estos modos</div>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        await api.updateUser(user.id, { allow_agents: !user.allow_agents });
                        showToast('Guardado', `Agent View / Remote Control ${!user.allow_agents ? 'habilitado' : 'deshabilitado'}`, 'success');
                        loadData();
                      } catch (err) {
                        showToast('Error', err instanceof Error ? err.message : 'Falló', 'error');
                      }
                    }}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                      user.allow_agents ? 'bg-[#cc5500]' : 'bg-zinc-700'
                    }`}
                    role="switch"
                    aria-checked={user.allow_agents}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${
                        user.allow_agents ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* User hooks toggle (allowManagedHooksOnly off) */}
              <div className="w-full pt-2 border-t border-zinc-800">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium text-zinc-300">Permitir hooks propios del usuario</div>
                    <div className="text-xs text-zinc-600 mt-0.5">Desactiva allowManagedHooksOnly (statusLine, hooks personales)</div>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        await api.updateUser(user.id, { allow_user_hooks: !user.allow_user_hooks });
                        showToast('Guardado', `Hooks propios ${!user.allow_user_hooks ? 'permitidos' : 'bloqueados'}`, 'success');
                        loadData();
                      } catch (err) {
                        showToast('Error', err instanceof Error ? err.message : 'Falló', 'error');
                      }
                    }}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                      user.allow_user_hooks ? 'bg-[#cc5500]' : 'bg-zinc-700'
                    }`}
                    role="switch"
                    aria-checked={user.allow_user_hooks}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${
                        user.allow_user_hooks ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Workflows / Subagents toggle */}
              <div className="w-full pt-2 border-t border-zinc-800">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium text-zinc-300">Permitir Workflows / Subagentes</div>
                    <div className="text-xs text-zinc-600 mt-0.5">Habilita ejecución de workflows y agentes masivos</div>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        await api.updateUser(user.id, { allow_workflows: !user.allow_workflows });
                        showToast('Guardado', `Workflows ${!user.allow_workflows ? 'habilitados' : 'deshabilitados'}`, 'success');
                        loadData();
                      } catch (err) {
                        showToast('Error', err instanceof Error ? err.message : 'Falló', 'error');
                      }
                    }}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                      user.allow_workflows ? 'bg-[#cc5500]' : 'bg-zinc-700'
                    }`}
                    role="switch"
                    aria-checked={user.allow_workflows}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${
                        user.allow_workflows ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Max effort level selector */}
              <div className="w-full pt-2 border-t border-zinc-800">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium text-zinc-300">Effort Máximo</div>
                    <div className="text-xs text-zinc-600 mt-0.5">Nivel de razonamiento máximo permitido</div>
                  </div>
                  <select
                    value={user.max_effort_level || 'max'}
                    onChange={async (e) => {
                      try {
                        await api.updateUser(user.id, { max_effort_level: e.target.value as 'low' | 'medium' | 'high' | 'xhigh' | 'max' });
                        showToast('Guardado', `Effort máximo: ${e.target.value}`, 'success');
                        loadData();
                      } catch (err) {
                        showToast('Error', err instanceof Error ? err.message : 'Falló', 'error');
                      }
                    }}
                    className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="xhigh">XHigh</option>
                    <option value="max">Max (sin límite)</option>
                  </select>
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

          {/* Uso por Versión */}
          {versionData.length > 0 && (
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-zinc-200">Uso por Versión</h3>
              </CardHeader>
              <CardBody>
                <div className="space-y-1.5">
                  {versionData.map((v, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-zinc-800 last:border-0">
                      <span className="text-zinc-300 font-mono">{v.model_version || v.model}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-zinc-400">{v.count} turnos</span>
                        <span className="text-zinc-500">{v.total_credits} cr</span>
                        <span className="text-zinc-400 w-16 text-right">
                          <TokenValue
                            input={v.input_tokens}
                            output={v.output_tokens}
                            cacheRead={v.cache_read_tokens}
                            hasData={(v.input_tokens ?? 0) + (v.output_tokens ?? 0) > 0}
                          /> tok
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}

          {/* Subagentes: ya incluidos en el uso por versión, acá por el modelo que corrió */}
          {subagentData.length > 0 && (
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-zinc-200">Tokens de Subagentes</h3>
                <span className="text-xs text-zinc-500">incluidos en el total · solo hooks actualizados</span>
              </CardHeader>
              <CardBody>
                <div className="space-y-1.5">
                  {subagentData.map((s) => (
                    <div key={s.model_version} className="flex items-center justify-between text-xs py-1 border-b border-zinc-800 last:border-0">
                      <span className="text-zinc-300 font-mono">{s.model_version}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-zinc-400">{s.turns} turnos</span>
                        <span className="text-zinc-400 w-16 text-right">
                          <TokenValue
                            input={s.input_tokens}
                            output={s.output_tokens}
                            cacheRead={s.cache_read_tokens}
                            hasData
                          /> tok
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}

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
              <span className="text-xs font-mono text-zinc-400">{periodCredits} créditos</span>
            </CardHeader>
            <CardBody>
              <TrendLineChart data={creditsTrendData} />
            </CardBody>
          </Card>

          {/* Trend — real tokens (input + output) */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-zinc-200">Tokens Consumidos ({days} días)</h3>
              <TokensLine tokens={periodTokens} />
            </CardHeader>
            <CardBody>
              {periodTokens.turns_with_tokens > 0 ? (
                <TrendLineChart data={tokensTrendData} />
              ) : (
                <p className="text-sm text-zinc-500 py-6 text-center">{TOKENS_NA_HINT}</p>
              )}
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
                  { key: 'model', header: 'Modelo', render: (e) => <Badge variant="model">{e.model_version || e.model}</Badge> },
                  { key: 'credits', header: 'Créditos', render: (e) => <span className="font-mono">{e.credit_cost}</span>, className: 'text-right' },
                  { key: 'tokens', header: 'Tokens', render: (e) => <TokenValue input={e.input_tokens} output={e.output_tokens} />, className: 'text-right' },
                ]}
                data={events}
                keyExtractor={(e) => e.id ?? `${e.timestamp}-${e.model}`}
                emptyMessage="Sin actividad reciente"
              />
            </CardBody>
          </Card>

          {/* Modelo declarado vs ejecutado: solo aparece si hubo discrepancias */}
          {mismatches.length > 0 && (
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-red-300">Modelo Falsificado</h3>
              </CardHeader>
              <CardBody flush>
                <Table
                  columns={[
                    { key: 'time', header: 'Hora', render: (m) => <span className="font-mono text-xs">{timeAgo(m.timestamp)}</span> },
                    { key: 'ran', header: 'Ejecutó', render: (m) => <Badge variant="model">{m.model}</Badge> },
                    { key: 'detail', header: 'Detalle', render: (m) => <span className="text-xs text-zinc-400">{m.blocked_reason ?? ''}</span> },
                  ]}
                  data={mismatches}
                  keyExtractor={(m) => String(m.id)}
                  emptyMessage=""
                />
              </CardBody>
            </Card>
          )}
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

      <UpdateCommandModal open={updateOpen} onClose={() => setUpdateOpen(false)} userId={id ?? null} userName={user?.name} showToast={showToast} />

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
