import { useEffect, useRef, useState } from 'react';
import type { Group, MediaEntry } from '../types';
import { MediaCard } from './MediaCard';
const PAGE_SIZE=60;
export function MediaGrid({items,mode,managing,selected,onOpen,onSelect}:{items:(Group|MediaEntry)[];mode:'groups'|'files';managing?:boolean;selected?:Set<string>;onOpen:(value:Group|MediaEntry)=>void;onSelect?:(id:string)=>void}) {
  const [count,setCount]=useState(PAGE_SIZE);const sentinel=useRef<HTMLDivElement>(null);
  useEffect(()=>setCount(PAGE_SIZE),[items,mode]);
  useEffect(()=>{
    const node=sentinel.current;if(!node||count>=items.length)return;
    if(!('IntersectionObserver'in window))return;
    const observer=new IntersectionObserver(([entry])=>{if(entry?.isIntersecting)setCount(value=>Math.min(items.length,value+PAGE_SIZE));},{rootMargin:'400px'});
    observer.observe(node);return()=>observer.disconnect();
  },[items.length,count]);
  const visible=items.slice(0,count);
  return <><div className="media-grid" aria-label="媒体内容">{visible.map(value=><MediaCard key={mode==='groups'?(value as Group).name:(value as MediaEntry).id} value={value} groupMode={mode==='groups'} managing={managing} selected={selected?.has((value as MediaEntry).id)} onOpen={onOpen} onSelect={onSelect}/>)}</div>{count<items.length&&<div className="load-more" ref={sentinel}><button className="secondary" onClick={()=>setCount(value=>Math.min(items.length,value+PAGE_SIZE))}>显示更多</button></div>}</>;
}
