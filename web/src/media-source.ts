import type { SourceInfo } from './types';
import type { LogLevel } from './logger';
export type MediaLogger = (severity: LogLevel, event: string, attrs?: Record<string, unknown>) => void;
const noop: MediaLogger = () => {};
function validateURL(raw: string): URL { const url = new URL(raw); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('网盘文件直链无效'); return url; }

export async function readCipherFile(opts: { id: string; signal?: AbortSignal; resolve: () => Promise<SourceInfo>; log?: MediaLogger; fetcher?: typeof fetch }): Promise<Uint8Array> {
  const { id, signal, resolve, log = noop, fetcher = fetch } = opts;
  for (let attempt = 0; attempt < 2; attempt++) {
    const source = await resolve(); const url = validateURL(source.url);
    if (!Number.isSafeInteger(source.size) || source.size < 0) throw new Error('网盘文件直链或大小无效');
    let response: Response;
    try { response = await fetcher(url.href, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'follow', signal }); }
    catch (error) { if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error; throw new Error('无法直连网盘文件：请检查直链可达性、HTTPS 和网盘 CORS 配置（不会通过服务器中转）'); }
    if ([401, 403, 410].includes(response.status) && attempt === 0) { await response.body?.cancel(); continue; }
    if (response.status !== 200) { await response.body?.cancel(); throw new Error('网盘未返回完整文件（需要 HTTP 200）'); }
    const contentLength = response.headers.get('Content-Length');
    if (contentLength !== null && Number(contentLength) !== source.size) { await response.body?.cancel(); throw new Error('网盘文件大小与索引不一致，请刷新索引'); }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== source.size) throw new Error('网盘文件密文被截断或大小与索引不一致');
    log('info', 'media_provider_downloaded', { item_id: id, transport: 'browser_direct', provider_host: url.host, final_host: response.url ? new URL(response.url).host : url.host, cipher_bytes: bytes.length, status: response.status });
    return bytes;
  }
  throw new Error('网盘临时直链已失效');
}

export async function readVideoRange(opts: { id: string; resolve: () => Promise<string>; start: number; end: number; total: number; signal?: AbortSignal; log?: MediaLogger; fetcher?: typeof fetch }): Promise<Uint8Array> {
  const { id, resolve, start, end, total, signal, log = noop, fetcher = fetch } = opts;
  for (let attempt = 0; attempt < 2; attempt++) {
    const url = validateURL(await resolve());
    let response: Response;
    try { response = await fetcher(url.href, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'follow', headers: { Range: `bytes=${start}-${end}` }, signal }); }
    catch (error) { if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error; throw new Error('无法直连网盘视频：请检查直链可达性、HTTPS 和网盘 CORS 配置（不会通过服务器中转）'); }
    if ([401, 403, 410].includes(response.status) && attempt === 0) { await response.body?.cancel(); continue; }
    if (response.status !== 206) { await response.body?.cancel(); throw new Error(`网盘返回 HTTP ${response.status}；视频分块请求需要 HTTP 206`); }
    const contentRange = response.headers.get('Content-Range');
    if (contentRange !== null && contentRange !== `bytes ${start}-${end}/${total}`) { await response.body?.cancel(); throw new Error('网盘返回的 Content-Range 与请求范围不匹配'); }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== end - start + 1) throw new Error('网盘视频密文被截断');
    log('info', 'video_provider_downloaded', { item_id: id, transport: 'browser_direct', provider_host: url.host, final_host: response.url ? new URL(response.url).host : url.host, cipher_start: start, cipher_end: end, cipher_bytes: bytes.length, status: response.status });
    return bytes;
  }
  throw new Error('网盘视频临时直链已失效');
}
