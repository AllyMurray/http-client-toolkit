import {
  parseCacheControl,
  createCacheEntry,
  refreshCacheEntry,
  isCacheEntry,
  getFreshnessStatus,
  calculateStoreTTL,
  parseVaryHeader,
  captureVaryValues,
  varyMatches,
  type CacheEntry,
} from '../cache/index.js';
import { HttpClientError } from '../errors/http-client-error.js';
import {
  CacheStore,
  DedupeStore,
  RateLimitStore,
  AdaptiveRateLimitStore,
  RequestPriority,
  hashRequest,
  type RateLimitConfig,
  type RateLimitConfigMap,
} from '../stores/index.js';
import {
  HttpClientContract,
  type CacheOverrideOptions,
  type HttpErrorContext,
  type HttpClientEvent,
  type RetryContext,
  type RetryOptions,
} from '../types/index.js';

const DEFAULT_RATE_LIMIT_HEADER_NAMES = {
  retryAfter: ['retry-after'],
  limit: ['ratelimit-limit', 'x-ratelimit-limit', 'rate-limit-limit'],
  remaining: [
    'ratelimit-remaining',
    'x-ratelimit-remaining',
    'rate-limit-remaining',
  ],
  reset: ['ratelimit-reset', 'x-ratelimit-reset', 'rate-limit-reset'],
  combined: ['ratelimit'],
} as const;

/**
 * Wait for a specified period while supporting cancellation via AbortSignal.
 *
 * If the signal is aborted before the timeout completes the promise rejects
 * with an `Error` whose name is set to `AbortError`, mimicking DOMException in
 * browser environments without depending on it. This allows callers to use a
 * single `AbortController` for both the rate-limit wait *and* the subsequent
 * HTTP request.
 */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
    }

    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }
  });
}

export interface HttpClientStores {
  cache?: CacheStore;
  dedupe?: DedupeStore;
  rateLimit?: RateLimitStore | AdaptiveRateLimitStore;
}

export interface HttpClientCacheOptions {
  /** Cache store instance for HTTP response caching. */
  store: CacheStore;
  /**
   * When `true`, cache keys are not prefixed with the client name.
   * By default (`false`), each client's cache entries are isolated
   * by prefixing keys with `name:`, preventing cross-client conflicts
   * when sharing a store and scoping `clearCache()` to this client.
   */
  globalScope?: boolean;
  /**
   * Cache TTL in seconds. Used when the response has no cache headers
   * (`Cache-Control`, `Expires`, `Last-Modified`). When headers are
   * present, the server-specified freshness takes precedence.
   */
  ttl?: number;
  /** Override specific cache header behaviors. */
  overrides?: CacheOverrideOptions;
}

export interface HttpClientRateLimitOptions {
  /** Rate limit store instance for request throttling. */
  store?: RateLimitStore | AdaptiveRateLimitStore;
  /** Whether to throw errors on rate limit violations. */
  throw?: boolean;
  /** Maximum time to wait for rate limit in milliseconds. */
  maxWaitTime?: number;
  /** Configure rate-limit response header names for standards and custom APIs. */
  headers?: {
    retryAfter?: Array<string>;
    limit?: Array<string>;
    remaining?: Array<string>;
    reset?: Array<string>;
    combined?: Array<string>;
  };
  /**
   * Extract a rate-limit resource key from a URL.
   * Defaults to returning the origin (e.g. "https://api.github.com").
   */
  /** @deprecated Prefer HttpClientOptions.resourceKeyResolver. */
  resourceExtractor?: (url: string) => string;
  /**
   * Per-resource rate limit configs.
   * Keys should match `HttpClientOptions.resourceKeyResolver` output, or
   * `resourceExtractor` output when using the legacy rate-limit option.
   */
  configs?: RateLimitConfigMap;
  /** Default rate limit config for resources not in configs. */
  defaultConfig?: RateLimitConfig;
}

export interface HttpClientOptions {
  /**
   * Name for this client instance. Used to identify the client
   * in logging, debugging, and the dashboard.
   */
  name: string;
  /** Cache configuration and store. */
  cache?: HttpClientCacheOptions;
  /** Deduplication store instance for in-flight request deduplication. */
  dedupe?: DedupeStore;
  /** Rate limiting configuration and optional store. */
  rateLimit?: HttpClientRateLimitOptions;
  /**
   * Resolve the logical rate-limit resource key for a URL.
   * Defaults to returning the URL origin (e.g. "https://api.github.com").
   */
  resourceKeyResolver?: (url: string) => string;
  /**
   * Custom fetch implementation. Defaults to `globalThis.fetch`.
   * Use this to intercept/transform at the fetch level — e.g., resolving
   * pre-signed URLs or following redirects before the response enters
   * the caching layer.
   */
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
  /**
   * Pre-request hook. Runs before every outbound request, allowing
   * modification of the request init (e.g., injecting auth headers,
   * adding tracing headers). Called with the URL and current RequestInit;
   * must return a (possibly modified) RequestInit.
   */
  requestInterceptor?: (
    url: string,
    init: RequestInit,
  ) => Promise<RequestInit> | RequestInit;
  /**
   * Post-response hook. Runs after receiving the raw Response but before
   * response body parsing, transformation, and caching. Use this for
   * logging, modifying headers, or replacing the Response entirely.
   * Distinct from `responseTransformer` which operates on parsed data.
   */
  responseInterceptor?: (
    response: Response,
    url: string,
  ) => Promise<Response> | Response;
  /**
   * Transforms parsed response data before caching and further processing.
   * Runs on every response (cache miss or revalidation). Use this for
   * structural mapping like converting snake_case keys to camelCase.
   */
  responseTransformer?: (data: unknown) => unknown;
  /**
   * Optional error handler to convert HTTP errors into domain-specific error types.
   * Only called for HTTP errors (non-2xx responses), not for network failures.
   * If not provided, a generic HttpClientError is thrown.
   */
  errorHandler?: (context: HttpErrorContext) => Error;
  /**
   * Post-transformation hook for validation or domain-level error detection.
   * Runs after `responseTransformer` on the final data. Throw to reject
   * responses that are technically 2xx but contain application-level errors
   * (e.g. `{ error_code: 404 }` inside a 200 response). The return value
   * replaces the response data.
   */
  responseHandler?: (data: unknown) => unknown;
  /**
   * Automatic retry configuration. Pass `false` to disable retries globally.
   * Pass an options object to enable retries with custom settings.
   */
  retry?: RetryOptions | false;
  /** Structured lifecycle events for metrics, logs, and tracing. */
  observability?: {
    onEvent?: (event: HttpClientEvent) => void | Promise<void>;
  };
}

interface RateLimitHeaderConfig {
  retryAfter: Array<string>;
  limit: Array<string>;
  remaining: Array<string>;
  reset: Array<string>;
  combined: Array<string>;
}

interface ParsedResponseBody {
  data: unknown;
}

interface RequestEventContext {
  requestId: string;
  url: string;
  method: string;
  resourceKey: string;
  cacheKey?: string;
  startedAt: number;
}

interface EventBaseFields {
  clientName: string;
  requestId: string;
  url: string;
  method: string;
  resourceKey: string;
  timestamp: number;
}

