const levels: Record<LogLevel, number> = { debug: 10, info: 20, error: 40 };
const ALLOWED_FIELDS = new Set(['item_id','transport','source','provider_host','final_host','cipher_start','cipher_end','cipher_bytes','plain_start','plain_bytes','status','reason','attempt','decrypt_location','part']);
export type LogLevel = 'error' | 'info' | 'debug';
export interface LogRecord { time: string; level: LogLevel; event: string; [key: string]: string | number | boolean }
type LogSink = (record: LogRecord) => void;
export function createLogger(level: LogLevel = 'info', sink: LogSink = (record) => console[record.level](`[FRAME] ${record.event}`, record)) {
  const threshold = levels[level] ?? levels.info;
  return (severity: LogLevel, event: string, attrs: Record<string, unknown> = {}): void => {
    if (!(severity in levels) || levels[severity] < threshold || !/^[a-z_]+$/.test(event)) return;
    const record: LogRecord = { time: new Date().toISOString(), level: severity, event };
    for (const [key, value] of Object.entries(attrs)) if (ALLOWED_FIELDS.has(key) && ['string', 'number', 'boolean'].includes(typeof value)) record[key] = value as string | number | boolean;
    sink(record);
  };
}
