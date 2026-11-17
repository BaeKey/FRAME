import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router';
import { useSessionStore } from './store/session';
import { useLibraryStore } from './store/library';
import { useUIStore } from './store/ui';
import { SiteHeader } from './components/SiteHeader';
import { NamingDialog } from './components/NamingDialog';
import { LoginPage } from './pages/LoginPage';
import { LibraryPage } from './pages/LibraryPage';
import './index.css';

function App() {
  const authenticated=useSessionStore(s=>s.authenticated);const loading=useSessionStore(s=>s.loading);const restore=useSessionStore(s=>s.restore);
  const namingOpen=useUIStore(s=>s.namingDialogOpen);const setNaming=useUIStore(s=>s.setNamingOpen);const resetLibrary=useLibraryStore(s=>s.reset);
  useEffect(()=>{void restore();},[restore]);
  useEffect(()=>{const onMessage=(event:MessageEvent)=>{if(event.data?.type==='PLAYBACK_ERROR')window.dispatchEvent(new CustomEvent('frame-toast',{detail:event.data.message}));};navigator.serviceWorker?.addEventListener('message',onMessage);return()=>navigator.serviceWorker?.removeEventListener('message',onMessage);},[]);
  useEffect(()=>{if(!authenticated){resetLibrary();useUIStore.getState().reset();}},[authenticated,resetLibrary]);
  if(loading)return <div className="page-state" role="status"><span className="spinner"/><p>正在打开媒体库…</p></div>;
  return <HashRouter><SiteHeader/><Routes>{authenticated?<><Route path="/" element={<LibraryPage/>}/><Route path="/:group" element={<LibraryPage/>}/><Route path="*" element={<Navigate to="/" replace/>}/></>:<Route path="*" element={<LoginPage/>}/>}</Routes><NamingDialog open={authenticated&&namingOpen} onClose={()=>setNaming(false)}/><Toast/></HashRouter>;
}
function Toast(){const [message,setMessage]=React.useState('');React.useEffect(()=>{const listener=(event:Event)=>{setMessage(String((event as CustomEvent).detail));setTimeout(()=>setMessage(''),6000);};window.addEventListener('frame-toast',listener);return()=>window.removeEventListener('frame-toast',listener);},[]);return message?<div className="toast" role="status">{message}</div>:null;}
const root = document.getElementById('root');
if (!root) throw new Error('FRAME root element is missing');
createRoot(root).render(<React.StrictMode><App /></React.StrictMode>);

export default App;
