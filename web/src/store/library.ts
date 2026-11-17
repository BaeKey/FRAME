import { create } from 'zustand';
import { createApiClient } from '../api/client';
import { handleSessionUnauthorized } from './session';
import type { DeletePlan, Group, IndexStatus, Item, PendingTask } from '../types';

interface LibraryState {
  groups: Group[]; unrecognized: number; items: Item[]; indexStatus: IndexStatus | null; pendingTasks: PendingTask[]; manifest: Record<string,string>;
  loadGroups(): Promise<void>; loadItems(group: string, sort: 'asc'|'desc'): Promise<void>; loadIndexStatus(): Promise<void>;
  refreshIndex(force?: boolean): Promise<void>; syncManifest(): Promise<void>;
  createDeletePlan(ids: string[]): Promise<DeletePlan>; executeBatchDelete(ids: string[], token: string): Promise<string[]>; retryDelete(taskId: string): Promise<void>; reset(): void;
}
const api = createApiClient(handleSessionUnauthorized);
export const useLibraryStore = create<LibraryState>((set) => ({
  groups: [], unrecognized: 0, items: [], indexStatus: null, pendingTasks: [], manifest: {},
  async loadGroups() { const data = await api.getGroups(); set({ groups: data.groups ?? [], unrecognized: data.unrecognized ?? 0, indexStatus: data.index }); },
  async loadItems(group, sort) { const data = await api.getItems(group, sort); set({ items: data.items ?? [], indexStatus: data.index }); },
  async loadIndexStatus() { const data = await api.getIndexStatus(); set({ indexStatus: data.index, pendingTasks: data.pending ?? [] }); },
  async refreshIndex(force = false) { const indexStatus = await api.refreshIndex(force); set({ indexStatus }); },
  async syncManifest() { const data = await api.getCacheManifest(); set({ manifest: data.files ?? {} }); },
  createDeletePlan(ids) { return api.createDeletePlan(ids); },
  async executeBatchDelete(ids, token) { const result = await api.executeBatchDelete(ids, token); return result.deleted ?? []; },
  async retryDelete(taskId) { await api.retryDelete(taskId); await this.loadIndexStatus(); },
  reset() { set({ groups: [], unrecognized: 0, items: [], indexStatus: null, pendingTasks: [], manifest: {} }); },
}));
