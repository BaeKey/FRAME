import { describe, expect, it } from 'vitest';
import { decryptFile, decryptRange, importKey } from './crypto';

describe('Go Argon2id AES-CTR fixture', () => {
  it('decrypts the checked-in cross-language vector', async () => {
    const key = await importKey('XIJAqnqV/uSk039erR7griT8E4g5un3ADg6fSfbpi1o=');
    const encoded = 'T0xBRVMxAQABAgMEBQYHCAkKCwwNDg8m7Br+4T4yLXJqQQ==';
    const ciphertext = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const plaintext = await decryptFile(key, ciphertext);
    expect(btoa(String.fromCharCode(...plaintext))).toBe('aGVsbG8gd29ybGQ=');
    const cipherRange = ciphertext.subarray(23, 28);
    const partial = await decryptRange(key, new Uint8Array([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]), cipherRange, 1, 4);
    expect(new TextDecoder().decode(partial)).toBe('ello');
  });
});
