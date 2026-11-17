import { useEffect, useRef, useState } from 'react';
import type { Group, Item } from '../types';
import { MediaCard } from './MediaCard';
const PAGE_SIZE=60;
export function MediaGrid({items,mode,managing,selected,onOpen,onSelect,onPreview}:{items:(Group|Item)[];mode:'groups'|'files';managing?:boolean;selected?:Set<string>;onOpen:(value:Group|Item)=>void;onSelect?:(id:string)=>void;onPreview?:(item:Item)=>void}) {
  const [count,setCount]=useState(PAGE_SIZE);const sentinel=useRef<HTMLDivElement>(null);
  useEffect(()=>setCount(PAGE_SIZE),[items,mode]);
  useEffect(()=>{
    const node=sentinel.current;if(!node||count>=items.length)return;
    if(!('IntersectionObserver'in window))return;
    const observer=new IntersectionObserver(([entry])=>{if(entry?.isIntersecting)setCount(value=>Math.min(items.length,value+PAGE_SIZE));},{rootMargin:'400px'});
    observer.observe(node);return()=>observer.disconnect();
  },[items.length,count]);
  const visible=items.slice(0,count);
  return <><div className="media-grid" aria-label="媒体内容">{visible.map(value=><MediaCard key={mode==='groups'?(value as Group).name:(value as Item).id} value={value} groupMode={mode==='groups'} managing={managing} selected={selected?.has((value as Item).id)} onOpen={onOpen} onSelect={onSelect} onPreview={onPreview}/>)}</div>{count<items.length&&<div className="load-more" ref={sentinel}><button className="secondary" onClick={()=>setCount(value=>Math.min(items.length,value+PAGE_SIZE))}>显示更多</button></div>}</>;
}
