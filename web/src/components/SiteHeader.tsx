import { useSessionStore } from '../store/session';
import { useUIStore } from '../store/ui';
export function SiteHeader() {
  const authenticated=useSessionStore(s=>s.authenticated);const logout=useSessionStore(s=>s.logout);const setNaming=useUIStore(s=>s.setNamingOpen);
  return <header className="site-header"><a className="brand" href="#/" aria-label="FRAME 媒体库首页"><span className="brand-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" focusable="false"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="m7 16 3.5-4.5 3 3.5 2-2 2 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><circle cx="15.5" cy="8.5" r="1.5" fill="currentColor"/></svg></span><span>FRAME</span></a>{authenticated&&<nav aria-label="账户与设置"><button className="text-button" onClick={()=>setNaming(true)}>命名规则</button><span className="nav-separator"/><button className="text-button" onClick={()=>void logout().catch(error=>window.dispatchEvent(new CustomEvent('frame-toast',{detail:error instanceof Error?error.message:'退出登录失败'})))}>↪ 退出登录</button></nav>}</header>;
}
