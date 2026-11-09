/* ================================================================
   API Client — all admin endpoints for Claude Code Limiter
   ================================================================ */

import type {
  LoginResponse,
  User,
  CreateUserPayload,
  CreateUserResponse,
  UpdateUserPayload,
  UpdateSettingsPayload,
  AccountUsage,
  Team,
  UsageEvent,
  ModelMismatch,
  UpdateLink,
  DailyUsageRow,
  AnalyticsData,
  VersionUsage,
  SubagentUsage,
} from './types';

const TOKEN_KEY = 'clm_token';
const TEAM_KEY = 'clm_team';

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TEAM_KEY);
}

function getStoredTeam(): Team | null {
  const raw = localStorage.getItem(TEAM_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Team;
  } catch {
    return null;
  }
}

function setStoredTeam(team: Team): void {
  localStorage.setItem(TEAM_KEY, JSON.stringify(team));
}

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

let onUnauthorized: (() => void) | null = null;

function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

async function request<T>(path: string, opts?: {
  method?: string;
  body?: unknown;
}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    method: opts?.method ?? 'GET',
    headers,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401) {
    clearToken();
    onUnauthorized?.();
    throw new ApiError('Session expired', 401);
  }

  const data = await res.json();

  if (!res.ok) {
    throw new ApiError(data.error ?? 'Request failed', res.status);
  }

  return data as T;
}

function buildQS(params?: Record<string, string | number | null | undefined>): string {
  if (!params) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v != null) {
      parts.push(`${k}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

/* ---- Endpoints ---- */

async function login(password: string): Promise<LoginResponse> {
  const data = await request<LoginResponse>('/api/admin/login', {
    method: 'POST',
    body: { password },
  });
  setToken(data.token);
  if (data.team) {
    setStoredTeam(data.team);
  }
  return data;
}

function logout(): void {
  clearToken();
}

async function getUsers(): Promise<{ users: User[] }> {
  return request<{ users: User[] }>('/api/admin/users');
}

async function getUser(id: string): Promise<User> {
  const data = await request<{ users: User[] }>('/api/admin/users');
  const user = data.users.find((u) => u.id === id);
  if (!user) throw new ApiError('User not found', 404);
  return user;
}

async function createUser(payload: CreateUserPayload): Promise<CreateUserResponse> {
  return request<CreateUserResponse>('/api/admin/users', {
    method: 'POST',
    body: payload,
  });
}

async function updateUser(id: string, payload: UpdateUserPayload): Promise<{ user: User; limits: unknown[] }> {
  return request<{ user: User; limits: unknown[] }>(`/api/admin/users/${id}`, {
    method: 'PUT',
    body: payload,
  });
}

async function deleteUser(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/admin/users/${id}`, {
    method: 'DELETE',
  });
}

async function getInstallCode(id: string): Promise<{ install_code: string | null }> {
  return request<{ install_code: string | null }>(`/api/admin/users/${id}/install-code`);
}

async function regenerateInstallCode(id: string): Promise<{ install_code: string }> {
  return request<{ install_code: string }>(`/api/admin/users/${id}/install-code`, {
    method: 'POST',
  });
}

async function getUpdateLink(id: string): Promise<UpdateLink> {
  return request<UpdateLink>(`/api/admin/users/${id}/update-link`);
}

async function createUpdateLink(id: string): Promise<UpdateLink> {
  return request<UpdateLink>(`/api/admin/users/${id}/update-link`, { method: 'POST' });
}

async function getUsage(params?: {
  user_id?: string;
  window?: string;
  days?: number;
}): Promise<{
  user_id?: string;
  summary?: unknown;
  daily: DailyUsageRow[];
}> {
  return request(`/api/admin/usage${buildQS(params)}`);
}

async function getUsageVersions(params?: {
  user_id?: string;
  days?: number;
}): Promise<{
  user_id?: string;
  versions: VersionUsage[];
  subagents?: SubagentUsage[];
}> {
  return request(`/api/admin/usage/versions${buildQS(params)}`);
}

async function getMismatches(userId: string): Promise<{ mismatches: ModelMismatch[] }> {
  return request(`/api/admin/mismatches${buildQS({ user_id: userId })}`);
}

async function getEvents(params?: {
  limit?: number;
  user_id?: string;
}): Promise<{ events: UsageEvent[] }> {
  return request(`/api/admin/events${buildQS(params)}`);
}

async function getAnalytics(params?: {
  days?: number;
  user_id?: string;
  from?: string;
  to?: string;
}): Promise<AnalyticsData> {
  return request(`/api/admin/analytics${buildQS(params)}`);
}

async function getAccountUsage(): Promise<{ usage: AccountUsage | null }> {
  return request<{ usage: AccountUsage | null }>('/api/admin/account-usage');
}

export interface WeeklyResetStatus {
  week_start: string;
  manual_reset_at: string | null;
}

async function getWeeklyResetStatus(): Promise<WeeklyResetStatus> {
  return request<WeeklyResetStatus>('/api/admin/weekly-reset');
}

async function resetWeekNow(password: string): Promise<WeeklyResetStatus> {
  return request<WeeklyResetStatus>('/api/admin/weekly-reset/now', {
    method: 'POST',
    body: { password },
  });
}

async function getSettings(): Promise<{ team: Team }> {
  return request<{ team: Team }>('/api/admin/settings');
}

/** Same dollar budget for every user of the team; value -1 clears it. */
async function setTeamDollarBudget(value: number, window: string): Promise<{ updated: number }> {
  return request<{ updated: number }>('/api/admin/settings/dollar-budget', {
    method: 'POST',
    body: { value, window },
  });
}

async function updateSettings(payload: UpdateSettingsPayload): Promise<{ team: Team }> {
  return request<{ team: Team }>('/api/admin/settings', {
    method: 'PUT',
    body: payload,
  });
}

export const api = {
  login,
  logout,
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  getInstallCode,
  regenerateInstallCode,
  getUpdateLink,
  createUpdateLink,
  getUsage,
  getUsageVersions,
  getEvents,
  getMismatches,
  getAnalytics,
  updateSettings,
  getSettings,
  setTeamDollarBudget,
  getAccountUsage,
  getWeeklyResetStatus,
  resetWeekNow,
  getToken,
  getStoredTeam,
  setStoredTeam,
  setUnauthorizedHandler,
  isAuthenticated: () => !!getToken(),
};
