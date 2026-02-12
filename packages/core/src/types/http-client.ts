import { RequestPriority } from '../stores/rate-limit-store.js';

export interface HttpClientContract {
  /**
   * Perform a GET request.
   *
   * @param url     Full request URL
   * @param options Optional configuration – primarily an AbortSignal so
   *                callers can cancel long-running or rate-limited waits.
   */
  get<Result>(
    url: string,
    options?: {
      /**
       * AbortSignal that allows the caller to cancel the request, including any
       * internal rate-limit wait. If the signal is aborted while waiting the
       * promise rejects with an `AbortError`-like `Error` instance.
       */
      signal?: AbortSignal;
      /**
       * Priority level for the request (affects rate limiting behavior)
       */
      priority?: RequestPriority;
      /**
       * Custom headers to send with the request. Also used for Vary-based
       * cache matching — the client captures header values listed in the
       * response's Vary header and checks them on subsequent lookups.
       */
      headers?: Record<string, string>;
    },
  ): Promise<Result>;
}
