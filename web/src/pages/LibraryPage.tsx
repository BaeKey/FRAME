import { Link, useNavigate, useParams } from 'react-router';
import { useEffect, useMemo, useState } from 'react';
import type { Group, Item } from '../types';
import { useLibraryStore } from '../store/library';
import { useUIStore } from '../store/ui';
import { filterItems, groupHash } from '../lib/navigation';
import { MediaGrid } from '../components/MediaGrid';
import { IndexStatus } from '../components/IndexStatus';
import { PendingPanel } from '../components/PendingPanel';
import { Viewer } from '../components/Viewer';
import { DeleteDialog } from '../components/DeleteDialog';
import { purgeFromCache } from '../image-cache';

export function LibraryPage() {
 const {group:routeGroup}=useParams();const group=routeGroup??null;const isGroup=group!==null;
 const groups=useLibraryStore(s=>s.groups);const items=useLibraryStore(s=>s.items);const loadGroups=useLibraryStore(s=>s.loadGroups);const loadItems=useLibraryStore(s=>s.loadItems);const index=useLibraryStore(s=>s.indexStatus);const pending=useLibraryStore(s=>s.pendingTasks);const loadStatus=useLibraryStore(s=>s.loadIndexStatus);const refreshIndex=useLibraryStore(s=>s.refreshIndex);const makePlan=useLibraryStore(s=>s.createDeletePlan);const executeDelete=useLibraryStore(s=>s.executeBatchDelete);const retry=useLibraryStore(s=>s.retryDelete);
 const {managing,selectedIds,toggleManaging,toggleSelect,selectAll,clearSelection,viewerItem,openViewer,closeViewer,pendingDeletePlan,setDeletePlan}=useUIStore();
 const navigate=useNavigate();const [query,setQuery]=useState('');const [type,setType]=useState<'collection'|'all'|'video'|'image'>('collection');const [sort,setSort]=useState<'asc'|'desc'>('desc');const [busy,setBusy]=useState(false);const [refreshing,setRefreshing]=useState(false);const [deleteError,setDeleteError]=useState('');const [error,setError]=useState('');
 useEffect(()=>{setQuery('');setType('collection');setSort('desc');clearSelection();toggleManagingReset();},[group]);
 function toggleManagingReset(){useUIStore.setState({managing:false,selectedIds:new Set()});}
 const reload=async()=>{if(isGroup)await loadItems(group,sort);else await loadGroups();await loadStatus();};
 useEffect(()=>{void reload().then(()=>setError('')).catch(e=>setError(e instanceof Error?e.message:'无法加载媒体库'));},[group,sort]);
 const source=(isGroup?items:groups) as (Item|Group)[];
 const filtered=useMemo(()=>filterItems(source,query,isGroup?type:'all'),[source,query,type,isGroup]);
 const openDelete=async(ids:string[])=>{setBusy(true);setDeleteError('');try{const plan=await makePlan(ids);setDeletePlan(plan);closeViewer();}catch(e){setDeleteError(e instanceof Error?e.message:'无法准备删除');}finally{setBusy(false);}};
 const confirmDelete=async()=>{if(!pendingDeletePlan)return;setBusy(true);setDeleteError('');try{const deleted=await executeDelete(pendingDeletePlan.files.map(file=>file.id),pendingDeletePlan.token);purgeFromCache(deleted);setDeletePlan(null);clearSelection();await reload();setError('删除完成。');}catch(e){setDeleteError(e instanceof Error?e.message:'删除失败');}finally{setBusy(false);}};
 const onRefresh=async()=>{setRefreshing(true);try{await refreshIndex(true);await reload();}catch(e){setError(e instanceof Error?e.message:'刷新失败');}finally{setRefreshing(false);}};
 const onRetry=async(id:string)=>{try{await retry(id);await reload();}catch(e){setError(e instanceof Error?e.message:'重试失败');}};
 return <main className="library" id="main" tabIndex={-1}>
  {isGroup&&<nav className="breadcrumbs" aria-label="当前位置"><Link to="/">← 全部分组</Link><span>/</span><span>{group}</span></nav>}
  <div className="page-heading"><div className="heading-copy"><span className="section-kicker">{isGroup?'分组内容':'你的收藏'}</span><h1>{isGroup?group:'全部分组'}</h1><p className="muted">{isGroup?`${filtered.length} 项内容`:`${groups.length} 个分组${useLibraryStore.getState().unrecognized?` · ${useLibraryStore.getState().unrecognized} 个文件位于其他`:''}`}</p></div><IndexStatus value={index} onRefresh={()=>void onRefresh()} busy={refreshing}/></div>
  {error&&<div role="alert" className="error-banner"><span>{error}</span><button className="secondary" onClick={()=>void reload().then(()=>setError('')).catch(e=>setError(e instanceof Error?e.message:'无法加载媒体库'))}>重新加载</button></div>}
  <PendingPanel tasks={pending} onRetry={id=>void onRetry(id)}/>
  <div className="library-toolbar"><label className="search-field"><span>⌕</span><input type="search" aria-label={isGroup?'搜索文件名或日期':'搜索分组'} placeholder={isGroup?'搜索文件名或日期':'搜索分组'} value={query} onChange={e=>setQuery(e.target.value)}/></label>{isGroup&&<div className="segmented" role="group" aria-label="内容类型">{(['collection','all','video','image'] as const).map((name,i)=><button key={name} aria-pressed={type===name} onClick={()=>setType(name)}>{['合集','全部','视频','图片'][i]}</button>)}</div>}<div className="toolbar-end">{isGroup&&<><label className="sort-field"><span className="sr-only">时间排序</span><select value={sort} onChange={e=>setSort(e.target.value as 'asc'|'desc')}><option value="desc">最新在前</option><option value="asc">最早在前</option></select></label><button className="secondary" aria-pressed={managing} onClick={()=>toggleManaging()}>{managing?'完成管理':'管理文件'}</button></>}</div></div>
  {managing&&isGroup&&<div className="selection-bar"><div><strong id="selection-count">已选 {selectedIds.size} 个文件</strong><span className="small">每批最多选择 200 项</span></div><div className="selection-actions"><button className="text-button" onClick={()=>selectAll(filtered.map(v=>(v as Item).id))}>全选当前结果</button><button className="text-button" onClick={clearSelection}>清空选择</button><button className="danger" disabled={!selectedIds.size||busy} onClick={()=>void openDelete([...selectedIds])}>删除所选</button></div></div>}
  <p className="result-count muted small">{filtered.length?`显示 ${filtered.length} 项`:''}</p>
  {filtered.length?<MediaGrid items={filtered} mode={isGroup?'files':'groups'} managing={managing} selected={selectedIds} onOpen={value=>isGroup?openViewer(value as Item):navigate(groupHash(value.name).slice(1))} onSelect={id=>toggleSelect(id)} onPreview={item=>openViewer(item)}/>:<div className="page-state"><span className="state-icon">▦</span><h2>{query?'没有找到匹配内容':isGroup?'这里还没有内容':'暂无分组'}</h2><p>{query?'尝试调整搜索条件。':'媒体库索引中没有可显示的内容。'}</p>{query&&<button className="secondary" onClick={()=>setQuery('')}>清除筛选</button>}</div>}
  <Viewer item={viewerItem} onClose={closeViewer} onDelete={item=>void openDelete([item.id])}/>
  <DeleteDialog plan={pendingDeletePlan} busy={busy} error={deleteError} onCancel={()=>setDeletePlan(null)} onConfirm={()=>void confirmDelete()}/>
 </main>;
}
