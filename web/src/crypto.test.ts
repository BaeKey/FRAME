import { describe, expect, it } from 'vitest';
import { addCounter, alignedRange, parseHeader, parseRange } from './crypto';

describe('OLAES1 range helpers', () => {
  it('parses the IV and rejects invalid headers', () => {
    const header = new Uint8Array(23); header.set(new TextEncoder().encode('OLAES1')); header[6] = 1;
    expect(parseHeader(header)).toHaveLength(16);
    expect(() => parseHeader(new Uint8Array(23))).toThrow('不是加密文件');
  });
  it('adds the counter as a big-endian 128-bit integer', () => {
    const iv = new Uint8Array(16).fill(255);
    expect([...addCounter(iv, 1n)]).toEqual(new Array(16).fill(0));
  });
  it.each([[0,100,0,23,0n],[16,1,0,39,1n],[17,1,1,39,1n],[100,50,4,119,6n]] as const)('aligns offset %i', (offset,length,skip,start,block) => {
    expect(alignedRange(offset,length)).toEqual({skip,start,end:23+offset+length-1,block});
  });
  it('parses full, normal and suffix ranges', () => {
    expect(parseRange(null,1000)).toEqual({start:0,end:999,partial:false});
    expect(parseRange('bytes=0-499',1000)).toEqual({start:0,end:499,partial:true});
    expect(parseRange('bytes=-200',1000)).toEqual({start:800,end:999,partial:true});
    expect(parseRange('bytes=999-',1000)).toEqual({start:999,end:999,partial:true});
    expect(() => parseRange('bytes=1000-1001',1000)).toThrow('Range 超出范围');
  });
});
