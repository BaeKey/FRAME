import type { PendingTask } from '../types';
export function PendingPanel({tasks,onRetry}:{tasks:PendingTask[];onRetry:(id:string)=>void}) {
  if(!tasks.length)return null;
  return <details className="pending-panel"><summary>⚠ 有 {tasks.length} 个删除任务待重试</summary><p>部分文件未能删除。请核对后重试，已删除的文件不会重复处理。</p>{tasks.map(task=><div className="pending-task" key={task.id}><span>{task.files.map(file=>file.name).join('、')}</span><button className="secondary" onClick={()=>onRetry(task.id)}>重试</button></div>)}</details>;
}
