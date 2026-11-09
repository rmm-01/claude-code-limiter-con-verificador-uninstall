import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import type { AnalyticsData, Device, DailyUsageRow } from '../lib/types';
import { timeAgo, formatTokens, TOKENS_NA, TOKENS_NA_HINT } from '../lib/utils';
import { TokenValue } from '../components/Tokens';
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
  const tokensByDay: Record<string, number> = {};
  for (const d of data.daily_credits ?? []) {
    creditsByDay[d.date] = d.credits;
    tokensByDay[d.date] = d.tokens ?? 0;
  }
  const creditsPts: Array<{ day: string; value: number }> = [];
  const tokensPts: Array<{ day: string; value: number }> = [];
  const today = new Date();
  for (let td = Math.min(days, 30) - 1; td >= 0; td--) {
    const d = new Date(today);
    d.setDate(d.getDate() - td);
    const key = d.toISOString().split('T')[0];
    dauPts.push({ day: key, value: dayMap[key] ?? 0 });
    creditsPts.push({ day: key, value: creditsByDay[key] ?? 0 });
    tokensPts.push({ day: key, value: tokensByDay[key] ?? 0 });
  }
  const teamTokensTotal = tokensPts.reduce((s, p) => s + p.value, 0);

  // Build Top Consumers ranking — group usageDaily rows by user_id,
  // sum credits, prompts and real tokens across the entire selected range.
  type Consumer = {
    user_id: string; user_name: string; credits: number; prompts: number;
    input_tokens: number; output_tokens: number; cache_read_tokens: number; turns_with_tokens: number;
  };
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
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        turns_with_tokens: 0,
      };
    }
    const c = consumerMap[key];
    c.credits += row.credits ?? 0;
    c.prompts += row.count ?? 0;
    c.input_tokens += row.input_tokens ?? 0;
    c.output_tokens += row.output_tokens ?? 0;
    c.cache_read_tokens += row.cache_read_tokens ?? 0;
    c.turns_with_tokens += row.turns_with_tokens ?? 0;
  }
  // Rank by the same input+output total the Tokens column displays; credits break ties.
  const shownTokens = (c: { input_tokens: number; output_tokens: number }) => c.input_tokens + c.output_tokens;
  const topConsumers = Object.values(consumerMap).sort(
    (a, b) => shownTokens(b) - shownTokens(a) || b.credits - a.credits,
  );

  // Tokens (input+output) per user per day, last 7 days. Days are UTC like the trend charts above.
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().split('T')[0];
  });
  const userDay: Record<string, { name: string; byDay: Record<string, number> }> = {};
  for (const row of usageDaily) {
    if (!row.user_id || !last7.includes(row.day)) continue;
    const u = (userDay[row.user_id] ??= { name: row.user_name ?? row.user_id, byDay: {} });
    u.byDay[row.day] = (u.byDay[row.day] ?? 0) + (row.input_tokens ?? 0) + (row.output_tokens ?? 0);
  }
  const userDayRows = Object.entries(userDay).map(([id, u]) => ({
    id,
    name: u.name,
    byDay: u.byDay,
    total: last7.reduce((s, k) => s + (u.byDay[k] ?? 0), 0),
  })).sort((a, b) => b.total - a.total);

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

      {/* Tokens por usuario y día (últimos 7 días) */}
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold text-zinc-200">Tokens por Día (últimos 7 días)</h3>
        </CardHeader>
        <CardBody flush>
          <Table
            columns={[
              { key: 'name', header: 'Usuario', render: (r) => <span className="text-zinc-200">{r.name}</span> },
              ...last7.map((k) => ({
                key: k,
                header: k.slice(5),
                render: (r: (typeof userDayRows)[number]) => (
                  <span className="font-mono text-zinc-300">{r.byDay[k] ? formatTokens(r.byDay[k]) : '–'}</span>
                ),
                className: 'text-right',
              })),
              { key: 'total', header: 'Total', render: (r) => <span className="font-mono text-zinc-100">{formatTokens(r.total)}</span>, className: 'text-right' },
            ]}
            data={userDayRows}
            keyExtractor={(r) => r.id}
            emptyMessage="Sin consumo registrado en los últimos 7 días"
          />
        </CardBody>
      </Card>

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

          {/* Top Consumers — ranking by tokens in the selected range */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-zinc-200">Top Consumidores ({days} días)</h3>
            </CardHeader>
            <CardBody flush>
              <Table
                columns={[
                  { key: 'user_name', header: 'Usuario', render: (c) => <span className="text-zinc-200">{c.user_name}</span> },
                  { key: 'credits', header: 'Créditos', render: (c) => <span className="font-mono text-zinc-100">{c.credits}</span>, className: 'text-right' },
                  {
                    key: 'tokens',
                    header: 'Tokens',
                    render: (c) => (
                      <span className="text-zinc-100">
                        <TokenValue input={c.input_tokens} output={c.output_tokens} cacheRead={c.cache_read_tokens} hasData={c.turns_with_tokens > 0} />
                      </span>
                    ),
                    className: 'text-right',
                  },
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

          {/* Team real tokens (input + output) per day */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-zinc-200">Consumo del Equipo (tokens/día)</h3>
              <span className="text-xs font-mono text-zinc-400">
                {teamTokensTotal > 0 ? `${formatTokens(teamTokensTotal)} tokens` : `tokens ${TOKENS_NA}`}
              </span>
            </CardHeader>
            <CardBody>
              {teamTokensTotal > 0 ? (
                <TrendLineChart data={tokensPts} />
              ) : (
                <p className="text-sm text-zinc-500 py-6 text-center">{TOKENS_NA_HINT}</p>
              )}
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
