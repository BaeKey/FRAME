export const HEADER_SIZE = 23;
const MAGIC = 'OLAES1';

export function parseHeader(bytes: Uint8Array): Uint8Array {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  if (bytes.length < HEADER_SIZE || String.fromCharCode(...bytes.subarray(0, 6)) !== MAGIC || bytes[6] !== 1) {
    throw new Error('不是加密文件（OLAES1 文件头无效）');
  }
  return bytes.slice(7, 23);
}

export function addCounter(iv: Uint8Array, block: bigint): Uint8Array {
  if (iv.length !== 16 || block < 0n) throw new Error('无效计数器');
  let value = 0n;
  for (const byte of iv) value = (value << 8n) | BigInt(byte);
  value = (value + block) & ((1n << 128n) - 1n);
  const counter = new Uint8Array(16);
  for (let i = 15; i >= 0; i--) { counter[i] = Number(value & 255n); value >>= 8n; }
  return counter;
}

export async function importKey(base64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  if (raw.length !== 32) { raw.fill(0); throw new Error('解密密钥长度无效'); }
  try { return await crypto.subtle.importKey('raw', raw, 'AES-CTR', false, ['decrypt']); }
  finally { raw.fill(0); }
}

export function alignedRange(offset: number, length: number): { start: number; end: number; skip: number; block: bigint } {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 1 || !Number.isSafeInteger(offset + length)) throw new Error('无效解密范围');
  const skip = offset % 16;
  return { start: HEADER_SIZE + offset - skip, end: HEADER_SIZE + offset + length - 1, skip, block: BigInt(Math.floor(offset / 16)) };
}

export async function decryptRange(key: CryptoKey, iv: Uint8Array, ciphertext: Uint8Array, offset: number, length: number): Promise<Uint8Array> {
  const range = alignedRange(offset, length);
  if (ciphertext.length !== range.skip + length) throw new Error('密文被截断或长度不符');
  const counter = new Uint8Array(addCounter(iv, range.block)).buffer as ArrayBuffer;
  const data = new Uint8Array(ciphertext).buffer as ArrayBuffer;
  const plain = await crypto.subtle.decrypt({ name: 'AES-CTR', counter, length: 128 }, key, data);
  return new Uint8Array(plain).slice(range.skip);
}

export async function decryptFile(key: CryptoKey, bytes: Uint8Array): Promise<Uint8Array> {
  const iv = parseHeader(bytes);
  if (bytes.length === HEADER_SIZE) return new Uint8Array();
  return decryptRange(key, iv, bytes.subarray(HEADER_SIZE), 0, bytes.length - HEADER_SIZE);
}

export function imageType(bytes: Uint8Array): string {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) return 'image/png';
  const text = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (['GIF87a', 'GIF89a'].includes(text(0, 6))) return 'image/gif';
  if (bytes.length >= 12 && text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'image/webp';
  throw new Error('图片格式不符，密码或配置可能有误');
}

export function checkMP4(bytes: Uint8Array): void {
  if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(4, 8)) !== 'ftyp') throw new Error('MP4 格式不符，密码或配置可能有误');
}

export function parseRange(value: string | null, size: number): { start: number; end: number; partial: boolean } {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('无效文件大小');
  if (!value) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || size === 0 || (!match[1] && !match[2])) throw new Error('Range 超出范围');
  const number = (s: string) => { const n = Number(s); if (!Number.isSafeInteger(n)) throw new Error('Range 超出范围'); return n; };
  let start: number; let end: number;
  if (!match[1]) { const suffix = number(match[2] ?? ''); if (!suffix) throw new Error('Range 超出范围'); start = Math.max(0, size - suffix); end = size - 1; }
  else { start = number(match[1]); end = match[2] ? Math.min(size - 1, number(match[2])) : size - 1; }
  if (start >= size || end < start) throw new Error('Range 超出范围');
  return { start, end, partial: true };
}
