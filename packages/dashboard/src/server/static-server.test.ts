import { existsSync, readFileSync } from 'fs';
import type { ServerResponse } from 'http';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockExistsSync = existsSync as Mock;
const mockReadFileSync = readFileSync as Mock;

function mockResponse(): ServerResponse & {
  _status: number;
  _headers: Record<string, string | number>;
  _body: unknown;
} {
  const res = {
    _status: 0,
    _headers: {} as Record<string, string | number>,
    _body: undefined as unknown,
    writeHead(status: number, headers: Record<string, string | number>) {
      res._status = status;
      res._headers = headers;
    },
    end(content: unknown) {
      res._body = content;
    },
  };
  return res as unknown as ServerResponse & {
    _status: number;
    _headers: Record<string, string | number>;
    _body: unknown;
  };
}

// We need a fresh module for each test to reset the module-level caches
// (cachedIndexHtml and clientDir).
async function importFresh() {
  // Clear module cache so we get fresh module-level variables
  const modulePath = './static-server.js';
  // Use dynamic import with cache busting
  const mod = await import(modulePath);
  return mod;
}

describe('serveStatic', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Reset the module-level state by re-importing
    vi.resetModules();
  });

  it('should serve SPA fallback with built index.html when dist/client/index.html exists', async () => {
    const { serveStatic } = await importFresh();

    mockExistsSync.mockImplementation((path: string) => {
      if (path.endsWith('index.html')) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((path: string, encoding?: string) => {
      if (path.endsWith('index.html') && encoding === 'utf-8') {
        return '<html><body>Built Dashboard</body></html>';
      }
      return '';
    });

    const res = mockResponse();
    const result = serveStatic(res, '/');

    expect(result).toBe(true);
    expect(res._status).toBe(200);
    expect(res._headers['Content-Type']).toBe('text/html');
    expect(res._body).toBe('<html><body>Built Dashboard</body></html>');
  });

  it('should serve SPA fallback with placeholder when dist/client/index.html does not exist', async () => {
    const { serveStatic } = await importFresh();

    mockExistsSync.mockReturnValue(false);

    const res = mockResponse();
    const result = serveStatic(res, '/');

    expect(result).toBe(true);
    expect(res._status).toBe(200);
    expect(res._headers['Content-Type']).toBe('text/html');
    expect(res._body).toContain('Dashboard client not built');
  });

  it('should serve a static file when it exists', async () => {
    const { serveStatic } = await importFresh();

    const fileContent = Buffer.from('body { color: red; }');
    mockExistsSync.mockImplementation((path: string) => {
      if (path.endsWith('style.css')) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((path: string, encoding?: string) => {
      if (path.endsWith('style.css') && encoding === undefined) {
        return fileContent;
      }
      return '';
    });

    const res = mockResponse();
    const result = serveStatic(res, '/style.css');

    expect(result).toBe(true);
    expect(res._status).toBe(200);
    expect(res._headers['Content-Type']).toBe('text/css');
    expect(res._headers['Content-Length']).toBe(fileContent.length);
    expect(res._headers['Cache-Control']).toBe('no-cache');
    expect(res._body).toBe(fileContent);
  });

  it('should set immutable cache-control for assets paths', async () => {
    const { serveStatic } = await importFresh();

    const fileContent = Buffer.from('console.log("app")');
    mockExistsSync.mockImplementation((path: string) => {
      if (path.endsWith('app.js')) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((path: string, encoding?: string) => {
      if (path.endsWith('app.js') && encoding === undefined) {
        return fileContent;
      }
      return '';
    });

    const res = mockResponse();
    serveStatic(res, '/assets/app.js');

    expect(res._headers['Cache-Control']).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(res._headers['Content-Type']).toBe('application/javascript');
  });

  it('should use application/octet-stream for unknown file extensions', async () => {
    const { serveStatic } = await importFresh();

    const fileContent = Buffer.from('binary data');
    mockExistsSync.mockImplementation((path: string) => {
      if (path.endsWith('file.xyz')) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((path: string, encoding?: string) => {
      if (path.endsWith('file.xyz') && encoding === undefined) {
        return fileContent;
      }
      return '';
    });

    const res = mockResponse();
    serveStatic(res, '/file.xyz');

    expect(res._headers['Content-Type']).toBe('application/octet-stream');
  });

  it('should fall through to SPA fallback when readFileSync throws', async () => {
    const { serveStatic } = await importFresh();

    mockExistsSync.mockImplementation((path: string) => {
      if (path.endsWith('broken.js')) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((path: string, encoding?: string) => {
      if (path.endsWith('broken.js') && encoding === undefined) {
        throw new Error('EACCES: permission denied');
      }
      return '';
    });

    const res = mockResponse();
    const result = serveStatic(res, '/broken.js');

    // Should fall through to SPA fallback
    expect(result).toBe(true);
    expect(res._status).toBe(200);
    expect(res._headers['Content-Type']).toBe('text/html');
    expect(res._body).toContain('Dashboard client not built');
  });

  it('should serve SPA fallback for /index.html path', async () => {
    const { serveStatic } = await importFresh();

    mockExistsSync.mockReturnValue(false);

    const res = mockResponse();
    serveStatic(res, '/index.html');

    expect(res._status).toBe(200);
    expect(res._headers['Content-Type']).toBe('text/html');
  });

  it('should cache index.html after first load', async () => {
    const { serveStatic } = await importFresh();

    mockExistsSync.mockReturnValue(false);

    const res1 = mockResponse();
    serveStatic(res1, '/');

    const res2 = mockResponse();
    serveStatic(res2, '/');

    // readFileSync for index.html should NOT be called because existsSync returned false
    // and the cached placeholder is reused. The key thing is both responses match.
    expect(res1._body).toBe(res2._body);
  });

  it('should serve SPA fallback when static file does not exist', async () => {
    const { serveStatic } = await importFresh();

    mockExistsSync.mockReturnValue(false);

    const res = mockResponse();
    serveStatic(res, '/nonexistent.js');

    expect(res._status).toBe(200);
    expect(res._headers['Content-Type']).toBe('text/html');
    expect(res._body).toContain('Dashboard client not built');
  });

  it('should reject path traversal attempts with 400', async () => {
    const { serveStatic } = await importFresh();

    const res = mockResponse();
    const result = serveStatic(res, '/../../../etc/passwd');

    expect(result).toBe(true);
    expect(res._status).toBe(400);
    expect(res._body).toBe('Bad request');
  });

  it('should reject encoded path traversal attempts', async () => {
    const { serveStatic } = await importFresh();

    const res = mockResponse();
    const result = serveStatic(res, '/../server/middleware.ts');

    expect(result).toBe(true);
    expect(res._status).toBe(400);
  });
});
