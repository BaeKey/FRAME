const basePath = typeof window === 'undefined' ? '' : window.location.pathname.replace(/\/+$/, '');

export function appPath(path: string): string {
  return `${basePath}${path.startsWith('/') ? path : `/${path}`}`;
}
