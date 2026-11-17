export interface Item {
  id: string; name: string; type: 'video' | 'image' | 'unknown'; timestamp: string; size: number;
  cover_url: string; stream_url: string; cover_file_id: string; version: string; cover_version: string;
}
export interface Group { name: string; count: number; latest: string; cover_url: string; cover_version: string; cover_file_id: string }
export interface IndexStatus { scanning: boolean; initialized: boolean; updated: string; error: string; revision: string }
export interface PendingTask { id: string; files: Array<{ name: string; type: string }>; shared: boolean }
export interface NamingRule { name: string; template: string; enabled: boolean }
export interface DeletePlan { token: string; files: Item[]; shared: boolean }
export interface DeleteResult { deleted: string[]; failed: string[] }
export interface SessionData { key_base64: string; expires_at: string; log_level: 'error' | 'info' | 'debug' }
export interface SourceInfo { url: string; size: number }
