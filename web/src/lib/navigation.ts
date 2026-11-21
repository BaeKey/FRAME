import type { Item, MediaEntry } from '../types';

export function groupFromHash(hash: string): string | null {
  if (!hash.startsWith('#/')) return null;
  const segment = hash.slice(2);
  if (!segment) return null;
  try { return decodeURIComponent(segment) || null; } catch { return null; }
}
export function groupHash(name: string | null): string { return name === null ? '#/' : `#/${encodeURIComponent(name)}`; }

export function groupMediaItems(items: Item[]): MediaEntry[] {
  const images = new Map(items.filter(item => item.type === 'image').map(item => [item.id, item]));
  const videosByImage = new Map<string, Item[]>();
  const pairedVideoIds = new Set<string>();
  for (const item of items) {
    if (item.type !== 'video' || item.cover_file_id === item.id || !images.has(item.cover_file_id)) continue;
    const videos = videosByImage.get(item.cover_file_id) ?? [];
    videos.push(item);
    videosByImage.set(item.cover_file_id, videos);
    pairedVideoIds.add(item.id);
  }
  return items.filter(item => !pairedVideoIds.has(item.id)).map(item => ({
    ...item,
    pairedVideos: item.type === 'image' ? videosByImage.get(item.id) ?? [] : [],
  }));
}

export function filterItems<T extends { name: string; type?: string; count?: number }>(items: T[], query: string, type: 'collection' | 'all' | 'video' | 'image'): T[] {
  const needle = query.trim().toLocaleLowerCase();
  return items.filter((item) => (type === 'all' || (type === 'collection' ? item.type !== 'unknown' : item.type === type)) && (!needle || item.name.toLocaleLowerCase().includes(needle)));
}
