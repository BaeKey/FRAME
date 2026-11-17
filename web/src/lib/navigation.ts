export function groupFromHash(hash: string): string | null {
  if (!hash.startsWith('#/')) return null;
  const segment = hash.slice(2);
  if (!segment) return null;
  try { return decodeURIComponent(segment) || null; } catch { return null; }
}
export function groupHash(name: string | null): string { return name === null ? '#/' : `#/${encodeURIComponent(name)}`; }
export function filterItems<T extends { name: string; type?: string; count?: number }>(items: T[], query: string, type: 'collection' | 'all' | 'video' | 'image'): T[] {
  const needle = query.trim().toLocaleLowerCase();
  return items.filter((item) => (type === 'all' || (type === 'collection' ? item.type !== 'unknown' : item.type === type)) && (!needle || item.name.toLocaleLowerCase().includes(needle)));
}
