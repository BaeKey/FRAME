import type { IndexStatus as Status } from '../types';
export function IndexStatus({value,onRefresh,busy}:{value:Status|null;onRefresh:()=>void;busy:boolean}) {
  const text=value?.scanning?'正在扫描媒体库…':value?.error?value.error:value?.updated?`上次更新：${new Date(value.updated).toLocaleString('zh-CN')}`:'尚未建立索引';
  return <div className="index-actions"><button className="secondary" onClick={onRefresh} disabled={busy}>↻ {busy?'正在刷新…':'刷新媒体库'}</button><span className="small muted" role="status">{text}</span></div>;
}
