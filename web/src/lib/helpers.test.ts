import { describe, expect, it } from 'vitest';
import { formatSize, dateParts } from './format';
import { filterItems, groupFromHash, groupHash } from './navigation';

describe('format helpers', () => {
  it('formats sizes and Shanghai dates', () => {
    expect(formatSize(1024)).toBe('1.0 KiB');
    expect(dateParts('')).toEqual({date:'日期未知',time:''});
    expect(dateParts('2026-11-01T04:00:00Z')).toEqual({date:'2026/11/01',time:'12:00'});
  });
});
describe('navigation helpers', () => {
  it('round trips encoded group names', () => {
    for (const name of ['张三','a/b #100%']) expect(groupFromHash(groupHash(name))).toBe(name);
    expect(groupFromHash('#/')).toBeNull(); expect(groupFromHash('#/%ZZ')).toBeNull();
  });
  it('filters names and content types without mutating', () => {
    const values = [{name:'Alice.mp4',type:'video'},{name:'alice.png',type:'image'},{name:'other',type:'unknown'}];
    expect(filterItems(values,' ALICE ','all')).toHaveLength(2);
    expect(filterItems(values,'','collection')).toEqual(values.slice(0,2));
    expect(filterItems(values,'alice','video')).toEqual([values[0]]);
  });
});
