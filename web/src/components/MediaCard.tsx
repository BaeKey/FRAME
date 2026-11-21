import { useEffect, useRef, useState } from 'react';
import type { Group, MediaEntry } from '../types';
import { useCover } from '../hooks/useCover';
import { dateParts, formatSize } from '../lib/format';
import { appPath } from '../lib/base-path';

export function MediaCard({ value, groupMode, managing, selected, onOpen, onSelect }: {
  value: Group|MediaEntry; groupMode:boolean; managing?:boolean; selected?:boolean; onOpen:(value:Group|MediaEntry)=>void; onSelect?:(id:string)=>void;
}) {
  const [visible,setVisible]=useState(false);const [broken,setBroken]=useState(false);const ref=useRef<HTMLElement>(null);
  const cover=useCover(value,visible);
  useEffect(()=>{const node=ref.current;if(!node)return;if(!('IntersectionObserver'in window)){setVisible(true);return;}const observer=new IntersectionObserver(([entry])=>setVisible(Boolean(entry?.isIntersecting)),{rootMargin:'240px'});observer.observe(node);return()=>observer.disconnect();},[]);
  const item=value as MediaEntry; const group=value as Group; const isGroup=groupMode;
  const date=dateParts(isGroup?group.latest:item.timestamp);
  const title=isGroup||!item.timestamp||item.type==='unknown'?value.name:date.date;
  const sub=isGroup?`${group.count} 项内容`:`${date.time} · ${item.type==='video'?'视频':item.type==='image'?'图片':'文件'}`;
  const detail=isGroup?`更新于 ${date.date}`:formatSize(Math.max(0,item.size-23));
  const id=isGroup?group.name:item.id;
  return <article ref={ref} className={`media-card${selected?' selected':''}`}>
    <button className="card" onClick={()=>managing&&!isGroup?onSelect?.(id):onOpen(value)} aria-label={isGroup?`打开分组 ${group.name}，${group.count} 项内容`:`${item.type==='video'?'播放视频':item.type==='image'?'预览图片':'查看文件'}${item.pairedVideos.length?'并播放配套视频':''} ${item.name}`}>
      <div className={`card-visual${broken||!value.cover_file_id?' is-placeholder':''}`}><img src={broken?appPath('/static/placeholder.svg'):cover.src} alt="" loading="lazy" onError={()=>setBroken(true)}/>{!isGroup&&<span className="media-badge">{item.type==='video'?'▶ 播放视频':item.type==='image'?`▧ 图片${item.pairedVideos.length?' · ▶ 视频':''}`:'文件'}</span>}</div>
      <div className="card-body"><strong className="card-title" title={value.name}>{title}</strong><div className="card-meta"><span>{sub}</span><span>{detail}</span></div></div>
    </button>
    {managing&&!isGroup&&<label className="video-select-label"><input className="video-select" type="checkbox" checked={Boolean(selected)} onChange={()=>onSelect?.(id)} aria-label={`选择文件：${item.name}`}/></label>}
  </article>;
}
