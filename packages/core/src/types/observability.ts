import type { HttpErrorContext } from './http-client.js';

export type HttpClientEventType =
  | 'request:start'
  | 'request:success'
  | 'request:error'
  | 'cache:hit'
  | 'cache:miss'
  | 'cache:stale'
  | 'cache:revalidate'
  | 'dedupe:owner'
  | 'dedupe:join'
  | 'rateLimit:wait'
  | 'rateLimit:throw'
  | 'serverCooldown:set'
  | 'retry:scheduled'
  | 'retry:exhausted';

export interface HttpClientEventBase {
  type: HttpClientEventType;
  clientName: string;
  requestId: string;
  url: string;
  method: string;
  resourceKey?: string;
  timestamp: number;
}

export type HttpClientCacheStatus =
  | 'fresh'
  | 'no-cache'
  | 'must-revalidate'
  | 'stale-while-revalidate'
  | 'stale-if-error'
  | 'stale'
  | 'miss'
  | 'vary-mismatch'
  | 'unusable';

export type HttpClientCacheRevalidationPhase =
  | 'scheduled'
  | 'success'
  | 'error'
  | 'notModified';

export type HttpClientRateLimitSource = 'store' | 'serverCooldown';

export interface HttpClientRequestStartEvent extends HttpClientEventBase {
  type: 'request:start';
}

export interface HttpClientRequestSuccessEvent extends HttpClientEventBase {
  type: 'request:success';
  durationMs: number;
  status?: number;
  cacheKey?: string;
}

export interface HttpClientRequestErrorEvent extends HttpClientEventBase {
  type: 'request:error';
  durationMs: number;
  status?: number;
  error: Error;
  cacheKey?: string;
}

export interface HttpClientCacheHitEvent extends HttpClientEventBase {
  type: 'cache:hit';
  cacheKey: string;
  cacheStatus: Extract<
    HttpClientCacheStatus,
    'fresh' | 'no-cache' | 'stale-while-revalidate' | 'stale-if-error'
  >;
  status?: number;
}

export interface HttpClientCacheMissEvent extends HttpClientEventBase {
  type: 'cache:miss';
  cacheKey: string;
  cacheStatus: Extract<
    HttpClientCacheStatus,
    'miss' | 'vary-mismatch' | 'unusable'
  >;
}

export interface HttpClientCacheStaleEvent extends HttpClientEventBase {
  type: 'cache:stale';
  cacheKey: string;
  cacheStatus: Extract<
    HttpClientCacheStatus,
    | 'no-cache'
    | 'must-revalidate'
    | 'stale-while-revalidate'
    | 'stale-if-error'
    | 'stale'
  >;
  status?: number;
}

export interface HttpClientCacheRevalidateEvent extends HttpClientEventBase {
  type: 'cache:revalidate';
  cacheKey: string;
  phase: HttpClientCacheRevalidationPhase;
  durationMs?: number;
  status?: number;
  error?: Error;
}

export interface HttpClientDedupeOwnerEvent extends HttpClientEventBase {
  type: 'dedupe:owner';
  dedupeKey: string;
}

export interface HttpClientDedupeJoinEvent extends HttpClientEventBase {
  type: 'dedupe:join';
  dedupeKey: string;
  durationMs?: number;
}

export interface HttpClientRateLimitWaitEvent extends HttpClientEventBase {
  type: 'rateLimit:wait';
  resourceKey: string;
  source: HttpClientRateLimitSource;
  waitMs: number;
  attempt?: number;
}

export interface HttpClientRateLimitThrowEvent extends HttpClientEventBase {
  type: 'rateLimit:throw';
  resourceKey: string;
  source: HttpClientRateLimitSource;
  waitMs?: number;
  error: Error;
  attempt?: number;
}

export interface HttpClientServerCooldownSetEvent extends HttpClientEventBase {
  type: 'serverCooldown:set';
  resourceKey: string;
  waitMs: number;
  status?: number;
  attempt?: number;
}

export interface HttpClientRetryScheduledEvent extends HttpClientEventBase {
  type: 'retry:scheduled';
  attempt: number;
  waitMs: number;
  status?: number;
  error?: Error | HttpErrorContext;
}

export interface HttpClientRetryExhaustedEvent extends HttpClientEventBase {
  type: 'retry:exhausted';
  attempt: number;
  status?: number;
  error?: Error | HttpErrorContext;
}

export type HttpClientEvent =
  | HttpClientRequestStartEvent
  | HttpClientRequestSuccessEvent
  | HttpClientRequestErrorEvent
  | HttpClientCacheHitEvent
  | HttpClientCacheMissEvent
  | HttpClientCacheStaleEvent
  | HttpClientCacheRevalidateEvent
  | HttpClientDedupeOwnerEvent
  | HttpClientDedupeJoinEvent
  | HttpClientRateLimitWaitEvent
  | HttpClientRateLimitThrowEvent
  | HttpClientServerCooldownSetEvent
  | HttpClientRetryScheduledEvent
  | HttpClientRetryExhaustedEvent;

/**
 * Observability configuration for an `HttpClient` instance.
 *
 * Observers receive structured lifecycle events covering requests, cache,
 * dedupe, rate limiting, server cooldowns, and retries. Observer return values
 * are ignored and observer errors are swallowed so observability can never
 * affect request behaviour.
 */
export interface HttpClientObservabilityOptions {
  onEvent?: (event: HttpClientEvent) => void | Promise<void>;
}
