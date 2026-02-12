import { describe, it, expect } from 'vitest';
import { parseVaryHeader, captureVaryValues, varyMatches } from './vary.js';

describe('parseVaryHeader', () => {
  it('returns empty array for null', () => {
    expect(parseVaryHeader(null)).toEqual([]);
  });

  it('returns empty array for undefined', () => {
    expect(parseVaryHeader(undefined)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseVaryHeader('')).toEqual([]);
  });

  it('returns ["*"] for Vary: *', () => {
    expect(parseVaryHeader('*')).toEqual(['*']);
  });

  it('parses single header name', () => {
    expect(parseVaryHeader('Accept')).toEqual(['accept']);
  });

  it('parses multiple header names', () => {
    expect(parseVaryHeader('Accept, Accept-Encoding')).toEqual([
      'accept',
      'accept-encoding',
    ]);
  });

  it('handles extra whitespace', () => {
    expect(parseVaryHeader('  Accept ,  Accept-Encoding  ')).toEqual([
      'accept',
      'accept-encoding',
    ]);
  });

  it('filters empty parts', () => {
    expect(parseVaryHeader('Accept,,Accept-Encoding')).toEqual([
      'accept',
      'accept-encoding',
    ]);
  });
});

describe('captureVaryValues', () => {
  it('captures specified header values', () => {
    const values = captureVaryValues(['accept', 'accept-encoding'], {
      accept: 'application/json',
      'accept-encoding': 'gzip',
    });
    expect(values).toEqual({
      accept: 'application/json',
      'accept-encoding': 'gzip',
    });
  });

  it('captures undefined for missing headers', () => {
    const values = captureVaryValues(['accept'], {});
    expect(values).toEqual({ accept: undefined });
  });

  it('normalises field names to lowercase', () => {
    const values = captureVaryValues(['Accept'], {
      accept: 'text/html',
    });
    expect(values).toEqual({ accept: 'text/html' });
  });

  it('tries original case as fallback', () => {
    const values = captureVaryValues(['Accept'], {
      Accept: 'text/html',
    });
    expect(values).toEqual({ accept: 'text/html' });
  });
});

describe('varyMatches', () => {
  it('returns true when no Vary header', () => {
    expect(varyMatches(undefined, undefined, {})).toBe(true);
  });

  it('returns true for empty Vary header', () => {
    expect(varyMatches({}, '', {})).toBe(true);
  });

  it('returns true when Vary header produces no fields after parsing', () => {
    // Vary value with only commas/whitespace → parseVaryHeader returns []
    expect(varyMatches({}, ',', {})).toBe(true);
  });

  it('returns false for Vary: *', () => {
    expect(varyMatches({}, '*', {})).toBe(false);
  });

  it('returns false when Vary exists but no stored values', () => {
    expect(varyMatches(undefined, 'Accept', {})).toBe(false);
  });

  it('returns true when Vary values match', () => {
    expect(
      varyMatches({ accept: 'application/json' }, 'Accept', {
        accept: 'application/json',
      }),
    ).toBe(true);
  });

  it('returns false when Vary values differ', () => {
    expect(
      varyMatches({ accept: 'application/json' }, 'Accept', {
        accept: 'text/html',
      }),
    ).toBe(false);
  });

  it('handles multiple Vary fields', () => {
    expect(
      varyMatches(
        { accept: 'application/json', 'accept-encoding': 'gzip' },
        'Accept, Accept-Encoding',
        { accept: 'application/json', 'accept-encoding': 'gzip' },
      ),
    ).toBe(true);

    expect(
      varyMatches(
        { accept: 'application/json', 'accept-encoding': 'gzip' },
        'Accept, Accept-Encoding',
        { accept: 'application/json', 'accept-encoding': 'br' },
      ),
    ).toBe(false);
  });

  it('matches undefined values (both missing)', () => {
    expect(varyMatches({ accept: undefined }, 'Accept', {})).toBe(true);
  });

  it('does not match undefined vs present', () => {
    expect(
      varyMatches({ accept: undefined }, 'Accept', { accept: 'text/html' }),
    ).toBe(false);
  });

  it('requires lowercase keys in current request headers', () => {
    // parseVaryHeader lowercases field names, so current request
    // headers must also use lowercase keys for matching
    expect(
      varyMatches({ accept: 'application/json' }, 'Accept', {
        Accept: 'application/json',
      }),
    ).toBe(false);

    expect(
      varyMatches({ accept: 'application/json' }, 'Accept', {
        accept: 'application/json',
      }),
    ).toBe(true);
  });
});
