import nock from 'nock';
import { HttpClient } from './http-client.js';
import { HttpClientError } from '../errors/http-client-error.js';

const baseUrl = 'https://api.example.com';

describe('HttpClient', () => {
  let httpClient: HttpClient;
  beforeEach(() => {
    httpClient = new HttpClient();
  });

  test('should return a successful response', async () => {
    const mockResponse = { data: [1, 2, 3], status: 'ok' };
    nock(baseUrl).get('/items').reply(200, mockResponse);

    const result = await httpClient.get(`${baseUrl}/items`);

    expect(result).toStrictEqual(mockResponse);
  });

  test('should apply responseTransformer when provided', async () => {
    const mockResponse = { snake_case_key: 'value' };
    nock(baseUrl).get('/transform').reply(200, mockResponse);

    const client = new HttpClient({}, {
      responseTransformer: (data: unknown) => {
        const obj = data as Record<string, unknown>;
        return { camelCaseKey: obj['snake_case_key'] };
      },
    });

    const result = await client.get<{ camelCaseKey: string }>(`${baseUrl}/transform`);
    expect(result.camelCaseKey).toBe('value');
  });

  test('should apply responseHandler when provided', async () => {
    const mockResponse = { error_code: 404, message: 'Not found' };
    nock(baseUrl).get('/handled').reply(200, mockResponse);

    const client = new HttpClient({}, {
      responseHandler: (data: unknown) => {
        const obj = data as Record<string, unknown>;
        if (obj['error_code'] === 404) {
          throw new HttpClientError('Resource not found', 404);
        }
        return data;
      },
    });

    await expect(client.get(`${baseUrl}/handled`)).rejects.toThrow(HttpClientError);
  });

  test('should use custom errorHandler when provided', async () => {
    nock(baseUrl).get('/error').reply(500, { message: 'Server error' });

    class CustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'CustomError';
      }
    }

    const client = new HttpClient({}, {
      errorHandler: () => new CustomError('Custom error occurred'),
    });

    await expect(client.get(`${baseUrl}/error`)).rejects.toThrow(CustomError);
  });

  test('should throw HttpClientError on HTTP errors by default', async () => {
    nock(baseUrl).get('/server-error').reply(500, { message: 'Internal error' });

    await expect(
      httpClient.get(`${baseUrl}/server-error`),
    ).rejects.toThrow(HttpClientError);
  });

  test('should throw HttpClientError with status code on HTTP errors', async () => {
    nock(baseUrl).get('/not-found').reply(404);

    try {
      await httpClient.get(`${baseUrl}/not-found`);
      expect.unreachable('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpClientError);
      expect((error as HttpClientError).statusCode).toBe(404);
    }
  });

  test('should throw HttpClientError when request fails with no response', async () => {
    nock(baseUrl).get('/failed-request').replyWithError('Complete failure');

    await expect(
      httpClient.get(`${baseUrl}/failed-request`),
    ).rejects.toThrow(HttpClientError);
  });

  test('should abort rate-limit wait when signal is aborted', async () => {
    const rateLimitStoreStub = {
      async canProceed() {
        return false;
      },
      async record() {},
      async getStatus() {
        return { remaining: 0, resetTime: new Date(), limit: 60 };
      },
      async reset() {},
      async getWaitTime() {
        return 1_000;
      },
    } as const;

    const client = new HttpClient(
      { rateLimit: rateLimitStoreStub },
      {
        throwOnRateLimit: false,
        maxWaitTime: 5_000,
      },
    );

    const controller = new AbortController();
    controller.abort();

    await expect(
      client.get(`${baseUrl}/items`, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
