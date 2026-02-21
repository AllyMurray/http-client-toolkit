import { readFileSync, existsSync } from 'fs';
import type { ServerResponse } from 'http';
import { join, dirname, extname, resolve } from 'path';
import { fileURLToPath } from 'url';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

let cachedIndexHtml: string | undefined;
let clientDir: string | undefined;

function getCurrentDir(): string {
  // ESM: use import.meta.url; CJS: use __dirname
  try {
    return dirname(fileURLToPath(import.meta.url));
    /* v8 ignore start -- CJS fallback unreachable in ESM test environment */
  } catch {
    // Fallback for CJS
    return typeof __dirname !== 'undefined' ? __dirname : process.cwd();
  }
  /* v8 ignore stop */
}

function getClientDir(): string {
  if (clientDir) return clientDir;
  const currentDir = getCurrentDir();
  // In built output: lib/index.js → dist/client/
  // Navigate from lib/ up to package root, then into dist/client
  clientDir = resolve(currentDir, '..', 'dist', 'client');
  return clientDir;
}

function getIndexHtml(): string {
  if (cachedIndexHtml) return cachedIndexHtml;
  const indexPath = join(getClientDir(), 'index.html');
  if (existsSync(indexPath)) {
    cachedIndexHtml = readFileSync(indexPath, 'utf-8');
  } else {
    cachedIndexHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Dashboard</title></head>
<body>
<div id="root">
  <p style="font-family:sans-serif;text-align:center;margin-top:4rem">
    Dashboard client not built. Run <code>vite build</code> first.
  </p>
</div>
</body>
</html>`;
  }
  return cachedIndexHtml;
}

export function serveStatic(res: ServerResponse, pathname: string): boolean {
  const dir = getClientDir();

  // Try to serve a static file
  if (pathname !== '/' && pathname !== '/index.html') {
    const filePath = resolve(join(dir, pathname));
    if (!filePath.startsWith(dir + '/')) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad request');
      return true;
    }
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath);
        const ext = extname(pathname);
        const mimeType = MIME_TYPES[ext] ?? 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': mimeType,
          'Content-Length': content.length,
          'Cache-Control': pathname.includes('/assets/')
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        });
        res.end(content);
        return true;
      } catch {
        // Fall through to SPA fallback
      }
    }
  }

  // SPA fallback: serve index.html
  const html = getIndexHtml();
  res.writeHead(200, {
    'Content-Type': 'text/html',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-cache',
  });
  res.end(html);
  return true;
}
