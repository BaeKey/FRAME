import { describe, expect, it } from 'vitest';
import { createLogger } from './logger';

describe('safe logger',()=>{
  it('filters severity and arbitrary secrets',()=>{
    const records:Array<Record<string,unknown>>=[];const log=createLogger('info',record=>records.push(record));
    log('debug','hidden',{item_id:'x'});log('info','provider_downloaded',{item_id:'x',cipher_bytes:12,url:'https://private/?secret=x',key:'raw-key'});
    expect(records).toHaveLength(1);expect(records[0]?.cipher_bytes).toBe(12);expect(JSON.stringify(records)).not.toContain('secret');expect(JSON.stringify(records)).not.toContain('raw-key');
  });
});
