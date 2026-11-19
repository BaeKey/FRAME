import { create } from 'zustand';
import { createApiClient } from '../api/client';
import { clearImageCache } from '../image-cache';
import { readCipherFile } from '../media-source';
import { importKey } from '../crypto';
import { createLogger, type LogLevel } from '../logger';
import type { SessionData } from '../types';
import { appPath } from '../lib/base-path';

interface KeyState { key: CryptoKey; expires: number; logLevel: SessionData['log_level']; keyBase64: string }
interface SessionState {
  authenticated: boolean; logLevel: SessionData['log_level']; loading: boolean;
  login(token: string): Promise<void>; logout(): Promise<void>; restore(): Promise<void>;
  getKey(): Promise<KeyState>; downloadFile(id: string, signal?: AbortSignal): Promise<Uint8Array>;
  log(severity: LogLevel, event: string, attrs?: Record<string, unknown>): void;
}
let epoch = 0; let pendingKey: Promise<KeyState> | null = null;
const requests = new Set<AbortController>();
let registration: ServiceWorkerRegistration | null = null;
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('gateway-account') : null;
const api = createApiClient(() => { void clearSession(); });

async function prepareWorker(): Promise<void> {
  if (!isSecureContext || !crypto.subtle || !('serviceWorker' in navigator)) throw new Error('请通过 HTTPS（或 localhost）访问，并使用支持 WebCrypto 和 Service Worker 的浏览器。');
  registration = await navigator.serviceWorker.register(appPath('/sw.js'), { type: 'module', scope: appPath('/') });
  await navigator.serviceWorker.ready;
  if (navigator.serviceWorker.controller) return;
  await new Promise<void>((resolve, reject) => {
    const finish = () => { clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', finish); resolve(); };
    const timer = setTimeout(() => { navigator.serviceWorker.removeEventListener('controllerchange', finish); reject(new Error('播放器尚未准备好，请刷新页面后重试。')); }, 10_000);
    navigator.serviceWorker.addEventListener('controllerchange', finish);
    if (navigator.serviceWorker.controller) finish();
  });
}

async function clearSession(): Promise<void> {
  epoch++; pendingKey = null; cachedKey = null; clearImageCache();
  for (const controller of requests) controller.abort(); requests.clear();
  useSessionStore.setState({ authenticated: false, logLevel: 'error', loading: false });
  const worker = navigator.serviceWorker?.controller || registration?.active;
  if (!worker) return;
  await new Promise<void>((resolve) => {
    const messageChannel = new MessageChannel();
    const done = () => { clearTimeout(timer); messageChannel.port1.close(); resolve(); };
    const timer = setTimeout(done, 1500); messageChannel.port1.onmessage = done;
    worker.postMessage({ type: 'LOGOUT' }, [messageChannel.port2]);
  });
}

export function handleSessionUnauthorized(): void { void clearSession(); }

export const useSessionStore = create<SessionState>(() => ({
  authenticated: false, logLevel: 'error', loading: true,
  log(severity, event, attrs) { createLogger(useSessionStore.getState().logLevel)(severity, event, attrs); },
  async login(token) {
    await prepareWorker(); await api.login(token); await useSessionStore.getState().restore();
    if (!useSessionStore.getState().authenticated) throw new Error('登录后无法建立浏览器解密会话，请重新尝试。');
  },
  async logout() {
    try { await api.logout(); } finally { channel?.postMessage('logout'); await clearSession(); }
  },
  async restore() {
    const currentEpoch = epoch;
    try {
      await prepareWorker(); await useSessionStore.getState().getKey();
      if (epoch !== currentEpoch) return;
      useSessionStore.setState({ authenticated: true, logLevel: (await useSessionStore.getState().getKey()).logLevel });
    } catch { if (epoch === currentEpoch) useSessionStore.setState({ authenticated: false }); }
    finally { useSessionStore.setState({ loading: false }); }
  },
  async getKey() {
    const current = cachedKey;
    if (current && current.expires > Date.now()) return current;
    if (!pendingKey) {
      const startedAt = epoch;
      const task = api.getSession().then(async (data) => {
        const key = await importKey(data.key_base64);
        const expires = Date.parse(data.expires_at);
        if (startedAt !== epoch) throw new DOMException('会话已结束', 'AbortError');
        if (!(expires > Date.now())) throw new Error('密钥已过期，请检查设备时间后重试。');
        const value = { key, expires, logLevel: data.log_level || 'info', keyBase64: data.key_base64 } as KeyState;
        cachedKey = value; return value;
      });
      pendingKey = task; void task.finally(() => { if (pendingKey === task) pendingKey = null; }).catch(() => {});
    }
    return pendingKey;
  },
  async downloadFile(id, signal) {
    const controller = new AbortController(); const startEpoch = epoch;
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort(); requests.add(controller);
    const timeout = setTimeout(abort, 60_000);
    try {
      const bytes = await readCipherFile({ id, signal: controller.signal, resolve: () => api.getSource(id), log: (...args) => useSessionStore.getState().log(...args) });
      if (startEpoch !== epoch) throw new DOMException('会话已结束', 'AbortError');
      return bytes;
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); requests.delete(controller); }
  },
}));

let cachedKey: KeyState | null = null;
channel?.addEventListener('message', (event) => { if (event.data === 'logout') void clearSession(); });
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', async (event: MessageEvent) => {
  if (event.data?.type !== 'NEED_SESSION') return;
  try {
    if (!useSessionStore.getState().authenticated && !cachedKey) throw new Error('请先登录');
    const value = await useSessionStore.getState().getKey();
    event.ports[0]?.postMessage({ key_base64: value.keyBase64, expires_at: new Date(value.expires).toISOString(), log_level: value.logLevel });
  } catch { event.ports[0]?.postMessage({}); }
});
