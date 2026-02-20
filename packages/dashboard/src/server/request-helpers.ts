import type { IncomingMessage } from 'http';

export function parseUrl(
  req: IncomingMessage,
  basePath: string,
): { pathname: string; query: URLSearchParams } {
  const raw = req.url ?? '/';
  const url = new URL(raw, 'http://localhost');

  let pathname = url.pathname;
  if (
    basePath !== '/' &&
    pathname.startsWith(basePath) &&
    (pathname.length === basePath.length || pathname[basePath.length] === '/')
  ) {
    pathname = pathname.slice(basePath.length) || '/';
  }

  return { pathname, query: url.searchParams };
}

export function extractParam(
  pathname: string,
  pattern: string,
): string | undefined {
  // pattern like "/api/cache/entries/:hash"
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');

  if (patternParts.length !== pathParts.length) return undefined;

  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i]!;
    if (pp.startsWith(':')) continue;
    if (pp !== pathParts[i]) return undefined;
  }

  const paramIndex = patternParts.findIndex((p) => p.startsWith(':'));
  if (paramIndex === -1) return undefined;
  return pathParts[paramIndex];
}

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB

export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body) as T);
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}
