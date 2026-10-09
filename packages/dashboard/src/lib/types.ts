/* ================================================================
   Shared TypeScript types for the Claude Code Limiter dashboard
   ================================================================ */

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface LimitRule {
  id?: string;
  type: 'per_model' | 'credits' | 'time_of_day' | 'subagents' | 'tokens';
  model?: string;
  window?: string;
  value?: number;
  schedule_start?: string;
  schedule_end?: string;
  schedule_tz?: string;
}

export interface Device {
  id: string;
  hostname: string;
  platform: string;
  arch: string;
  os_version: string;
  claude_version: string;
  last_seen: string;
  last_ip: string;
}

export interface UsageCounts {
  [model: string]: number;
}

export interface UsageSummary {
  daily?: { counts: UsageCounts };
  weekly?: { counts: UsageCounts };
  monthly?: { counts: UsageCounts };
}

export interface User {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'paused' | 'killed';
  killed_at: string | null;
  last_seen: string | null;
  last_session: string | null;
  created_at: string;
  limits: LimitRule[];
  usage: UsageSummary;
  credit_balance: number | null;
  credit_budget: number | null;
  devices: Device[];
  allow_self_uninstall: boolean;
  allow_agents: boolean;
  allow_user_hooks: boolean;
  allow_workflows: boolean;
  max_effort_level: EffortLevel;
  // Credits consumed on each of the last 7 days (oldest first).
  // Optional — older server builds don't include it.
  daily_credits_7d?: number[];
  // Last 7 days. Only turns counted by a hook that reports them (v1.5+).
  tokens_7d?: TokenTotals;
  versions_7d?: Array<{ model: string; model_version: string; count: number }>;
  // Timestamp (UTC ISO) of the last time the hook reported a
  // managed-settings.json hash that did not match the expected one.
  // Null = never tampered (or older client/server without tamper detection).
  last_tampering_at?: string | null;
}

export interface TokenTotals {
  input: number;       // new input + cache writes
  output: number;
  cache_read: number;  // prompt-cache reads, reported apart
  total: number;       // input + output
  turns_with_tokens?: number; // turns in the window that reported tokens
}

export interface VersionUsage {
  model: string;
  model_version: string | null;
  count: number;
  total_credits: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  user_id?: string;
  user_name?: string;
}

/** Subagent tokens by the model they ran; a subset of the turn totals. */
export interface SubagentUsage {
  model_version: string;
  turns: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
}

export interface EffortMultipliers {
  low: number;
  medium: number;
  high: number;
  xhigh: number;
  max: number;
  [key: string]: number;
}

export interface Team {
  id: string;
  name: string;
  credit_weights: CreditWeights;
  effort_multipliers?: EffortMultipliers;
  weekly_reset?: WeeklyReset;
}

/** When the Claude subscription's weekly limit resets (day 0=Sun..6=Sat). */
export interface WeeklyReset {
  day: number;
  hour: number;
  tz: string;
}

export interface CreditWeights {
  fable: number;
  opus: number;
  sonnet: number;
  haiku: number;
  [key: string]: number;
}

export interface UsageEvent {
  id: string;
  user_id: string;
  user_name: string;
  model: string;
  model_version?: string | null;
  credit_cost: number;
  input_tokens?: number | null;
  output_tokens?: number | null;
  timestamp: string;
}

export interface DailyUsageRow {
  day: string;
  user_id?: string;
  user_name?: string;
  model: string;
  count: number;
  credits: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  turns_with_tokens?: number;
}

export interface AnalyticsData {
  avg_prompt_length: number;
  avg_response_length: number;
  avg_prompts_per_session: number;
  block_rate: {
    total: number;
    blocked: number;
    rate: number;
  };
  model_distribution: { [model: string]: number };
  peak_hours: Array<{ hour: number; count: number }>;
  daily_active: Array<{ date: string; users: number }>;
  daily_credits?: Array<{ date: string; credits: number; prompts: number; tokens?: number }>;
  project_usage: Array<{ project: string; count: number }>;
  devices: Array<Device & { user_name?: string; user_slug?: string }>;
}

export interface CreateUserPayload {
  name: string;
  slug: string;
  limits?: LimitRule[];
}

export interface UpdateUserPayload {
  name?: string;
  slug?: string;
  status?: string;
  limits?: LimitRule[];
  allow_self_uninstall?: boolean;
  allow_agents?: boolean;
  allow_user_hooks?: boolean;
  allow_workflows?: boolean;
  max_effort_level?: EffortLevel;
}

export interface UpdateSettingsPayload {
  name?: string;
  credit_weights?: CreditWeights;
  effort_multipliers?: EffortMultipliers;
  weekly_reset?: WeeklyReset;
  admin_password?: string;
}

export interface LoginResponse {
  token: string;
  team: Team;
}

export interface CreateUserResponse {
  user: {
    id: string;
    slug: string;
    name: string;
    status: string;
    auth_token: string;
    created_at: string;
  };
  limits: LimitRule[];
  install_code: string;
}

export type WSEventType =
  | 'user_check'
  | 'user_blocked'
  | 'user_counted'
  | 'user_status_change'
  | 'user_killed'
  | 'user_status'
  | 'ws_connected'
  | 'ws_disconnected';

export interface WSEvent {
  type: WSEventType;
  userId?: string;
  userName?: string;
  model?: string;
  modelVersion?: string | null;
  reason?: string;
  creditCost?: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  oldStatus?: string;
  newStatus?: string;
  projectDir?: string;
  hostname?: string;
  sessionId?: string;
  timestamp: string;
}

export interface FeedItem {
  id: string;
  type: 'check' | 'blocked' | 'counted' | 'status' | 'system';
  user: string;
  detail: string;
  time: string;
}
