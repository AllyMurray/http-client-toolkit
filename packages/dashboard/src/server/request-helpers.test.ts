import type { IncomingMessage } from 'http';
import { PassThrough } from 'stream';
import { describe, it, expect } from 'vitest';
import { parseUrl, extractParam, readJsonBody } from './request-helpers.js';

function mockReq(url: string): IncomingMessage {
  return { url } as IncomingMessage;
}

describe('parseUrl', () => {
  it('should parse a simple URL', () => {
    const { pathname, query } = parseUrl(mockReq('/api/health'), '/');
    expect(pathname).toBe('/api/health');
    expect(query.toString()).toBe('');
  });

  it('should parse query parameters', () => {
    const { pathname, query } = parseUrl(
      mockReq('/api/cache/entries?page=1&limit=10'),
      '/',
    );
    expect(pathname).toBe('/api/cache/entries');
    expect(query.get('page')).toBe('1');
    expect(query.get('limit')).toBe('10');
  });

  it('should strip basePath prefix', () => {
    const { pathname } = parseUrl(
      mockReq('/dashboard/api/health'),
      '/dashboard',
    );
    expect(pathname).toBe('/api/health');
  });

  it('should return root when pathname equals basePath exactly', () => {
    const { pathname } = parseUrl(mockReq('/dashboard'), '/dashboard');
    expect(pathname).toBe('/');
  });

  it('should handle missing url', () => {
    const { pathname } = parseUrl({ url: undefined } as IncomingMessage, '/');
    expect(pathname).toBe('/');
  });

  it('should not strip basePath without a segment boundary', () => {
    const { pathname } = parseUrl(
      mockReq('/dashboard../server.js'),
      '/dashboard',
    );
    expect(pathname).toBe('/dashboard../server.js');
  });

  it('should strip basePath when followed by a slash', () => {
    const { pathname } = parseUrl(
      mockReq('/dashboard/api/health'),
      '/dashboard',
    );
    expect(pathname).toBe('/api/health');
  });

  it('should strip basePath when pathname equals basePath exactly', () => {
    const { pathname } = parseUrl(mockReq('/dashboard'), '/dashboard');
    expect(pathname).toBe('/');
  });

  it('should not strip basePath that is a prefix of a different segment', () => {
    const { pathname } = parseUrl(
      mockReq('/dashboard-admin/settings'),
      '/dashboard',
    );
    expect(pathname).toBe('/dashboard-admin/settings');
  });
});

describe('extractParam', () => {
  it('should extract a parameter from a matching path', () => {
    const hash = extractParam(
      '/api/cache/entries/abc123',
      '/api/cache/entries/:hash',
    );
    expect(hash).toBe('abc123');
  });

  it('should return undefined for non-matching paths with different length', () => {
    const result = extractParam('/api/cache/stats', '/api/cache/entries/:hash');
    expect(result).toBeUndefined();
  });

  it('should return undefined when a literal segment does not match', () => {
    const result = extractParam(
      '/api/other/entries/abc123',
      '/api/cache/entries/:hash',
    );
    expect(result).toBeUndefined();
  });

  it('should return undefined when lengths differ', () => {
    const result = extractParam('/api/cache', '/api/cache/entries/:hash');
    expect(result).toBeUndefined();
  });

  it('should extract from rate limit patterns', () => {
    const name = extractParam(
      '/api/rate-limit/resources/my-api/config',
      '/api/rate-limit/resources/:name/config',
    );
    expect(name).toBe('my-api');
  });

  it('should return undefined when pattern has no param placeholder', () => {
    const result = extractParam('/api/health', '/api/health');
    expect(result).toBeUndefined();
  });
});

function mockReqWithBody(body: string): IncomingMessage {
  const stream = new PassThrough();
  stream.end(body);
  return stream as unknown as IncomingMessage;
}

describe('readJsonBody', () => {
  it('should parse valid JSON body', async () => {
    const req = mockReqWithBody(JSON.stringify({ key: 'value', num: 42 }));
    const result = await readJsonBody<{ key: string; num: number }>(req);
    expect(result).toEqual({ key: 'value', num: 42 });
  });

  it('should reject with error for invalid JSON body', async () => {
    const req = mockReqWithBody('not valid json {{{');
    await expect(readJsonBody(req)).rejects.toThrow('Invalid JSON body');
  });

  it('should reject when the stream emits an error', async () => {
    const stream = new PassThrough();
    const req = stream as unknown as IncomingMessage;
    const promise = readJsonBody(req);
    stream.destroy(new Error('stream failure'));
    await expect(promise).rejects.toThrow('stream failure');
  });

  it('should reject when body exceeds 1MB size limit', async () => {
    const stream = new PassThrough();
    const req = stream as unknown as IncomingMessage;
    const promise = readJsonBody(req);

    // Write chunks totaling over 1MB
    const chunk = Buffer.alloc(512 * 1024, 'a');
    stream.write(chunk);
    stream.write(chunk);
    stream.write(chunk); // 1.5MB total

    await expect(promise).rejects.toThrow('Request body too large');
  });
});
