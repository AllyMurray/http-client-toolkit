import type { IncomingMessage } from 'http';
import { describe, it, expect } from 'vitest';
import { parseUrl, extractParam } from './request-helpers.js';

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

  it('should handle missing url', () => {
    const { pathname } = parseUrl({ url: undefined } as IncomingMessage, '/');
    expect(pathname).toBe('/');
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

  it('should return undefined for non-matching paths', () => {
    const result = extractParam('/api/cache/stats', '/api/cache/entries/:hash');
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
});
