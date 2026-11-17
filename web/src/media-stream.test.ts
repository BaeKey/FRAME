import { describe, expect, it } from 'vitest';
import { mediaStream } from './media-stream';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

describe('media ReadableStream',()=>{
  it('delivers chunks in order and closes at the requested end',async()=>{
    const stream=mediaStream({start:2,end:8,chunkSize:3,controller:new AbortController(),read:async(offset,length)=>new Uint8Array(length).fill(offset)});
    const reader=stream.getReader();const values:number[]=[];for(;;){const next=await reader.read();if(next.done)break;values.push(...next.value);}
    expect(values).toEqual([2,2,2,5,5,5,8]);
  });
  it('does not report a late error after cancellation',async()=>{
    let rejectRead:((error:Error)=>void)|undefined;let errors=0;let cleanups=0;
    const pending=new Promise<Uint8Array>((_resolve,reject)=>{rejectRead=reject;});const controller=new AbortController();
    const reader=mediaStream({start:0,end:5,chunkSize:6,controller,read:()=>pending,onError:()=>{errors++;},cleanup:()=>{cleanups++;}}).getReader();
    const result=reader.read();await tick();await reader.cancel();rejectRead?.(new Error('late'));await tick();
    expect(await result).toEqual({done:true,value:undefined});expect(errors).toBe(0);expect(cleanups).toBe(1);
  });
  it('surfaces genuine read failures once',async()=>{
    let errors=0;const reader=mediaStream({start:0,end:1,chunkSize:2,controller:new AbortController(),read:async()=>{throw new Error('provider failed');},onError:()=>{errors++;}}).getReader();
    await expect(reader.read()).rejects.toThrow('provider failed');await tick();expect(errors).toBe(1);
  });
});
