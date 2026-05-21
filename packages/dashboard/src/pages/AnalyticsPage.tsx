import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import type { AnalyticsData, Device, DailyUsageRow } from '../lib/types';
import { timeAgo } from '../lib/utils';
import { Card, CardHeader, CardBody } from '../components/Card';
import { Select } from '../components/Input';
import { Table } from '../components/Table';
import { TrendLineChart, PeakHoursChart, DonutChart, BlockRateGauge } from '../components/Charts';
import { SkeletonPage } from '../components/Skeleton';

export function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [usageDaily, setUsageDaily] = useState<DailyUsageRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [analyticsRes, usageRes] = await Promise.all([
        api.getAnalytics({ days }),
        api.getUsage({ days }),
      ]);
      setData(analyticsRes);
      setUsageDaily(usageRes.daily ?? []);
    } catch {
      // handled by interceptor
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) return <SkeletonPage />;
  if (!data) {
    return (
      <div className="flex items-center justify-center py-20 text-zinc-500">
        Failed to load analytics
      </div>
    );
  }

  // Build DAU trend
  const dauPts: Array<{ day: string; value: number }> = [];
  const dayMap: Record<string, number> = {};
  for (const d of data.daily_active ?? []) {
    dayMap[d.date] = d.users;
  }
  // Build team credits trend
  const creditsByDay: Record<string, number> = {};
  for (const d of data.daily_credits ?? []) {
    creditsByDay[d.date] = d.credits;
  }
  const creditsPts: Array<{ day: string; value: number }> = [];
  const today = new Date();
  for (let td = Math.min(days, 30) - 1; td >= 0; td--) {
    const d = new Date(today);
    d.setDate(d.getDate() - td);
    const key = d.toISOString().split('T')[0];
    dauPts.push({ day: key, value: dayMap[key] ?? 0 });
    creditsPts.push({ day: key, value: creditsByDay[key] ?? 0 });
  }

  // Build Top Consumers ranking — group usageDaily rows by user_id,
  // sum credits and prompts across the entire selected range.
  type Consumer = { user_id: string; user_name: string; credits: number; prompts: number };
  const consumerMap: Record<string, Consumer> = {};
  for (const row of usageDaily) {
    if (!row.user_id) continue;
    const key = row.user_id;
    if (!consumerMap[key]) {
      consumerMap[key] = {
        user_id: row.user_id,
        user_name: row.user_name ?? row.user_id,
        credits: 0,
        prompts: 0,
      };
    }
    consumerMap[key].credits += row.credits ?? 0;
    consumerMap[key].prompts += row.count ?? 0;
  }
  const topConsumers = Object.values(consumerMap).sort((a, b) => b.credits - a.credits);

  const devices: Array<Device & { user_name?: string; user_slug?: string }> = data.devices ?? [];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-zinc-100">Analíticas</h2>
        <div className="w-40">
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
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Prom. Long. Prompt" value={data.avg_prompt_length ?? 0} sub="caracteres" />
        <StatCard label="Prom. Long. Respuesta" value={data.avg_response_length ?? 0} sub="caracteres" />
        <StatCard
          label="Prompts / Sesión"
          value={data.avg_prompts_per_session ?? 0}
        />
        <StatCard
          label="Tasa de Bloqueo"
          value={
            data.block_rate
              ? `${(data.block_rate.rate * 100).toFixed(1)}%`
              : '0%'
          }
          sub={
            data.block_rate
              ? `${data.block_rate.blocked}/${data.block_rate.total} bloqueados`
              : ''
          }
        />
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left */}
        <div className="space-y-6">
          {/* Model Distribution */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-zinc-200">Distribución por Modelo</h3>
            </CardHeader>
            <CardBody className="flex justify-center">
              {data.model_distribution ? (
                <DonutChart data={data.model_distribution} />
              ) : (
                <p className="text-sm text-zinc-500 py-4">Sin datos</p>
              )}
            </CardBody>
          </Card>

          {/* Block Rate Gauge */}
          {data.block_rate && (
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-zinc-200">Tasa de Bloqueo</h3>
              </CardHeader>
              <CardBody className="flex justify-center">
                <BlockRateGauge total={data.block_rate.total} blocked={data.block_rate.blocked} />
              </CardBody>
            </Card>
          )}

          {/* Top Consumers — ranking by credits in the selected range */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-zinc-200">Top Consumidores ({days} días)</h3>
            </CardHeader>
            <CardBody flush>
              <Table
                columns={[
                  { key: 'user_name', header: 'Usuario', render: (c) => <span className="text-zinc-200">{c.user_name}</span> },
                  { key: 'credits', header: 'Créditos', render: (c) => <span className="font-mono text-zinc-100">{c.credits}</span>, className: 'text-right' },
                  { key: 'prompts', header: 'Prompts', render: (c) => <span className="font-mono text-zinc-400">{c.prompts}</span>, className: 'text-right' },
                ]}
                data={topConsumers}
                keyExtractor={(c) => c.user_id}
                emptyMessage="Sin consumo registrado en este rango"
              />
            </CardBody>
          </Card>

          {/* Top Projects */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-zinc-200">Proyectos Principales</h3>
            </CardHeader>
            <CardBody flush>
              <Table
                columns={[
                  { key: 'project', header: 'Proyecto', render: (p) => <span className="text-zinc-200">{p.project}</span> },
                  { key: 'count', header: 'Prompts', render: (p) => <span className="font-mono">{p.count}</span>, className: 'text-right' },
                ]}
                data={data.project_usage ?? []}
                keyExtractor={(p) => p.project}
                emptyMessage="Sin datos de proyectos aún"
              />
            </CardBody>
          </Card>
        </div>

        {/* Right */}
        <div className="space-y-6">
          {/* Daily Active Users */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-zinc-200">Usuarios Activos Diarios</h3>
            </CardHeader>
            <CardBody>
              <TrendLineChart data={dauPts} />
            </CardBody>
          </Card>

          {/* Team credits consumed per day */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-zinc-200">Consumo del Equipo (créditos/día)</h3>
            </CardHeader>
            <CardBody>
              <TrendLineChart data={creditsPts} />
            </CardBody>
          </Card>

          {/* Peak Hours */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-zinc-200">Horas Pico de Uso</h3>
            </CardHeader>
            <CardBody>
              {data.peak_hours && data.peak_hours.length > 0 ? (
                <PeakHoursChart data={data.peak_hours} />
              ) : (
                <p className="text-sm text-zinc-500 py-4 text-center">Sin datos de horas pico</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Dispositivos table */}
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold text-zinc-200">Dispositivos</h3>
        </CardHeader>
        <CardBody flush>
          <Table
            columns={[
              { key: 'hostname', header: 'Hostname', render: (d) => <span className="text-zinc-200">{d.hostname || 'desconocido'}</span> },
              { key: 'user', header: 'Usuario', render: (d) => d.user_name || d.user_slug || '' },
              { key: 'platform', header: 'Plataforma', render: (d) => `${d.platform || ''}${d.arch ? ` (${d.arch})` : ''}` },
              { key: 'os', header: 'Versión SO', render: (d) => <span className="text-xs">{d.os_version || ''}</span> },
              { key: 'claude', header: 'Claude', render: (d) => <span className="text-xs">{d.claude_version || ''}</span> },
              { key: 'seen', header: 'Última vez', render: (d) => <span className="text-xs">{timeAgo(d.last_seen)}</span> },
              { key: 'ip', header: 'IP', render: (d) => <span className="font-mono text-xs">{d.last_ip || ''}</span> },
            ]}
            data={devices}
            keyExtractor={(d) => d.id}
            emptyMessage="Sin dispositivos registrados aún"
          />
        </CardBody>
      </Card>
    </div>
  );
}

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
