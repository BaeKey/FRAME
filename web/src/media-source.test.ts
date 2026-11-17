import { describe, expect, it } from 'vitest';
import { readCipherFile, readVideoRange } from './media-source';
const fixture={url:'https://drive.example/file?signature=private',size:4};

describe('direct media source',()=>{
  it('downloads full ciphertext with omitted credentials and validates size',async()=>{
    const bytes=Uint8Array.from([1,2,3,4]);
    const result=await readCipherFile({id:'id',resolve:async()=>fixture,fetcher:async(_url,init)=>{expect(init?.credentials).toBe('omit');expect(init?.mode).toBe('cors');return new Response(bytes,{status:200,headers:{'Content-Length':'4'}});}});
    expect([...result]).toEqual([1,2,3,4]);
  });
  it('renews an expired direct URL once for range requests',async()=>{
    let resolved=0,fetched=0;
    const bytes=await readVideoRange({id:'abc',start:10,end:12,total:100,resolve:async()=>{resolved++;return 'https://drive.example/media';},fetcher:async(_url,init)=>{fetched++;if(fetched===1)return new Response(null,{status:403});expect(new Headers(init?.headers).get('Range')).toBe('bytes=10-12');return new Response(Uint8Array.from([7,8,9]),{status:206,headers:{'Content-Range':'bytes 10-12/100'}});}});
    expect(resolved).toBe(2);expect(fetched).toBe(2);expect([...bytes]).toEqual([7,8,9]);
  });
  it('rejects non-206 video responses and truncated ciphertext',async()=>{
    await expect(readVideoRange({id:'abc',start:0,end:1,total:2,resolve:async()=>'https://drive.example',fetcher:async()=>new Response(new Uint8Array([1,2]),{status:200})})).rejects.toThrow('HTTP 200');
    await expect(readCipherFile({id:'abc',resolve:async()=>fixture,fetcher:async()=>new Response(new Uint8Array([1]),{status:200})})).rejects.toThrow('大小与索引不一致');
  });
});
