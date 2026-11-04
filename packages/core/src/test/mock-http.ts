import { expect, spyOn } from 'bun:test';

type Fixture = {
  url: URL;
  query?: true | Record<string, string>;
  headers: Record<string, string>;
  count: number;
  delay: number;
  status?: number;
  body?: unknown;
  responseHeaders?: HeadersInit;
  error?: string;
};

let fixtures: Array<Fixture> = [];

// Keep the existing HTTP scenarios while intercepting Bun's native fetch.
// Every request must match its URL, query and conditional/authentication headers.
export function mockHttp(origin: string) {
  let fixture: Fixture;
  let count = 1;
  let delay = 0;
  const scope = {
    get(path: string) {
      fixture = { url: new URL(path, origin), headers: {}, count, delay };
      return scope;
    },
    query(query: Fixture['query']) {
      fixture.query = query;
      return scope;
    },
    matchHeader(name: string, value: string) {
      fixture.headers[name] = value;
      return scope;
    },
    times(value: number) {
      count = fixture.count = value;
      return scope;
    },
    delay(value: number) {
      delay = fixture.delay = value;
      return scope;
    },
    reply(status: number, body?: unknown, headers?: HeadersInit) {
      Object.assign(fixture, { status, body, responseHeaders: headers });
      fixtures.push(fixture);
      count = 1;
      delay = 0;
      return scope;
    },
    replyWithError(error: string) {
      fixture.error = error;
      fixtures.push(fixture);
      return scope;
    },
  };
  return scope;
}

mockHttp.reset = () => {
  fixtures = [];
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
    init?.signal?.throwIfAborted();
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers);
    const fixture = fixtures.find((candidate) => {
      if (
        candidate.count === 0 ||
        candidate.url.origin !== url.origin ||
        candidate.url.pathname !== url.pathname
      )
        return false;
      if (candidate.query !== true) {
        const expected = new URLSearchParams(
          candidate.query ?? candidate.url.search,
        );
        expected.sort();
        const actual = new URLSearchParams(url.search);
        actual.sort();
        if (actual.toString() !== expected.toString()) return false;
      }
      return Object.entries(candidate.headers).every(
        ([name, value]) => headers.get(name) === value,
      );
    });
    if (!fixture) throw new Error(`Unexpected HTTP request: ${url}`);
    expect(init?.method ?? 'GET').toBe('GET');
    fixture.count--;
    if (fixture.delay)
      await new Promise((resolve) => setTimeout(resolve, fixture.delay));
    if (fixture.error) throw new Error(fixture.error);
    const responseHeaders = new Headers(fixture.responseHeaders);
    let body: string | null = null;
    if (
      fixture.body !== undefined &&
      fixture.body !== '' &&
      fixture.status !== 204 &&
      fixture.status !== 304
    ) {
      body =
        typeof fixture.body === 'string'
          ? fixture.body
          : JSON.stringify(fixture.body);
      if (
        typeof fixture.body !== 'string' &&
        !responseHeaders.has('Content-Type')
      )
        responseHeaders.set('Content-Type', 'application/json');
    }
    return new Response(body, {
      status: fixture.status,
      headers: responseHeaders,
    });
  };
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(fetchMock, { preconnect: globalThis.fetch.preconnect }),
  );
};

mockHttp.verify = () => {
  expect(fixtures.filter((fixture) => fixture.count > 0)).toEqual([]);
};
