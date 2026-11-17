import { useEffect, useState } from 'react';
import type { Group, Item } from '../types';
import { getImageBytes } from '../image-cache';
import { decryptFile, imageType } from '../crypto';
import { useSessionStore } from '../store/session';

export function useCover(item: Item | Group, visible = true): { src: string; loading: boolean } {
  const [src, setSrc] = useState('/static/placeholder.svg'); const [loading,setLoading]=useState(false);
  const fileId=item.cover_file_id; const version=item.cover_version;
  useEffect(() => {
    let active=true; let blobUrl:string|undefined;
    if(!fileId||!visible){setSrc('/static/placeholder.svg');setLoading(false);return;}
    setLoading(true);
    void (async()=>{
      try {
        const bytes=await getImageBytes(fileId,version,()=>useSessionStore.getState().downloadFile(fileId));
        const key=(await useSessionStore.getState().getKey()).key;
        const plain=await decryptFile(key,bytes); const type=imageType(plain);
        useSessionStore.getState().log('debug','media_decrypted',{item_id:fileId,plain_bytes:plain.length,decrypt_location:'browser'});
        if(!active)return;
        blobUrl=URL.createObjectURL(new Blob([new Uint8Array(plain).buffer as ArrayBuffer],{type}));setSrc(blobUrl);
      } catch { if(active)setSrc('/static/placeholder.svg'); }
      finally { if(active)setLoading(false); }
    })();
    return ()=>{active=false;if(blobUrl)URL.revokeObjectURL(blobUrl);};
  },[fileId,version,visible]);
  return {src,loading};
}
