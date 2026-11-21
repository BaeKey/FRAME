import { create } from 'zustand';
import type { DeletePlan, MediaEntry } from '../types';
export interface PageState { query: string; sort: 'asc'|'desc'; scroll: number }
interface UIState {
  managing: boolean; selectedIds: Set<string>; deleting: boolean; pendingDeletePlan: DeletePlan|null;
  viewerItem: MediaEntry|null; namingDialogOpen: boolean; deleteDialogOpen: boolean; pageStates: Map<string,PageState>;
  toggleManaging(): void; toggleSelect(id:string):void; selectAll(ids:string[]):void; clearSelection():void; setNamingOpen(open:boolean):void;
  openViewer(item:MediaEntry):void; closeViewer():void; savePageState(key:string,s:Partial<PageState>):void; getPageState(key:string):PageState;
  setDeletePlan(plan:DeletePlan|null):void; setDeleting(value:boolean):void; reset():void;
}
const initialPage: PageState = { query:'', sort:'desc', scroll:0 };
export const useUIStore = create<UIState>((set,get) => ({
  managing:false, selectedIds:new Set(), deleting:false, pendingDeletePlan:null, viewerItem:null, namingDialogOpen:false, deleteDialogOpen:false, pageStates:new Map(),
  toggleManaging() { set((s) => ({ managing:!s.managing, selectedIds:new Set() })); },
  toggleSelect(id) { set((s) => { const ids=new Set(s.selectedIds); if(ids.has(id))ids.delete(id); else if(ids.size<200)ids.add(id); return {selectedIds:ids}; }); },
  selectAll(ids) { set({selectedIds:new Set(ids.slice(0,200))}); }, clearSelection() { set({selectedIds:new Set()}); },
  setNamingOpen(open) { set({namingDialogOpen:open}); },
  openViewer(item) { set({viewerItem:item}); }, closeViewer() { set({viewerItem:null}); },
  savePageState(key,s) { set((state) => { const pageStates=new Map(state.pageStates); pageStates.set(key,{...initialPage,...pageStates.get(key),...s}); return {pageStates}; }); },
  getPageState(key) { return {...initialPage,...get().pageStates.get(key)}; },
  setDeletePlan(plan) { set({pendingDeletePlan:plan,deleteDialogOpen:plan!==null}); }, setDeleting(value) { set({deleting:value}); },
  reset() { set({managing:false,selectedIds:new Set(),deleting:false,pendingDeletePlan:null,viewerItem:null,namingDialogOpen:false,deleteDialogOpen:false,pageStates:new Map()}); },
}));
