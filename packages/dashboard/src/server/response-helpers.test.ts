import type { ServerResponse } from 'http';
import { describe, it, expect, vi } from 'vitest';
import {
  sendJson,
  sendError,
  sendNotFound,
  sendMethodNotAllowed,
  sendForbidden,
} from './response-helpers.js';

function mockRes() {
  const headers: Record<string, string | number> = {};
  let statusCode = 200;
  let body = '';

  return {
    writeHead: vi.fn(
      (status: number, hdrs: Record<string, string | number>) => {
        statusCode = status;
        Object.assign(headers, hdrs);
      },
    ),
    end: vi.fn((data: string) => {
      body = data;
    }),
    getStatus: () => statusCode,
    getBody: () => body,
    getHeaders: () => headers,
  } as unknown as ServerResponse & {
    getStatus(): number;
    getBody(): string;
    getHeaders(): Record<string, string | number>;
  };
}

describe('sendJson', () => {
  it('should send JSON with default 200 status', () => {
    const res = mockRes();
    sendJson(res, { hello: 'world' });
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        'Content-Type': 'application/json',
      }),
    );
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ hello: 'world' }));
  });

  it('should send JSON with custom status', () => {
    const res = mockRes();
    sendJson(res, { error: 'bad' }, 400);
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
  });
});

describe('sendError', () => {
  it('should send error with 500 by default', () => {
    const res = mockRes();
    sendError(res, 'Something broke');
    expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({ error: 'Something broke' }),
    );
  });
});

describe('sendNotFound', () => {
  it('should send 404', () => {
    const res = mockRes();
    sendNotFound(res);
    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
  });
});

describe('sendMethodNotAllowed', () => {
  it('should send 405', () => {
    const res = mockRes();
    sendMethodNotAllowed(res);
    expect(res.writeHead).toHaveBeenCalledWith(405, expect.any(Object));
  });
});

describe('sendForbidden', () => {
  it('should send 403', () => {
    const res = mockRes();
    sendForbidden(res);
    expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({ error: 'Dashboard is in readonly mode' }),
    );
  });
});
