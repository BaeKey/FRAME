import { createLogger } from './logger';
import { readVideoRange } from './media-source';
import { mediaStream } from './media-stream';
import { HEADER_SIZE, alignedRange, checkMP4, decryptRange, importKey, parseHeader, parseRange } from './crypto';

interface SessionEntry {
  key: CryptoKey; expires: number; logLevel: 'error' | 'info' | 'debug';
  keyBase64: string; controllers: Set<AbortController>; revoked: boolean; refreshing: Promise<void> | null;
}
const worker = self as unknown as ServiceWorkerGlobalScope;
const sessions = new Map<string, SessionEntry>();
const epochs = new Map<string, number>();
const CHUNK_SIZE = 1024 * 1024;
const MATCH = /^\/(dec|download)\/([a-f0-9]{64})$/;

worker.addEventListener('install', (event) => event.waitUntil(worker.skipWaiting()));
worker.addEventListener('activate', (event) => event.waitUntil(worker.clients.claim()));
worker.addEventListener('message', (event) => {
  if (!event.source || !('id' in event.source)) return;
  const clientId = event.source.id;
  if (event.data?.type !== 'LOGOUT') return;
  epochs.set(clientId, (epochs.get(clientId) ?? 0) + 1);
  const old = sessions.get(clientId);
  if (old) { old.revoked = true; for (const controller of old.controllers) controller.abort(); }
  sessions.delete(clientId); event.ports[0]?.postMessage({ ok: true });
});

async function credentials(clientId: string): Promise<SessionEntry> {
  const live = new Set((await worker.clients.matchAll({ type: 'window' })).map((client) => client.id));
  for (const [id, old] of sessions) if (!live.has(id)) {
    old.revoked = true; for (const controller of old.controllers) controller.abort(); sessions.delete(id);
  }
  for (const id of epochs.keys()) if (!live.has(id)) epochs.delete(id);
  const epoch = epochs.get(clientId) ?? 0;
  const existing = sessions.get(clientId); if (existing) return existing;
  const client = await worker.clients.get(clientId); if (!client) throw new Error('页面已关闭，请重新登录');
  const channel = new MessageChannel();
  const data = await new Promise<{ key_base64: string; expires_at: string; log_level: 'error'|'info'|'debug' }>((resolve, reject) => {
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('请解锁页面后重新播放')); }, 10_000);
    channel.port1.onmessage = (message) => { clearTimeout(timer); channel.port1.close(); resolve(message.data); };
    client.postMessage({ type: 'NEED_SESSION' }, [channel.port2]);
  });
  if ((epochs.get(clientId) ?? 0) !== epoch) throw new Error('会话已退出');
  const expires = Date.parse(data.expires_at);
  if (!data.key_base64 || !(expires > Date.now())) throw new Error('请重新登录');
  const entry: SessionEntry = { key: await importKey(data.key_base64), keyBase64: data.key_base64, expires, logLevel: data.log_level || 'info', controllers: new Set(), revoked: false, refreshing: null };
  sessions.set(clientId, entry); return entry;
}

async function api(session: SessionEntry, path: string, init: RequestInit = {}): Promise<Response> {
  if (session.revoked) throw new Error('会话已退出');
  const response = await fetch(path, { ...init, cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string }; throw new Error(body.error || '存储不可用'); }
  return response;
}
async function currentKey(session: SessionEntry): Promise<CryptoKey> {
  if (session.expires <= Date.now()) {
    if (!session.refreshing) session.refreshing = (async () => {
      const controller = new AbortController(); session.controllers.add(controller);
      try {
        const data = await (await api(session, '/api/session', { method: 'POST', signal: controller.signal })).json() as { key_base64: string; expires_at: string; log_level: 'error'|'info'|'debug' };
        const key = await importKey(data.key_base64); const expires = Date.parse(data.expires_at);
        if (session.revoked) throw new Error('会话已退出');
        if (!(expires > Date.now())) throw new Error('密钥已过期，请检查系统时间');
        session.key = key; session.keyBase64 = data.key_base64; session.expires = expires; session.logLevel = data.log_level || session.logLevel;
      } finally { session.controllers.delete(controller); }
    })().finally(() => { session.refreshing = null; });
    await session.refreshing;
  }
  if (session.revoked) throw new Error('会话已退出'); return session.key;
}
async function encryptedRange(session: SessionEntry, id: string, start: number, end: number, total: number, signal: AbortSignal, log: ReturnType<typeof createLogger>): Promise<Uint8Array> {
  const controller = new AbortController(); session.controllers.add(controller);
  const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 60_000);
  try {
    return await readVideoRange({ id, start, end, total, signal: controller.signal, log, resolve: async () => {
      const source = await (await api(session, `/api/source/${id}`, { signal: controller.signal })).json() as { url: string };
      return source.url;
    } });
  } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); session.controllers.delete(controller); }
}
async function notify(clientId: string, id: string, message: string): Promise<void> {
  (await worker.clients.get(clientId))?.postMessage({ type: 'PLAYBACK_ERROR', id, message });
}