export {
  type CacheOverrideOptions,
  type HttpErrorContext,
  type HttpClientEvent,
  type RetryContext,
  type RetryOptions,
};

export class HttpClient implements HttpClientContract {
  public readonly name: string;
  public readonly stores: HttpClientStores;
  private serverCooldowns = new Map<string, number>();
  private pendingRevalidations: Array<Promise<void>> = [];
  private requestSequence = 0;
  private options: {
    cacheTTL: number;
    throwOnRateLimit: boolean;
    maxWaitTime: number;
    fetchFn?: HttpClientOptions['fetchFn'];
    requestInterceptor?: HttpClientOptions['requestInterceptor'];
    responseInterceptor?: HttpClientOptions['responseInterceptor'];
    responseTransformer?: HttpClientOptions['responseTransformer'];
    errorHandler?: HttpClientOptions['errorHandler'];
    responseHandler?: HttpClientOptions['responseHandler'];
    retry?: HttpClientOptions['retry'];
    cacheOverrides?: CacheOverrideOptions;
    cacheScope?: string;
    resourceKeyResolver?: (url: string) => string;
    resourceExtractor?: (url: string) => string;
    rateLimitConfigs?: RateLimitConfigMap;
    defaultRateLimitConfig?: RateLimitConfig;
    rateLimitHeaders: RateLimitHeaderConfig;
    observability?: HttpClientOptions['observability'];
  };

  constructor(options: HttpClientOptions) {
    this.name = options.name;
    this.stores = {
      cache: options.cache?.store,
      dedupe: options.dedupe,
      rateLimit: options.rateLimit?.store,
    };
    this.options = {
      fetchFn: options.fetchFn,
      requestInterceptor: options.requestInterceptor,
      responseInterceptor: options.responseInterceptor,
      cacheTTL: options.cache?.ttl ?? 3600,
      throwOnRateLimit: options.rateLimit?.throw ?? true,
      maxWaitTime: options.rateLimit?.maxWaitTime ?? 60000,
      responseTransformer: options.responseTransformer,
      errorHandler: options.errorHandler,
      responseHandler: options.responseHandler,
      retry: options.retry,
      cacheOverrides: options.cache?.overrides,
      cacheScope:
        options.cache && !options.cache.globalScope ? options.name : undefined,
      resourceKeyResolver: options.resourceKeyResolver,
      resourceExtractor: options.rateLimit?.resourceExtractor,
      rateLimitConfigs: options.rateLimit?.configs,
      defaultRateLimitConfig: options.rateLimit?.defaultConfig,
      rateLimitHeaders: this.normalizeRateLimitHeaders(
        options.rateLimit?.headers,
      ),
      observability: options.observability,
    };

    if (
      this.stores.rateLimit?.setResourceConfig &&
      options.rateLimit?.configs
    ) {
      for (const [resource, config] of options.rateLimit.configs) {
        this.stores.rateLimit.setResourceConfig(resource, config);
      }
    }

    if (
      this.stores.rateLimit?.setResourceConfig &&
      options.rateLimit?.defaultConfig
    ) {
      this.stores.rateLimit.setResourceConfig(
        '__default__',
        options.rateLimit.defaultConfig,
      );
    }
  }

  private nextRequestId(): string {
    this.requestSequence += 1;
    return `${this.name}-${this.requestSequence}`;
  }

  private eventBase(context: RequestEventContext): EventBaseFields {
    return {
      clientName: this.name,
      requestId: context.requestId,
      url: context.url,
      method: context.method,
      resourceKey: context.resourceKey,
      timestamp: Date.now(),
    };
  }

  private emitEvent(event: HttpClientEvent): void {
    const onEvent = this.options.observability?.onEvent;
    if (!onEvent) {
      return;
    }

    try {
      const result = onEvent(event);
      if (result && typeof result.then === 'function') {
        void result.catch(() => {});
      }
    } catch {
      // Observability callbacks must never affect request behavior.
    }
  }

