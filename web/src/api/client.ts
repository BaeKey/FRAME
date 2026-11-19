import type { DeletePlan, DeleteResult, Group, IndexStatus, Item, NamingRule, PendingTask, SessionData, SourceInfo } from '../types';
import { appPath } from '../lib/base-path';

export interface ApiClient {
  login(token: string): Promise<void>; logout(): Promise<void>; getSession(): Promise<SessionData>;
  getGroups(): Promise<{ groups: Group[]; unrecognized: number; index: IndexStatus }>;
  getItems(name: string, sort: 'asc' | 'desc'): Promise<{ items: Item[]; index: IndexStatus }>;
  getItem(id: string): Promise<Item>; getIndexStatus(): Promise<{ index: IndexStatus; pending: PendingTask[] }>;
  refreshIndex(force?: boolean): Promise<IndexStatus>; getCacheManifest(): Promise<{ files: Record<string, string> }>;
  getSource(id: string): Promise<SourceInfo>; getNamingRules(): Promise<{ rules: NamingRule[] }>;
  previewNamingRule(rules: NamingRule[], filename: string): Promise<{ group: string; timestamp: string; type: string; matched: boolean }>;
  createDeletePlan(ids: string[]): Promise<DeletePlan>; executeBatchDelete(ids: string[], token: string): Promise<DeleteResult>;
  retryDelete(taskId: string): Promise<DeleteResult>;
}

export function createApiClient(onUnauthorized: () => void): ApiClient {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(appPath(path), { credentials: 'same-origin', cache: 'no-store', ...init });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (response.status === 401) onUnauthorized();
      throw new Error(body.error || `HTTP ${response.status}`);
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }
  return {
    // Login must accept Set-Cookie; subsequent API calls authenticate with it.
    login: async (token) => { await request('/api/login', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); },
    logout: () => request('/api/logout', { method: 'POST' }),
    getSession: () => request('/api/session', { method: 'POST' }),
    getGroups: async () => { const data = await request<{ users: Group[]; groups?: Group[]; unrecognized: number; index: IndexStatus }>('/api/users'); return { groups: data.groups ?? data.users ?? [], unrecognized: data.unrecognized ?? 0, index: data.index }; },
    getItems: (name, sort) => request(`/api/users/${encodeURIComponent(name)}/items?sort=${sort}`),
    getItem: (id) => request(`/api/items/${id}`),
    getIndexStatus: () => request('/api/index'),
    refreshIndex: (force = false) => request(`/api/index/refresh${force ? '?force=true' : ''}`, { method: 'POST' }),
    getCacheManifest: () => request('/api/cache-manifest'),
    getSource: (id) => request(`/api/source/${id}`),
    getNamingRules: () => request('/api/naming-rules'),
    previewNamingRule: (rules, filename) => request('/api/naming-rules/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules, filename }) }),
    createDeletePlan: (ids) => request('/api/delete-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) }),
    executeBatchDelete: (ids, token) => request('/api/delete-batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, token }) }),
    retryDelete: (taskId) => request(`/api/deletions/${taskId}/retry`, { method: 'POST' }),
  };
}
