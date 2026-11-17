const MAX_ENTRIES = 100;
const cache = new Map<string, Uint8Array>();
const inflight = new Map<string, Promise<Uint8Array>>();
let cacheEpoch = 0;

export function clearImageCache(): void {
  cacheEpoch++;
  cache.clear();
  inflight.clear();
}

export async function getImageBytes(id: string, version: string, load: () => Promise<Uint8Array>): Promise<Uint8Array> {
  const key = `${id}:${version}`;
  const hit = cache.get(key);
  if (hit) return hit.slice();
  let request = inflight.get(key);
  if (!request) {
    const epoch = cacheEpoch;
    request = load().then((bytes) => {
      const copy = bytes.slice();
      if (epoch === cacheEpoch) {
        cache.set(key, copy);
        while (cache.size > MAX_ENTRIES) {
          const first = cache.keys().next().value;
          if (first === undefined) break;
          cache.delete(first);
        }
      }
      return copy;
    });
    inflight.set(key, request);
    void request.finally(() => { if (inflight.get(key) === request) inflight.delete(key); }).catch(() => {});
  }
  return (await request).slice();
}

export function purgeFromCache(ids: string[]): void {
  const wanted = new Set(ids);
  if (wanted.size === 0) return;
  cacheEpoch++;
  for (const key of cache.keys()) if (wanted.has(key.slice(0, key.indexOf(':')))) cache.delete(key);
  for (const key of inflight.keys()) if (wanted.has(key.slice(0, key.indexOf(':')))) inflight.delete(key);
}