  private toError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }
    return new Error(String(error));
  }

  private statusFromError(error: unknown): number | undefined {
    if (this.isHttpErrorContext(error)) {
      return error.response.status;
    }
    if (error instanceof HttpClientError) {
      return error.statusCode;
    }
    return undefined;
  }

  private emitRequestSuccess(
    context: RequestEventContext,
    status?: number,
  ): void {
    this.emitEvent({
      ...this.eventBase(context),
      type: 'request:success',
      durationMs: Date.now() - context.startedAt,
      cacheKey: context.cacheKey,
      status,
    });
  }

  private emitRequestError(
    context: RequestEventContext,
    error: Error,
    status?: number,
  ): void {
    this.emitEvent({
      ...this.eventBase(context),
      type: 'request:error',
      durationMs: Date.now() - context.startedAt,
      cacheKey: context.cacheKey,
      status,
      error,
    });
  }

  private normalizeRateLimitHeaders(
    customHeaders?: HttpClientRateLimitOptions['headers'],
  ): RateLimitHeaderConfig {
    return {
      retryAfter: this.normalizeHeaderNames(
        customHeaders?.retryAfter,
        DEFAULT_RATE_LIMIT_HEADER_NAMES.retryAfter,
      ),
      limit: this.normalizeHeaderNames(
        customHeaders?.limit,
        DEFAULT_RATE_LIMIT_HEADER_NAMES.limit,
      ),
      remaining: this.normalizeHeaderNames(
        customHeaders?.remaining,
        DEFAULT_RATE_LIMIT_HEADER_NAMES.remaining,
      ),
      reset: this.normalizeHeaderNames(
        customHeaders?.reset,
        DEFAULT_RATE_LIMIT_HEADER_NAMES.reset,
      ),
      combined: this.normalizeHeaderNames(
        customHeaders?.combined,
        DEFAULT_RATE_LIMIT_HEADER_NAMES.combined,
      ),
    };
  }

  private normalizeHeaderNames(
    providedNames: Array<string> | undefined,
    defaultNames: ReadonlyArray<string>,
  ): Array<string> {
    if (!providedNames || providedNames.length === 0) {
      return [...defaultNames];
    }

    const customNames = providedNames
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean);

    if (customNames.length === 0) {
      return [...defaultNames];
    }

    return [...new Set([...customNames, ...defaultNames])];
  }

  /**
   * Derive the rate-limit key for a URL.
   * Uses `resourceKeyResolver` when provided, then the legacy
   * `rateLimit.resourceExtractor`, otherwise defaults to the URL origin.
   */
  private resolveRateLimitKey(url: string): string {
    if (this.options.resourceKeyResolver) {
      return this.options.resourceKeyResolver(url);
    }

    if (this.options.resourceExtractor) {
      return this.options.resourceExtractor(url);
    }

    try {
      return new URL(url).origin;
    } catch {
      return 'unknown';
    }
  }

  /**
   * Prefix a cache hash with the cache scope when configured.
   */
  private scopeKey(hash: string): string {
    return this.options.cacheScope
      ? `${this.options.cacheScope}:${hash}`
      : hash;
  }

  /**
   * Prefix a tag with the cache scope when configured.
   */
  private scopeTag(tag: string): string {
    return this.options.cacheScope ? `${this.options.cacheScope}:${tag}` : tag;
  }

  /**
   * Prefix multiple tags with the cache scope when configured.
   */
  private scopeTags(tags: Array<string>): Array<string> {
    return this.options.cacheScope
      ? tags.map((tag) => `${this.options.cacheScope}:${tag}`)
      : tags;
  }

  /**
   * Write a cache entry, associating tags when provided.
   */
  private async cacheSet(
    hash: string,
    value: unknown,
    ttl: number,
    tags?: Array<string>,
  ): Promise<void> {
    /* v8 ignore next -- callers always gate on this.stores.cache */
    if (!this.stores.cache) return;
    if (tags && tags.length > 0) {
      await this.stores.cache.setWithTags(
        hash,
        value,
        ttl,
        this.scopeTags(tags),
      );
    } else {
      await this.stores.cache.set(hash, value, ttl);
    }
  }

  /**
   * Extract endpoint and params from URL for request hashing
   * @param url The full URL
   * @returns Object with endpoint and params for hashing
   */
  private parseUrlForHashing(url: string): {
    endpoint: string;
    params: Record<string, unknown>;
  } {
    const urlObj = new URL(url);
    const endpoint = `${urlObj.origin}${urlObj.pathname}`;
    const params: Record<string, unknown> = {};

    urlObj.searchParams.forEach((value, key) => {
      const existing = params[key];

      // Keep repeated query keys as arrays so semantically distinct URLs like
      // `?tag=a&tag=b` and `?tag=b` do not hash to the same cache/dedupe key.
      if (existing === undefined) {
        params[key] = value;
        return;
      }

      if (Array.isArray(existing)) {
        existing.push(value);
        return;
      }

      params[key] = [existing, value];
    });

    return { endpoint, params };
  }

  private getHeaderValue(
    headers: Headers | Record<string, unknown> | undefined,
    names: Array<string>,
  ): string | undefined {
    if (!headers) {
      return undefined;
    }

    if (headers instanceof Headers) {
      for (const rawName of names) {
        const value = headers.get(rawName);
        if (value !== null) {
          return value;
        }
      }
      return undefined;
    }

    for (const rawName of names) {
      const name = rawName.toLowerCase();
      const value = headers[name] ?? headers[rawName];

      if (typeof value === 'string') {
        return value;
      }

      if (Array.isArray(value) && value.length > 0) {
        const first = value.find((entry) => typeof entry === 'string');
        if (typeof first === 'string') {
          return first;
        }
      }
    }

    return undefined;
  }

  private parseIntegerHeader(value: string | undefined): number | undefined {
    if (!value) {
      return undefined;
    }

    const parsed = Number.parseInt(value.trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return undefined;
    }

    return parsed;
  }

  private parseRetryAfterMs(value: string | undefined): number | undefined {
    if (!value) {
      return undefined;
    }

    const numeric = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(numeric) && numeric >= 0) {
      return numeric * 1000;
    }

    const dateMs = Date.parse(value);
    if (!Number.isFinite(dateMs)) {
      return undefined;
    }

    return Math.max(0, dateMs - Date.now());
  }

  private parseResetMs(value: string | undefined): number | undefined {
    const parsed = this.parseIntegerHeader(value);
    if (parsed === undefined) {
      return undefined;
    }

    if (parsed === 0) {
      return 0;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);

    if (parsed > nowSeconds + 1) {
      return Math.max(0, (parsed - nowSeconds) * 1000);
    }

    return parsed * 1000;
  }

  private parseCombinedRateLimitHeader(value: string | undefined): {
    remaining?: number;
    resetMs?: number;
  } {
    if (!value) {
      return {};
    }

    const remainingMatch = value.match(/(?:^|[;,])\s*r\s*=\s*(\d+)/i);
    const resetMatch = value.match(/(?:^|[;,])\s*t\s*=\s*(\d+)/i);

    return {
      remaining: remainingMatch
        ? this.parseIntegerHeader(remainingMatch[1])
        : undefined,
      resetMs: resetMatch ? this.parseResetMs(resetMatch[1]) : undefined,
    };
  }

  private applyServerRateLimitHints(
    url: string,
    headers: Headers | Record<string, unknown> | undefined,
    statusCode?: number,
    eventContext?: RequestEventContext,
    attempt?: number,
  ): void {
    if (!headers) {
      return;
    }

    const config = this.options.rateLimitHeaders;
    const retryAfterRaw = this.getHeaderValue(headers, config.retryAfter);
    const resetRaw = this.getHeaderValue(headers, config.reset);
    const remainingRaw = this.getHeaderValue(headers, config.remaining);
    const combinedRaw = this.getHeaderValue(headers, config.combined);

    const retryAfterMs = this.parseRetryAfterMs(retryAfterRaw);
    const resetMs = this.parseResetMs(resetRaw);
    const remaining = this.parseIntegerHeader(remainingRaw);
    const combined = this.parseCombinedRateLimitHeader(combinedRaw);

    const effectiveRemaining = remaining ?? combined.remaining;
    const effectiveResetMs = resetMs ?? combined.resetMs;
    const hasRateLimitErrorStatus = statusCode === 429 || statusCode === 503;

    let waitMs: number | undefined;

    if (retryAfterMs !== undefined) {
      waitMs = retryAfterMs;
    } else if (
      effectiveResetMs !== undefined &&
      (hasRateLimitErrorStatus ||
        (effectiveRemaining !== undefined && effectiveRemaining <= 0))
    ) {
      waitMs = effectiveResetMs;
    }

    if (waitMs === undefined || waitMs <= 0) {
      return;
    }

    const scope = this.resolveRateLimitKey(url);
    const cooldownUntilMs = Date.now() + waitMs;

    if (this.stores.rateLimit?.setCooldown) {
      void this.stores.rateLimit.setCooldown(scope, cooldownUntilMs);
    } else {
      this.serverCooldowns.set(scope, cooldownUntilMs);
    }

    if (eventContext) {
      this.emitEvent({
        ...this.eventBase(eventContext),
        type: 'serverCooldown:set',
        resourceKey: scope,
        waitMs,
        status: statusCode,
        attempt,
      });
    }
  }

  private async readCooldown(scope: string): Promise<number | undefined> {
    if (this.stores.rateLimit?.getCooldown) {
      return this.stores.rateLimit.getCooldown(scope);
    }
    return this.serverCooldowns.get(scope);
  }

  private async removeCooldown(scope: string): Promise<void> {
    if (this.stores.rateLimit?.clearCooldown) {
      await this.stores.rateLimit.clearCooldown(scope);
    } else {
      this.serverCooldowns.delete(scope);
    }
  }

  private async enforceServerCooldown(
    url: string,
    signal?: AbortSignal,
    forceWait = false,
    eventContext?: RequestEventContext,
  ): Promise<void> {
    const scope = this.resolveRateLimitKey(url);
    const startedAt = Date.now();

    // Re-check cooldown after each sleep so we never proceed while a server
    // cooldown is still active. This avoids bypassing limits when cooldown
    // duration is longer than maxWaitTime.
    while (true) {
      const cooldownUntil = await this.readCooldown(scope);
      if (!cooldownUntil) {
        return;
      }

      const waitMs = cooldownUntil - Date.now();
      if (waitMs <= 0) {
        await this.removeCooldown(scope);
        return;
      }

      if (this.options.throwOnRateLimit && !forceWait) {
        const error = new Error(
          `Rate limit exceeded for resource '${scope}'. Wait ${waitMs}ms before retrying.`,
        );
        if (eventContext) {
          this.emitEvent({
            ...this.eventBase(eventContext),
            type: 'rateLimit:throw',
            resourceKey: scope,
            source: 'serverCooldown',
            waitMs,
            error,
          });
        }
        throw error;
      }

      const elapsedMs = Date.now() - startedAt;
      const remainingWaitBudgetMs = this.options.maxWaitTime - elapsedMs;

      if (remainingWaitBudgetMs <= 0) {
        const error = new Error(
          `Rate limit wait exceeded maxWaitTime (${this.options.maxWaitTime}ms) for resource '${scope}'.`,
        );
        if (eventContext) {
          this.emitEvent({
            ...this.eventBase(eventContext),
            type: 'rateLimit:throw',
            resourceKey: scope,
            source: 'serverCooldown',
            waitMs,
            error,
          });
        }
        throw error;
      }

      const waitDurationMs = Math.min(waitMs, remainingWaitBudgetMs);
      if (eventContext) {
        this.emitEvent({
          ...this.eventBase(eventContext),
          type: 'rateLimit:wait',
          resourceKey: scope,
          source: 'serverCooldown',
          waitMs: waitDurationMs,
        });
      }
      await wait(waitDurationMs, signal);
    }
  }

  private async enforceStoreRateLimit(
    resource: string,
    priority: RequestPriority,
    signal?: AbortSignal,
    eventContext?: RequestEventContext,
  ): Promise<boolean> {
    const rateLimit = this.stores.rateLimit as AdaptiveRateLimitStore;
    const startedAt = Date.now();
    const hasAtomicAcquire = typeof rateLimit.acquire === 'function';

    const canProceedNow = async (): Promise<boolean> => {
      if (hasAtomicAcquire) {
        return rateLimit.acquire!(resource, priority);
      }
      return rateLimit.canProceed(resource, priority);
    };

    if (this.options.throwOnRateLimit) {
      const canProceed = await canProceedNow();
      if (!canProceed) {
        const waitTime = await rateLimit.getWaitTime(resource, priority);
        const error = new Error(
          `Rate limit exceeded for resource '${resource}'. Wait ${waitTime}ms before retrying.`,
        );
        if (eventContext) {
          this.emitEvent({
            ...this.eventBase(eventContext),
            type: 'rateLimit:throw',
            resourceKey: resource,
            source: 'store',
            waitMs: waitTime,
            error,
          });
        }
        throw error;
      }
      return hasAtomicAcquire;
    }

    // Keep polling + waiting until the store explicitly allows the request or
    // we exhaust maxWaitTime. A single one-off sleep can otherwise let a request
    // through while still over limit.
    while (!(await canProceedNow())) {
      const suggestedWaitMs = await rateLimit.getWaitTime(resource, priority);
      const elapsedMs = Date.now() - startedAt;
      const remainingWaitBudgetMs = this.options.maxWaitTime - elapsedMs;

      if (remainingWaitBudgetMs <= 0) {
        const error = new Error(
          `Rate limit wait exceeded maxWaitTime (${this.options.maxWaitTime}ms) for resource '${resource}'.`,
        );
        if (eventContext) {
          this.emitEvent({
            ...this.eventBase(eventContext),
            type: 'rateLimit:throw',
            resourceKey: resource,
            source: 'store',
            waitMs: suggestedWaitMs,
            error,
          });
        }
        throw error;
      }

      // If a store reports "blocked" but no wait time, use a tiny backoff to
      // avoid a tight CPU loop while still converging quickly.
      const waitTime =
        suggestedWaitMs > 0
          ? Math.min(suggestedWaitMs, remainingWaitBudgetMs)
          : Math.min(25, remainingWaitBudgetMs);

      if (eventContext) {
        this.emitEvent({
          ...this.eventBase(eventContext),
          type: 'rateLimit:wait',
          resourceKey: resource,
          source: 'store',
          waitMs: waitTime,
        });
      }
      await wait(waitTime, signal);
    }

    return hasAtomicAcquire;
  }

  /**
   * Wait for all pending background revalidations to complete.
   * Primarily useful in tests to avoid dangling promises.
   */
  async flushRevalidations(): Promise<void> {
    await Promise.allSettled(this.pendingRevalidations);
    this.pendingRevalidations = [];
  }

  private async backgroundRevalidate(
    url: string,
    hash: string,
    entry: CacheEntry<unknown>,
    eventContext: RequestEventContext,
    requestHeaders?: Record<string, string>,
    cacheConfig?: {
      cacheTTL: number;
      cacheOverrides?: CacheOverrideOptions;
    },
    tags?: Array<string>,
  ): Promise<void> {
    const fetchHeaders = new Headers(requestHeaders);
    if (entry.metadata.etag) {
      fetchHeaders.set('If-None-Match', entry.metadata.etag);
    }
    if (entry.metadata.lastModified) {
      fetchHeaders.set('If-Modified-Since', entry.metadata.lastModified);
    }

    const revalidationStartedAt = Date.now();

    try {
      let revalInit: RequestInit = { headers: fetchHeaders };
      if (this.options.requestInterceptor) {
        revalInit = await this.options.requestInterceptor(url, revalInit);
      }

      const revalFetchFn = this.options.fetchFn ?? globalThis.fetch;
      let response = await revalFetchFn(url, revalInit);

      if (this.options.responseInterceptor) {
        response = await this.options.responseInterceptor(response, url);
      }

      this.applyServerRateLimitHints(
        url,
        response.headers,
        response.status,
        eventContext,
        1,
      );

      /* v8 ignore next -- cacheConfig is always provided by resolveCacheConfig() */
      const resolvedTTL = cacheConfig?.cacheTTL ?? this.options.cacheTTL;
      const resolvedOverrides =
        cacheConfig?.cacheOverrides ?? this.options.cacheOverrides;

      if (response.status === 304) {
        const refreshed = refreshCacheEntry(entry, response.headers);
        const ttl = this.clampTTL(
          calculateStoreTTL(refreshed.metadata, resolvedTTL),
          resolvedOverrides,
        );
        await this.cacheSet(hash, refreshed, ttl, tags);
        this.emitEvent({
          ...this.eventBase(eventContext),
          type: 'cache:revalidate',
          cacheKey: hash,
          phase: 'notModified',
          status: response.status,
          durationMs: Date.now() - revalidationStartedAt,
        });
        return;
      }

      if (response.ok) {
        const parsedBody = await this.parseResponseBody(response);
        let data: unknown = parsedBody.data;
        if (this.options.responseTransformer && data) {
          data = this.options.responseTransformer(data);
        }
        if (this.options.responseHandler) {
          data = this.options.responseHandler(data);
        }
        const newEntry = createCacheEntry(
          data,
          response.headers,
          response.status,
        );
        if (newEntry.metadata.varyHeaders && requestHeaders) {
          const varyFields = parseVaryHeader(newEntry.metadata.varyHeaders);
          newEntry.metadata.varyValues = captureVaryValues(
            varyFields,
            requestHeaders,
          );
        }
        const ttl = this.clampTTL(
          calculateStoreTTL(newEntry.metadata, resolvedTTL),
          resolvedOverrides,
        );
        await this.cacheSet(hash, newEntry, ttl, tags);
        this.emitEvent({
          ...this.eventBase(eventContext),
          type: 'cache:revalidate',
          cacheKey: hash,
          phase: 'success',
          status: response.status,
          durationMs: Date.now() - revalidationStartedAt,
        });
        return;
      }

      this.emitEvent({
        ...this.eventBase(eventContext),
        type: 'cache:revalidate',
        cacheKey: hash,
        phase: 'error',
        status: response.status,
        error: new Error(
          `Background revalidation failed with status ${response.status}`,
        ),
        durationMs: Date.now() - revalidationStartedAt,
      });
    } catch (error) {
      this.emitEvent({
        ...this.eventBase(eventContext),
        type: 'cache:revalidate',
        cacheKey: hash,
        phase: 'error',
        error: this.toError(error),
        durationMs: Date.now() - revalidationStartedAt,
      });
      // Background revalidation failures are silently ignored.
      // The stale entry remains in the cache and will be served until
      // it falls out of the stale-while-revalidate window.
    }
  }

  private clampTTL(ttl: number, overrides?: CacheOverrideOptions): number {
    if (!overrides) return ttl;
    let clamped = ttl;
    if (overrides.minimumTTL !== undefined) {
      clamped = Math.max(clamped, overrides.minimumTTL);
    }
    if (overrides.maximumTTL !== undefined) {
      clamped = Math.min(clamped, overrides.maximumTTL);
    }
    return clamped;
  }

  private resolveCacheConfig(
    perRequestTTL?: number,
    perRequestOverrides?: CacheOverrideOptions,
  ): { cacheTTL: number; cacheOverrides?: CacheOverrideOptions } {
    const cacheTTL = perRequestTTL ?? this.options.cacheTTL;

    if (!perRequestOverrides) {
      return { cacheTTL, cacheOverrides: this.options.cacheOverrides };
    }

    const base = this.options.cacheOverrides ?? {};
    return {
      cacheTTL,
      cacheOverrides: {
        ...base,
        ...perRequestOverrides,
      },
    };
  }

  private isServerErrorOrNetworkFailure(error: unknown): boolean {
    if (this.isHttpErrorContext(error)) {
      if (error.response.status >= 500) return true;
    }
    if (error instanceof TypeError) return true;
    return false;
  }

  private generateClientError(err: unknown): Error {
    // HTTP errors: the consumer classifies these
    if (this.isHttpErrorContext(err)) {
      if (this.options.errorHandler) {
        return this.options.errorHandler(err);
      }
      return this.defaultHttpError(err);
    }

    // Non-HTTP errors (network failures, unexpected throws): toolkit owns these
    if (err instanceof Error) {
      return new HttpClientError(err.message);
    }
    return new HttpClientError(String(err));
  }

  private isHttpErrorContext(err: unknown): err is HttpErrorContext {
    return (
      err != null &&
      typeof err === 'object' &&
      'url' in err &&
      'response' in err &&
      typeof (err as HttpErrorContext).response?.status === 'number'
    );
  }

  private defaultHttpError(ctx: HttpErrorContext): HttpClientError {
    const bodyMessage =
      typeof ctx.response.data === 'object' && ctx.response.data !== null
        ? (ctx.response.data as { message?: string }).message
        : undefined;
    const message = bodyMessage
      ? `${ctx.message}, ${bodyMessage}`
      : ctx.message;
    return new HttpClientError(message, ctx.response.status, {
      data: ctx.response.data,
      headers: ctx.response.headers,
    });
  }

  private static RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

  private resolveRetryConfig(
    perRequest?: RetryOptions | false,
  ):
    | (Required<
        Pick<RetryOptions, 'baseDelay' | 'jitter' | 'maxDelay' | 'maxRetries'>
      > &
        Pick<RetryOptions, 'onRetry' | 'retryCondition'>)
    | null {
    // Per-request `false` disables retries for this call
    if (perRequest === false) return null;
    // Constructor `false` disables retries globally
    if (this.options.retry === false) return null;

    const base = (
      typeof this.options.retry === 'object' ? this.options.retry : {}
    ) as RetryOptions;
    const override = (
      typeof perRequest === 'object' ? perRequest : {}
    ) as RetryOptions;

    // No retry config provided at all → retries disabled
    if (this.options.retry === undefined && perRequest === undefined)
      return null;

    return {
      baseDelay: override.baseDelay ?? base.baseDelay ?? 1000,
      jitter: override.jitter ?? base.jitter ?? 'full',
      maxDelay: override.maxDelay ?? base.maxDelay ?? 30000,
      maxRetries: override.maxRetries ?? base.maxRetries ?? 3,
      onRetry: override.onRetry ?? base.onRetry,
      retryCondition: override.retryCondition ?? base.retryCondition,
    };
  }

  private calculateRetryDelay(
    attempt: number,
    baseDelay: number,
    maxDelay: number,
    jitter: 'full' | 'none',
    retryAfterMs?: number,
  ): number {
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    const cappedDelay = Math.min(exponentialDelay, maxDelay);
    const jitteredDelay =
      jitter === 'full' ? Math.floor(Math.random() * cappedDelay) : cappedDelay;
    // Retry-After from server takes precedence when larger
    if (retryAfterMs !== undefined && retryAfterMs > jitteredDelay) {
      return retryAfterMs;
    }
    return jitteredDelay;
  }

  private createRetryContext(
    error: Error | HttpErrorContext,
    url: string,
  ): RetryContext {
    let statusCode: number | undefined;
    let retryAfterMs: number | undefined;

    if (this.isHttpErrorContext(error)) {
      statusCode = error.response.status;
      const retryAfterRaw = this.getHeaderValue(
        error.response.headers,
        this.options.rateLimitHeaders.retryAfter,
      );
      retryAfterMs = this.parseRetryAfterMs(retryAfterRaw);
    }

    return { error, retryAfterMs, statusCode, url };
  }

  private isDefaultRetryableRequest(
    error: Error | HttpErrorContext,
    statusCode?: number,
  ): boolean {
    if (statusCode !== undefined) {
      return HttpClient.RETRYABLE_STATUS_CODES.has(statusCode);
    }

    return error instanceof TypeError;
  }

  private emitRetryExhausted(
    error: Error | HttpErrorContext,
    retryConfig: NonNullable<ReturnType<HttpClient['resolveRetryConfig']>>,
    attempt: number,
    url: string,
    eventContext: RequestEventContext,
    hasScheduledRetry: boolean,
  ): void {
    const context = this.createRetryContext(error, url);
    const shouldEmit = retryConfig.retryCondition
      ? hasScheduledRetry
      : this.isDefaultRetryableRequest(error, context.statusCode);

    if (!shouldEmit) {
      return;
    }

    this.emitEvent({
      ...this.eventBase(eventContext),
      type: 'retry:exhausted',
      attempt,
      status: context.statusCode,
      error: context.error,
    });
  }

  private isRetryableRequest(
    error: Error | HttpErrorContext,
    retryConfig: NonNullable<ReturnType<HttpClient['resolveRetryConfig']>>,
    attempt: number,
    url: string,
  ): { shouldRetry: boolean; context: RetryContext } {
    const context = this.createRetryContext(error, url);

    // Custom condition overrides default logic
    if (retryConfig.retryCondition) {
      return {
        shouldRetry: retryConfig.retryCondition(context, attempt),
        context,
      };
    }

    return {
      shouldRetry: this.isDefaultRetryableRequest(error, context.statusCode),
      context,
    };
  }

  private async parseResponseBody(
    response: Response,
  ): Promise<ParsedResponseBody> {
    if (response.status === 204 || response.status === 205) {
      return { data: undefined };
    }

    const rawBody = await response.text();
    if (!rawBody) {
      return { data: undefined };
    }

    const contentType =
      response.headers.get('content-type')?.toLowerCase() ?? '';
    const shouldAttemptJsonParsing =
      contentType.includes('application/json') ||
      contentType.includes('+json') ||
      rawBody.trimStart().startsWith('{') ||
      rawBody.trimStart().startsWith('[');

    if (!shouldAttemptJsonParsing) {
      return { data: rawBody };
    }

    try {
      const parsed = JSON.parse(rawBody) as unknown;
      if (typeof parsed === 'object' && parsed !== null) {
        return { data: parsed };
      }

      return { data: parsed };
    } catch {
      return { data: rawBody };
    }
  }

  private async executeFetch(
    url: string,
    fetchHeaders: Headers,
    signal: AbortSignal | undefined,
    retryConfig: NonNullable<
      ReturnType<HttpClient['resolveRetryConfig']>
    > | null,
    staleEntry: CacheEntry<unknown> | undefined,
    eventContext: RequestEventContext,
  ): Promise<
    | { notModified: true; refreshedEntry: CacheEntry<unknown> }
    | { notModified: false; response: Response; parsedBody: ParsedResponseBody }
  > {
    const maxAttempts = retryConfig ? retryConfig.maxRetries + 1 : 1;
    let hasScheduledRetry = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Re-check server cooldown between retries — the previous attempt may
      // have set a cooldown via applyServerRateLimitHints. Always wait (never
      // throw) since the retry mechanism is handling recovery.
      if (attempt > 1) {
        await this.enforceServerCooldown(url, signal, true, eventContext);
      }

      try {
        let fetchInit: RequestInit = { signal };
        if ([...fetchHeaders].length > 0) {
          fetchInit.headers = new Headers(fetchHeaders);
        }

        // Re-run interceptor each attempt (auth tokens may refresh)
        if (this.options.requestInterceptor) {
          fetchInit = await this.options.requestInterceptor(url, fetchInit);
        }

        const fetchFn = this.options.fetchFn ?? globalThis.fetch;
        let response = await fetchFn(url, fetchInit);

        if (this.options.responseInterceptor) {
          response = await this.options.responseInterceptor(response, url);
        }
        this.applyServerRateLimitHints(
          url,
          response.headers,
          response.status,
          eventContext,
          attempt,
        );

        // Handle 304 Not Modified — must be checked BEFORE !response.ok
        if (response.status === 304 && staleEntry) {
          return {
            notModified: true,
            refreshedEntry: refreshCacheEntry(staleEntry, response.headers),
          };
        }

        const parsedBody = await this.parseResponseBody(response);

        if (!response.ok) {
          const httpError: HttpErrorContext = {
            message: `Request failed with status ${response.status}`,
            url,
            response: {
              status: response.status,
              data: parsedBody.data,
              headers: response.headers,
            },
          };

          // Check if we should retry this error
          if (retryConfig && attempt < maxAttempts) {
            const { shouldRetry, context } = this.isRetryableRequest(
              httpError,
              retryConfig,
              attempt,
              url,
            );
            if (shouldRetry) {
              const delay = this.calculateRetryDelay(
                attempt,
                retryConfig.baseDelay,
                retryConfig.maxDelay,
                retryConfig.jitter,
                context.retryAfterMs,
              );
              hasScheduledRetry = true;
              this.emitEvent({
                ...this.eventBase(eventContext),
                type: 'retry:scheduled',
                attempt,
                waitMs: delay,
                status: context.statusCode,
                error: context.error,
              });
              retryConfig.onRetry?.(context, attempt, delay);
              await wait(delay, signal);
              continue;
            }
          }

          if (retryConfig && attempt >= maxAttempts) {
            this.emitRetryExhausted(
              httpError,
              retryConfig,
              attempt,
              url,
              eventContext,
              hasScheduledRetry,
            );
          }

          throw httpError;
        }

        return { notModified: false, response, parsedBody };
      } catch (fetchError) {
        // AbortError always propagates immediately — no retry
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          throw fetchError;
        }

        // Network errors (TypeError) — may be retryable
        if (
          fetchError instanceof TypeError &&
          retryConfig &&
          attempt < maxAttempts
        ) {
          const { shouldRetry, context } = this.isRetryableRequest(
            fetchError,
            retryConfig,
            attempt,
            url,
          );
          if (shouldRetry) {
            const delay = this.calculateRetryDelay(
              attempt,
              retryConfig.baseDelay,
              retryConfig.maxDelay,
              retryConfig.jitter,
              context.retryAfterMs,
            );
            hasScheduledRetry = true;
            this.emitEvent({
              ...this.eventBase(eventContext),
              type: 'retry:scheduled',
              attempt,
              waitMs: delay,
              status: context.statusCode,
              error: context.error,
            });
            retryConfig.onRetry?.(context, attempt, delay);
            await wait(delay, signal);
            continue;
          }
        }

        if (
          fetchError instanceof TypeError &&
          retryConfig &&
          attempt >= maxAttempts
        ) {
          this.emitRetryExhausted(
            fetchError,
            retryConfig,
            attempt,
            url,
            eventContext,
            hasScheduledRetry,
          );
        }

        // HttpErrorContext thrown from the !response.ok branch above
        // or other non-retryable errors — propagate
        throw fetchError;
      }
      /* v8 ignore next */
    }

    /* v8 ignore next 2 -- unreachable: the loop always returns or throws */
    throw new Error('Unexpected end of retry loop');
  }

  /**
   * Clear this client's cached entries. By default only entries belonging to
   * this client are removed (keys prefixed with `name:`). When
   * `cache.globalScope` is `true` the entire cache is cleared.
   */
  async clearCache(): Promise<void> {
    if (!this.stores.cache) return;
    await this.stores.cache.clear(
      this.options.cacheScope ? `${this.options.cacheScope}:` : undefined,
    );
  }

  /**
   * Invalidate all cache entries associated with the given tag.
   * Tags are scoped to this client unless `cache.globalScope` is `true`.
   * @returns The number of cache entries that were deleted, or 0 if no cache store is configured.
   */
  async invalidateByTag(tag: string): Promise<number> {
    if (!this.stores.cache) return 0;
    return this.stores.cache.invalidateByTag(this.scopeTag(tag));
  }

  /**
   * Invalidate all cache entries associated with any of the given tags.
   * Tags are scoped to this client unless `cache.globalScope` is `true`.
   * @returns The number of cache entries that were deleted, or 0 if no cache store is configured.
   */
  async invalidateByTags(tags: Array<string>): Promise<number> {
    if (!this.stores.cache) return 0;
    return this.stores.cache.invalidateByTags(this.scopeTags(tags));
  }

  async get<Result>(
    url: string,
    options: {
      signal?: AbortSignal;
      priority?: RequestPriority;
      headers?: Record<string, string>;
      retry?: RetryOptions | false;
      cache?: {
        ttl?: number;
        overrides?: CacheOverrideOptions;
        tags?: Array<string>;
      };
    } = {},
  ): Promise<Result> {
    const { signal, priority = 'background', headers } = options;
    const { endpoint, params } = this.parseUrlForHashing(url);
    const rawHash = hashRequest(endpoint, params);
    const cacheHash = this.scopeKey(rawHash);
    const resource = this.resolveRateLimitKey(url);
    const cacheConfig = this.resolveCacheConfig(
      options.cache?.ttl,
      options.cache?.overrides,
    );
    const requestContext: RequestEventContext = {
      requestId: this.nextRequestId(),
      url,
      method: 'GET',
      resourceKey: resource,
      cacheKey: cacheHash,
      startedAt: Date.now(),
    };
    let cacheRevalidationStartedAt: number | undefined;

    const emitCacheRevalidationScheduled = (
      entry: CacheEntry<unknown>,
    ): void => {
      cacheRevalidationStartedAt = Date.now();
      this.emitEvent({
        ...this.eventBase(requestContext),
        type: 'cache:revalidate',
        cacheKey: cacheHash,
        phase: 'scheduled',
        status: entry.metadata.statusCode,
      });
    };

    const emitCacheRevalidationOutcome = (
      phase: 'success' | 'error' | 'notModified',
      details: {
        status?: number;
        error?: Error;
      } = {},
    ): void => {
      if (cacheRevalidationStartedAt === undefined) {
        return;
      }

      this.emitEvent({
        ...this.eventBase(requestContext),
        type: 'cache:revalidate',
        cacheKey: cacheHash,
        phase,
        status: details.status,
        error: details.error,
        durationMs: Date.now() - cacheRevalidationStartedAt,
      });
      cacheRevalidationStartedAt = undefined;
    };

    // Track stale entry for conditional requests and stale-if-error fallback
    let staleEntry: CacheEntry<unknown> | undefined;
    let staleCandidate: CacheEntry<unknown> | undefined;

    this.emitEvent({
      ...this.eventBase(requestContext),
      type: 'request:start',
    });

    try {
      await this.enforceServerCooldown(url, signal, false, requestContext);

      // 1. Cache — check for cached response
      if (this.stores.cache) {
        const cachedResult = await this.stores.cache.get(cacheHash);

        if (cachedResult === undefined) {
          this.emitEvent({
            ...this.eventBase(requestContext),
            type: 'cache:miss',
            cacheKey: cacheHash,
            cacheStatus: 'miss',
          });
        } else if (!isCacheEntry(cachedResult)) {
          this.emitEvent({
            ...this.eventBase(requestContext),
            type: 'cache:miss',
            cacheKey: cacheHash,
            cacheStatus: 'unusable',
          });
        } else {
          const entry = cachedResult as CacheEntry<unknown>;

          // Vary mismatch → treat as cache miss
          if (
            !varyMatches(
              entry.metadata.varyValues,
              entry.metadata.varyHeaders,
              headers ?? {},
            )
          ) {
            this.emitEvent({
              ...this.eventBase(requestContext),
              type: 'cache:miss',
              cacheKey: cacheHash,
              cacheStatus: 'vary-mismatch',
            });
            // fall through to fetch
          } else {
            const status = getFreshnessStatus(entry.metadata);

            switch (status) {
              case 'fresh':
                this.emitEvent({
                  ...this.eventBase(requestContext),
                  type: 'cache:hit',
                  cacheKey: cacheHash,
                  cacheStatus: 'fresh',
                  status: entry.metadata.statusCode,
                });
                this.emitRequestSuccess(
                  requestContext,
                  entry.metadata.statusCode,
                );
                return entry.value as Result;

              case 'no-cache':
                if (cacheConfig.cacheOverrides?.ignoreNoCache) {
                  this.emitEvent({
                    ...this.eventBase(requestContext),
                    type: 'cache:hit',
                    cacheKey: cacheHash,
                    cacheStatus: 'no-cache',
                    status: entry.metadata.statusCode,
                  });
                  this.emitRequestSuccess(
                    requestContext,
                    entry.metadata.statusCode,
                  );
                  return entry.value as Result;
                }
                this.emitEvent({
                  ...this.eventBase(requestContext),
                  type: 'cache:stale',
                  cacheKey: cacheHash,
                  cacheStatus: 'no-cache',
                  status: entry.metadata.statusCode,
                });
                staleEntry = entry;
                emitCacheRevalidationScheduled(entry);
                break;

              case 'must-revalidate':
                this.emitEvent({
                  ...this.eventBase(requestContext),
                  type: 'cache:stale',
                  cacheKey: cacheHash,
                  cacheStatus: 'must-revalidate',
                  status: entry.metadata.statusCode,
                });
                staleEntry = entry;
                emitCacheRevalidationScheduled(entry);
                break;

              case 'stale-while-revalidate': {
                this.emitEvent({
                  ...this.eventBase(requestContext),
                  type: 'cache:stale',
                  cacheKey: cacheHash,
                  cacheStatus: 'stale-while-revalidate',
                  status: entry.metadata.statusCode,
                });
                this.emitEvent({
                  ...this.eventBase(requestContext),
                  type: 'cache:revalidate',
                  cacheKey: cacheHash,
                  phase: 'scheduled',
                  status: entry.metadata.statusCode,
                });
                // Serve stale immediately, revalidate in background
                const revalidation = this.backgroundRevalidate(
                  url,
                  cacheHash,
                  entry,
                  requestContext,
                  headers,
                  cacheConfig,
                  options.cache?.tags,
                );
                this.pendingRevalidations.push(revalidation);
                // Cleanup resolved promises periodically
                revalidation.finally(() => {
                  this.pendingRevalidations = this.pendingRevalidations.filter(
                    (p) => p !== revalidation,
                  );
                });
                this.emitEvent({
                  ...this.eventBase(requestContext),
                  type: 'cache:hit',
                  cacheKey: cacheHash,
                  cacheStatus: 'stale-while-revalidate',
                  status: entry.metadata.statusCode,
                });
                this.emitRequestSuccess(
                  requestContext,
                  entry.metadata.statusCode,
                );
                return entry.value as Result;
              }

              case 'stale-if-error':
                this.emitEvent({
                  ...this.eventBase(requestContext),
                  type: 'cache:stale',
                  cacheKey: cacheHash,
                  cacheStatus: 'stale-if-error',
                  status: entry.metadata.statusCode,
                });
                // Attempt fresh fetch, fall back to stale on error
                staleCandidate = entry;
                staleEntry = entry; // Also use for conditional request
                emitCacheRevalidationScheduled(entry);
                break;

              case 'stale':
                this.emitEvent({
                  ...this.eventBase(requestContext),
                  type: 'cache:stale',
                  cacheKey: cacheHash,
                  cacheStatus: 'stale',
                  status: entry.metadata.statusCode,
                });
                staleEntry = entry;
                emitCacheRevalidationScheduled(entry);
                break;
            }
          }
        }
      }

      // 2. Deduplication — check for in-progress request
      if (this.stores.dedupe) {
        const dedupeStartedAt = Date.now();
        const existingResult = await this.stores.dedupe.waitFor(rawHash);
        if (existingResult !== undefined) {
          this.emitEvent({
            ...this.eventBase(requestContext),
            type: 'dedupe:join',
            dedupeKey: rawHash,
            durationMs: Date.now() - dedupeStartedAt,
          });
          this.emitRequestSuccess(requestContext);
          return existingResult as Result;
        }

        if (this.stores.dedupe.registerOrJoin) {
          const registration = await this.stores.dedupe.registerOrJoin(rawHash);

          if (!registration.isOwner) {
            this.emitEvent({
              ...this.eventBase(requestContext),
              type: 'dedupe:join',
              dedupeKey: rawHash,
            });
            const joinedResult = await this.stores.dedupe.waitFor(rawHash);
            if (joinedResult !== undefined) {
              this.emitRequestSuccess(requestContext);
              return joinedResult as Result;
            }
          } else {
            this.emitEvent({
              ...this.eventBase(requestContext),
              type: 'dedupe:owner',
              dedupeKey: rawHash,
            });
          }
        } else {
          await this.stores.dedupe.register(rawHash);
          this.emitEvent({
            ...this.eventBase(requestContext),
            type: 'dedupe:owner',
            dedupeKey: rawHash,
          });
        }
      }

      // 3. Rate limiting — check if request can proceed
      let alreadyRecordedRateLimit = false;
      if (this.stores.rateLimit) {
        alreadyRecordedRateLimit = await this.enforceStoreRateLimit(
          resource,
          priority,
          signal,
          requestContext,
        );
      }

      // 4. Execute the actual HTTP request (with optional retry)
      // Build base headers once — conditional headers on top of user headers
      const fetchHeaders = new Headers(headers);
      if (staleEntry) {
        if (staleEntry.metadata.etag) {
          fetchHeaders.set('If-None-Match', staleEntry.metadata.etag);
        }
        if (staleEntry.metadata.lastModified) {
          fetchHeaders.set(
            'If-Modified-Since',
            staleEntry.metadata.lastModified,
          );
        }
      }

      const retryConfig = this.resolveRetryConfig(options.retry);
      const fetchResult = await this.executeFetch(
        url,
        fetchHeaders,
        signal,
        retryConfig,
        staleEntry,
        requestContext,
      );

      // Handle 304 Not Modified
      if (fetchResult.notModified) {
        const { refreshedEntry } = fetchResult;
        const ttl = this.clampTTL(
          calculateStoreTTL(refreshedEntry.metadata, cacheConfig.cacheTTL),
          cacheConfig.cacheOverrides,
        );

        await this.cacheSet(
          cacheHash,
          refreshedEntry,
          ttl,
          options.cache?.tags,
        );
        emitCacheRevalidationOutcome('notModified', { status: 304 });

        const result = refreshedEntry.value as Result;

        if (this.stores.dedupe) {
          await this.stores.dedupe.complete(rawHash, result);
        }

        this.emitRequestSuccess(
          requestContext,
          refreshedEntry.metadata.statusCode,
        );
        return result;
      }

      const { response, parsedBody } = fetchResult;

      // 5. Apply response transformer if provided
      let data: unknown = parsedBody.data;
      if (this.options.responseTransformer && data) {
        data = this.options.responseTransformer(data);
      }

      // 6. Apply response handler if provided (for domain-specific validation)
      if (this.options.responseHandler) {
        data = this.options.responseHandler(data);
      }

      const result = data as Result;

      // 7. Record the request for rate limiting
      if (this.stores.rateLimit && !alreadyRecordedRateLimit) {
        const rateLimit = this.stores.rateLimit as AdaptiveRateLimitStore;
        await rateLimit.record(resource, priority);
      }

      // 8. Cache the result
      if (this.stores.cache) {
        const cc = parseCacheControl(response.headers.get('cache-control'));
        const shouldStore =
          !cc.noStore || cacheConfig.cacheOverrides?.ignoreNoStore;

        if (shouldStore) {
          const entry = createCacheEntry(
            result,
            response.headers,
            response.status,
          );
          if (entry.metadata.varyHeaders && headers) {
            const varyFields = parseVaryHeader(entry.metadata.varyHeaders);
            entry.metadata.varyValues = captureVaryValues(varyFields, headers);
          }
          const ttl = this.clampTTL(
            calculateStoreTTL(entry.metadata, cacheConfig.cacheTTL),
            cacheConfig.cacheOverrides,
          );
          await this.cacheSet(cacheHash, entry, ttl, options.cache?.tags);
        }
      }

      if (staleEntry) {
        emitCacheRevalidationOutcome('success', { status: response.status });
      }

      // 9. Mark deduplication as complete
      if (this.stores.dedupe) {
        await this.stores.dedupe.complete(rawHash, result);
      }

      this.emitRequestSuccess(requestContext, response.status);
      return result;
    } catch (error) {
      // stale-if-error fallback: serve stale entry when origin fails
      if (staleCandidate && this.isServerErrorOrNetworkFailure(error)) {
        const result = staleCandidate.value as Result;
        emitCacheRevalidationOutcome('error', {
          status: this.statusFromError(error),
          error: this.toError(error),
        });
        this.emitEvent({
          ...this.eventBase(requestContext),
          type: 'cache:hit',
          cacheKey: cacheHash,
          cacheStatus: 'stale-if-error',
          status: staleCandidate.metadata.statusCode,
        });

        if (this.stores.dedupe) {
          await this.stores.dedupe.complete(rawHash, result);
        }

        this.emitRequestSuccess(
          requestContext,
          staleCandidate.metadata.statusCode,
        );
        return result;
      }

      emitCacheRevalidationOutcome('error', {
        status: this.statusFromError(error),
        error: this.toError(error),
      });

      // Mark deduplication as failed
      if (this.stores.dedupe) {
        await this.stores.dedupe.fail(rawHash, error as Error);
      }

      // Allow callers to detect aborts distinctly – do not wrap AbortError.
      if (error instanceof Error && error.name === 'AbortError') {
        this.emitRequestError(requestContext, error);
        throw error;
      }

      // Already a processed error from the !response.ok branch above
      if (error instanceof HttpClientError) {
        this.emitRequestError(requestContext, error, error.statusCode);
        throw error;
      }

      let clientError: Error;
      try {
        clientError = this.generateClientError(error);
      } catch (generatedError) {
        const emittedError = this.toError(generatedError);
        this.emitRequestError(
          requestContext,
          emittedError,
          this.statusFromError(error) ?? this.statusFromError(emittedError),
        );
        throw generatedError;
      }
      this.emitRequestError(
        requestContext,
        clientError,
        this.statusFromError(error) ?? this.statusFromError(clientError),
      );
      throw clientError;
    }
  }
}
