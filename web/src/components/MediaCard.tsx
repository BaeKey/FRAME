import { useEffect, useRef, useState } from 'react';
import type { Group, Item } from '../types';
import { useCover } from '../hooks/useCover';
import { dateParts, formatSize } from '../lib/format';

export function MediaCard({ value, groupMode, managing, selected, onOpen, onSelect, onPreview }: {
  value: Group|Item; groupMode:boolean; managing?:boolean; selected?:boolean; onOpen:(value:Group|Item)=>void; onSelect?:(id:string)=>void; onPreview?:(value:Item)=>void;
}) {
  const [visible,setVisible]=useState(false);const [broken,setBroken]=useState(false);const ref=useRef<HTMLElement>(null);
  const cover=useCover(value,visible);
  useEffect(()=>{const node=ref.current;if(!node)return;if(!('IntersectionObserver'in window)){setVisible(true);return;}const observer=new IntersectionObserver(([entry])=>setVisible(Boolean(entry?.isIntersecting)),{rootMargin:'240px'});observer.observe(node);return()=>observer.disconnect();},[]);
  const item=value as Item; const group=value as Group; const isGroup=groupMode;
  const date=dateParts(isGroup?group.latest:item.timestamp);
  const title=isGroup||!item.timestamp||item.type==='unknown'?value.name:date.date;
  const sub=isGroup?`${group.count} 项内容`:`${date.time} · ${item.type==='video'?'视频':item.type==='image'?'图片':'文件'}`;
  const detail=isGroup?`更新于 ${date.date}`:formatSize(Math.max(0,item.size-23));
  const id=isGroup?group.name:item.id;
  return <article ref={ref} className={`media-card${selected?' selected':''}`}>
    <button className="card" onClick={()=>managing&&!isGroup?onSelect?.(id):onOpen(value)} aria-label={isGroup?`打开分组 ${group.name}，${group.count} 项内容`:`${item.type==='video'?'播放视频':item.type==='image'?'查看图片':'查看文件'} ${item.name}`}>
      <div className={`card-visual${broken||!value.cover_file_id?' is-placeholder':''}`}><img src={broken?'/static/placeholder.svg':cover.src} alt="" loading="lazy" onError={()=>setBroken(true)}/>{!isGroup&&<span className="media-badge">{item.type==='video'?'▶ 视频':item.type==='image'?'▧ 图片':'文件'}</span>}</div>
      <div className="card-body"><strong className="card-title" title={value.name}>{title}</strong><div className="card-meta"><span>{sub}</span><span>{detail}</span></div></div>
    </button>
    {!isGroup&&item.cover_file_id&&onPreview&&<button className="icon-button cover-preview" aria-label={`预览封面：${item.name}`} onClick={()=>onPreview(item)}>↗</button>}
    {managing&&!isGroup&&<label className="video-select-label"><input className="video-select" type="checkbox" checked={Boolean(selected)} onChange={()=>onSelect?.(id)} aria-label={`选择文件：${item.name}`}/></label>}
  </article>;
}
