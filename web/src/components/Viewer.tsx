import { useEffect, useRef, useState } from 'react';
import type { TouchEvent } from 'react';
import type { Item } from '../types';
import { decryptFile, imageType } from '../crypto';
import { getImageBytes } from '../image-cache';
import { useSessionStore } from '../store/session';
import { formatSize } from '../lib/format';
import { appPath } from '../lib/base-path';

export function Viewer({item,onClose,onDelete}:{item:Item|null;onClose:()=>void;onDelete:(item:Item)=>void}) {
  const [src,setSrc]=useState('');const [error,setError]=useState('');const [scale,setScale]=useState(1);
  const lastTap=useRef<{time:number;x:number;y:number}|null>(null);
  useEffect(()=>{
    if(!item)return;let active=true;let objectURL='';setError('');setSrc('');setScale(1);lastTap.current=null;
    if(item.type==='video')return;
    if(item.type==='unknown'){setError('此格式暂不支持预览。可下载解密后的原始文件，或单独删除。');return;}
    void (async()=>{try{const bytes=await getImageBytes(item.id,item.version,()=>useSessionStore.getState().downloadFile(item.id));const key=(await useSessionStore.getState().getKey()).key;const plain=await decryptFile(key,bytes);useSessionStore.getState().log('debug','media_decrypted',{item_id:item.id,plain_bytes:plain.length,decrypt_location:'browser'});objectURL=URL.createObjectURL(new Blob([new Uint8Array(plain).buffer as ArrayBuffer],{type:imageType(plain)}));if(active)setSrc(objectURL);}catch(cause){if(active)setError(cause instanceof Error?cause.message:'图片无法解密');}})();
    return()=>{active=false;if(objectURL)URL.revokeObjectURL(objectURL);};
  },[item?.id,item?.version,item?.type]);
  if(!item)return null;
  const toggleZoom=()=>setScale(value=>value===1?2:1);
  const onImageTouchEnd=(event:TouchEvent<HTMLImageElement>)=>{
    const touch=event.changedTouches[0];if(!touch)return;
    const now=Date.now();const previous=lastTap.current;
    if(previous&&now-previous.time<350&&Math.hypot(touch.clientX-previous.x,touch.clientY-previous.y)<40){
      event.preventDefault();lastTap.current=null;toggleZoom();return;
    }
    lastTap.current={time:now,x:touch.clientX,y:touch.clientY};
  };
  return <div className="viewer-backdrop" role="presentation" onMouseDown={(e)=>{if(e.target===e.currentTarget)onClose();}}><section className="viewer" role="dialog" aria-modal="true" aria-labelledby="media-title">
    <header className="viewer-header"><div className="viewer-heading"><span className="small">{item.type==='video'?'视频预览':item.type==='image'?'图片预览':'其他格式文件'}</span><h2 id="media-title">{item.name}</h2></div><button className="icon-button" aria-label="关闭预览" onClick={onClose}>×</button></header>
    <div className={`media-stage${scale>1?' is-zoomed':''}`}>{item.type==='video'?<video src={appPath(`/dec/${item.id}`)} autoPlay controls playsInline onError={()=>setError('无法播放。请检查加密配置、文件完整性，以及浏览器是否支持该视频编码。')}/>:src?<img src={src} alt={item.name} onDoubleClick={toggleZoom} onTouchEnd={onImageTouchEnd} style={{width:scale===1?'auto':`${scale*100}%`}}/>:!error?<span className="spinner"/>:null}</div>
    <p className="media-error" role="alert">{error}</p><footer className="viewer-toolbar">{item.type==='image'&&<div className="image-tools"><button className="icon-button" aria-label="缩小图片" onClick={()=>setScale(Math.max(.1,scale*.8))}>−</button><span>{scale===1?'适应窗口':`${Math.round(scale*100)}%`}</span><button className="icon-button" aria-label="放大图片" onClick={()=>setScale(Math.min(5,scale*1.25))}>＋</button><button className="text-button" onClick={()=>setScale(1)}>适应窗口</button></div>}<span className="small">{formatSize(Math.max(0,item.size-23))}</span><a className="text-button" href={item.type==='image'?(src||'#'):appPath(`/download/${item.id}`)} download={item.name} onClick={(e)=>{if(item.type==='image'&&!src)e.preventDefault();}}>下载解密文件</a><button className="text-button danger-text" onClick={()=>onDelete(item)}>{item.type==='image'?'删除图片及配套视频':'删除文件'}</button></footer>
  </section></div>;
}
