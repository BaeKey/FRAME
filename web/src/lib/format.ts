export function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${Math.max(0, bytes / 1024).toFixed(1)} KiB`;
}
export function dateParts(value: string): { date: string; time: string } {
  if (!value) return { date: '日期未知', time: '' };
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return { date: '日期未知', time: '' };
  return {
    date: date.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }),
    time: date.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }),
  };
}
