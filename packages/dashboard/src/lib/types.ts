/* ================================================================
   Shared TypeScript types for the Claude Code Limiter dashboard
   ================================================================ */

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface LimitRule {
  id?: string;
  type: 'per_model' | 'credits' | 'dollars' | 'time_of_day' | 'subagents' | 'tokens';
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
  /** Effective limit mode (the user's override, else the team's). */
  limit_mode?: LimitMode;
  /** The user's own override; null = inherits the team mode. */
  limit_mode_override?: LimitMode | null;
  /** USD spent since week_start, and in the window of the dollar rule (if any). */
  usd_week?: number;
  usd_used?: number;
  usd_budget?: number | null;
  // Credits consumed on each of the last 7 days (oldest first).
  // Optional — older server builds don't include it.
  daily_credits_7d?: number[];
  // Start of the current subscription week (UTC ISO), i.e. the last weekly reset.
  week_start?: string;
  // Credits consumed since week_start.
  credits_week?: number;
  // Since week_start (field name kept for compatibility). Only turns counted
  // by a hook that reports them (v1.5+).
  tokens_7d?: TokenTotals;
  versions_7d?: Array<{ model: string; model_version: string; count: number }>;
  // Timestamp (UTC ISO) of the last time the hook reported a
  // managed-settings.json hash that did not match the expected one.
  // Null = never tampered (or older client/server without tamper detection).
  last_tampering_at?: string | null;
}

export type LimitMode = 'credits' | 'dollars';

/** USD per million tokens for one model family. */
export interface ModelPrice {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
}
export type PriceTable = Record<string, ModelPrice>;

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
  limit_mode?: LimitMode;
  prices?: PriceTable;
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

export interface UpdateLink {
  command: string | null;
  /** ISO timestamp; null when there is no active link. */
  expires_at: string | null;
}

export interface ModelMismatch {
  id: number | string;
  type: 'model_mismatch' | 'effort_exceeded';
  model: string;
  /** "declared <model>, ran <model>" */
  blocked_reason: string | null;
  timestamp: string;
}

export interface DailyUsageRow {
  day: string;
  user_id?: string;
  user_name?: string;
  model: string;
  count: number;
  credits: number;
  cost_usd?: number;
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
  blocks_by_user?: Array<{ user_id: string; user_name: string; reason: string; count: number; last_at: string }>;
  activity_by_user?: Array<{ user_id: string; user_name: string; first_at: string; last_at: string; active_days: number; prompts: number; peak_hour: number | null }>;
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
  /** null clears the override (inherit the team mode). */
  limit_mode?: LimitMode | null;
}

export interface UpdateSettingsPayload {
  name?: string;
  credit_weights?: CreditWeights;
  effort_multipliers?: EffortMultipliers;
  weekly_reset?: WeeklyReset;
  limit_mode?: LimitMode;
  prices?: PriceTable;
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
  | 'model_mismatch'
  | 'effort_exceeded'
  | 'user_counted'
  | 'user_status_change'
  | 'user_killed'
  | 'user_status'
  | 'account_usage'
  | 'ws_connected'
  | 'ws_disconnected';

export interface WSEvent {
  type: WSEventType;
  userId?: string;
  userName?: string;
  model?: string;
  declared?: string;
  effort?: string;
  cap?: string;
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
  usage?: AccountUsage;
  timestamp: string;
}

/** One subscription window from Claude Code's statusLine `rate_limits`. */
export interface RateWindow {
  used_percentage: number;
  /** Unix epoch seconds. */
  resets_at: number;
}

/** Last reported 5h / 7d usage of the shared Claude account. */
export interface AccountUsage {
  five_hour: RateWindow | null;
  seven_day: RateWindow | null;
  updated_at: string;
  reported_by: string;
  /** Users whose reading from the last 10 minutes is part of the shown value. */
  reporters?: string[];
}

/** Total balance read in Console, the UTC day it was read, and the monthly plan credit (Ultra: 200 on the 27th). */
export interface ApiCreditsSnapshot {
  amount_usd: number;
  date: string;
  credit_usd: number;
  credit_day: number;
}

/** Anthropic API credits of the ERP chat assistant (GET /api/admin/api-credits). */
export interface ApiCredits {
  /** Balance read in Console and the UTC day it was read; null until the admin enters one. */
  snapshot: ApiCreditsSnapshot | null;
  /** Purchased credits + what is left of the plan credit this cycle. */
  balance_usd?: number;
  purchased_usd?: number;
  plan_left_usd?: number;
  /** Next plan credit grant (YYYY-MM-DD); null without a plan credit. */
  plan_renews?: string | null;
  spent_since_usd?: number;
  month_usd?: number;
  consulted_at?: string | null;
  error?: string;
}

export interface FeedItem {
  id: string;
  type: 'check' | 'blocked' | 'counted' | 'status' | 'system';
  user: string;
  detail: string;
  time: string;
}
