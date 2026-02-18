/**
 * Configuration for per-resource rate limiting.
 *
 * This interface is shared by all store implementations (e.g. in-memory,
 * SQLite) so that callers can use a single canonical type.
 */
export interface RateLimitConfig {
  /** Number of requests allowed per time window */
  limit: number;
  /** Duration of the window in milliseconds */
  windowMs: number;
}

/**
 * Default rate-limit window: 60 requests per minute.
 *
 * Store implementations can reference this to avoid duplicating magic numbers.
 */
export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  limit: 60,
  windowMs: 60_000,
};

/**
 * Map of resource keys to their rate-limit configurations.
 * Keys should match the output of `resourceExtractor`.
 */
export type RateLimitConfigMap = Map<string, RateLimitConfig>;
