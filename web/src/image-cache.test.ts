import { describe, expect, it } from 'vitest';
import { clearImageCache, getImageBytes, purgeFromCache } from './image-cache';

describe('image memory cache', () => {
  it('shares concurrent loads and returns defensive copies', async () => {
    clearImageCache(); let loads = 0;
    const load = async () => { loads++; await Promise.resolve(); return new Uint8Array([1, 2, 3]); };
    const [a,b] = await Promise.all([getImageBytes('a','v1',load), getImageBytes('a','v1',load)]);
    a[0] = 9;
    expect(loads).toBe(1); expect([...b]).toEqual([1,2,3]);
    expect([...(await getImageBytes('a','v1',load))]).toEqual([1,2,3]);
  });
  it('does not cache failures and purges ids', async () => {
    clearImageCache(); let loads = 0;
    await expect(getImageBytes('x','1',async()=>{throw new Error('fail');})).rejects.toThrow('fail');
    const load = async () => { loads++; return new Uint8Array([4]); };
    await getImageBytes('x','1',load); await getImageBytes('y','1',load); purgeFromCache(['x']); await getImageBytes('x','1',load);
    expect(loads).toBe(3);
  });
  it('does not repopulate a purged entry from an old in-flight request', async () => {
    clearImageCache(); let started!: () => void; let release!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const old = getImageBytes('gone','v1',async()=>{ started(); await blocked; return new Uint8Array([1]); });
    await ready; purgeFromCache(['gone']);
    const current = await getImageBytes('gone','v1',async()=>new Uint8Array([2]));
    release(); expect([...(await old)]).toEqual([1]);
    expect([...current]).toEqual([2]);
    expect([...(await getImageBytes('gone','v1',async()=>new Uint8Array([3])))]).toEqual([2]);
  });
});
