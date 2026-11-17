import { useEffect, useRef } from 'react';
export function useIntersection(callback: (visible:boolean)=>void, rootMargin='240px'): React.RefObject<HTMLDivElement|null> {
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const node=ref.current;if(!node)return;
    const observer=new IntersectionObserver(([entry])=>callback(Boolean(entry?.isIntersecting)),{rootMargin});
    observer.observe(node);return()=>observer.disconnect();
  },[callback,rootMargin]);
  return ref;
}
