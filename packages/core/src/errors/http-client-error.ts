/**
 * Base error class for HTTP client errors.
 * Consumers can extend this for domain-specific error handling.
 */
export class HttpClientError extends Error {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'HttpClientError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
