import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';

const session = {
  key_base64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  expires_at: '2099-01-01T00:00:00Z',
  log_level: 'info',
};

afterEach(() => vi.unstubAllGlobals());

describe('cookie-based API session', () => {
  it('accepts the login cookie and uses it for the decryption session', async () => {
    // Model the browser credential contract: omit also ignores Set-Cookie.
    let hasCookie = false;
    const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(init?.cache).toBe('no-store');
      if (path === '/api/login') {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-token');
        hasCookie = init?.credentials === 'same-origin';
        return Response.json({ ok: true }, { headers: { 'Set-Cookie': 'gateway_session=session-id; Path=/; HttpOnly; SameSite=Strict' } });
      }
      expect(path).toBe('/api/session');
      expect(new Headers(init?.headers).has('Authorization')).toBe(false);
      if (!hasCookie || init?.credentials !== 'same-origin') {
        return Response.json({ error: '访问令牌无效' }, { status: 401 });
      }
      return Response.json(session);
    });
    vi.stubGlobal('fetch', fetcher);
    const onUnauthorized = vi.fn();
    const api = createApiClient(onUnauthorized);

    await api.login('access-token');
    await expect(api.getSession()).resolves.toEqual(session);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('sends the session cookie when logging out', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetcher);

    await createApiClient(vi.fn()).logout();

    expect(fetcher).toHaveBeenCalledWith('/api/logout', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
    });
  });

  it('clears local authentication when the server rejects an expired session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: '访问令牌无效' }, { status: 401 })));
    const onUnauthorized = vi.fn();

    await expect(createApiClient(onUnauthorized).getSession()).rejects.toThrow('访问令牌无效');
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});