async function serveMedia(event: FetchEvent, id: string, download: boolean): Promise<Response> {
  let session: SessionEntry | undefined; let controller: AbortController | undefined;
  try {
    session = await credentials(event.clientId);
    controller = new AbortController(); session.controllers.add(controller);
    event.request.signal.addEventListener('abort', () => controller?.abort(), { once: true });
    if (event.request.signal.aborted) controller.abort();
    const item = await (await api(session, `/api/items/${id}`, { signal: controller.signal })).json() as { id: string; type: string; name: string; size: number; version: string };
    if (!download && item.type !== 'video') throw new Error('只支持 MP4 视频');
    if (!Number.isSafeInteger(item.size) || item.size < HEADER_SIZE) throw new Error('不是加密文件（长度不足）');
    const log = createLogger(session.logLevel, (record) => { void worker.clients.get(event.clientId).then((client) => client?.postMessage({ type: 'FRAME_LOG', record })).catch(() => {}); });
    const plainSize = item.size - HEADER_SIZE;
    const first = await encryptedRange(session, id, 0, Math.min(item.size - 1, HEADER_SIZE + 11), item.size, controller.signal, log);
    const iv = parseHeader(first);
    if (!download && plainSize === 0) throw new Error('空内容：加密文件没有视频数据');
    let range: ReturnType<typeof parseRange>;
    try { range = parseRange(event.request.headers.get('Range'), plainSize); }
    catch { session.controllers.delete(controller); return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${plainSize}`, 'Cache-Control': 'no-store' } }); }
    const key = await currentKey(session);
    if (item.type === 'video' && plainSize > 0) checkMP4(await decryptRange(key, iv, first.subarray(HEADER_SIZE), 0, first.length - HEADER_SIZE));
    const length = range.end - range.start + 1;
    const headers: Record<string, string> = { 'Content-Type': download ? 'application/octet-stream' : 'video/mp4', 'Content-Length': String(length), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (download) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(item.name).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`;
    if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${plainSize}`;
    if (length === 0 || event.request.method === 'HEAD') { session.controllers.delete(controller); return new Response(null, { status: range.partial ? 206 : 200, headers }); }
    const body = mediaStream({ start: range.start, end: range.end, chunkSize: CHUNK_SIZE, controller,
      cleanup: () => session?.controllers.delete(controller!),
      read: async (offset, count) => {
        if (!session || session.revoked) throw new DOMException('会话已退出', 'AbortError');
        const aligned = alignedRange(offset, count);
        const bytes = await encryptedRange(session, id, aligned.start, aligned.end, item.size, controller!.signal, log);
        if (controller!.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        return decryptRange(await currentKey(session), iv, bytes, offset, count);
      },
      onError: (error) => notify(event.clientId, id, error.message),
    });
    return new Response(body, { status: range.partial ? 206 : 200, headers });
  } catch (cause) {
    controller?.abort(); if (session && controller) session.controllers.delete(controller);
    const error = cause instanceof Error ? cause : new Error(String(cause));
    if (error.name !== 'AbortError' && !event.request.signal.aborted) await notify(event.clientId, id, error.message);
    return new Response('无法解密媒体', { status: 422, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}
worker.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url); if (url.origin !== worker.location.origin) return;
  if (!/^\/(dec|download)\//.test(url.pathname)) return;
  const match = MATCH.exec(url.pathname);
  if (!match || !['GET', 'HEAD'].includes(event.request.method)) { event.respondWith(new Response(null, { status: 404 })); return; }
  event.respondWith(serveMedia(event, match[2]!, match[1] === 'download'));
});
