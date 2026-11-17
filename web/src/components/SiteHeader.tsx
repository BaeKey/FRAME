import { useSessionStore } from '../store/session';
import { useUIStore } from '../store/ui';
export function SiteHeader() {
  const authenticated=useSessionStore(s=>s.authenticated);const logout=useSessionStore(s=>s.logout);const setNaming=useUIStore(s=>s.setNamingOpen);
  return <header className="site-header"><a className="brand" href="#/" aria-label="FRAME 媒体库首页"><span className="brand-icon">▦</span><span>FRAME</span></a>{authenticated&&<nav aria-label="账户与设置"><button className="text-button" onClick={()=>setNaming(true)}>命名规则</button><span className="nav-separator"/><button className="text-button" onClick={()=>void logout().catch(error=>window.dispatchEvent(new CustomEvent('frame-toast',{detail:error instanceof Error?error.message:'退出登录失败'})))}>↪ 退出登录</button></nav>}</header>;
}
