export interface HttpClientErrorOptions {
  /** Parsed response body, if available. */
  data?: unknown;
  /** Response headers, if available. */
  headers?: Headers;
}

/**
 * Base error class for HTTP client errors.
 * Consumers can extend this for domain-specific error handling.
 */
export class HttpClientError extends Error {
  public readonly statusCode?: number;
  /** Parsed response body from the failed request. */
  public readonly data?: unknown;
  /** Response headers from the failed request. */
  public readonly headers?: Headers;

  constructor(
    message: string,
    statusCode?: number,
    options?: HttpClientErrorOptions,
  ) {
    super(message);
    this.name = 'HttpClientError';
    this.statusCode = statusCode;
    this.data = options?.data;
    this.headers = options?.headers;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
