import type {
  CacheStore,
  DedupeStore,
  HttpClient,
  RateLimitStore,
} from '@http-client-toolkit/core';
import { z } from 'zod';

const CLIENT_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

const ClientConfigSchema = z
  .object({
    client: z.custom<HttpClient>(
      (val) =>
        val != null &&
        typeof val === 'object' &&
        'stores' in val &&
        'get' in val,
      'Must be an HttpClient instance',
    ),
    name: z
      .string()
      .min(1, 'Client name must not be empty')
      .regex(CLIENT_NAME_REGEX, 'Client name must be URL-safe (a-z, 0-9, -, _)')
      .optional(),
  })
  .refine(
    (data) => {
      const { stores } = data.client;
      return stores.cache || stores.dedupe || stores.rateLimit;
    },
    { message: 'HttpClient must have at least one store configured' },
  );

function resolveClientName(c: { client: HttpClient; name?: string }): string {
  return c.name ?? c.client.name;
}

const DashboardOptionsSchema = z
  .object({
    clients: z
      .array(ClientConfigSchema)
      .min(1, 'At least one client is required'),
    basePath: z.string().default('/'),
    pollIntervalMs: z.number().int().positive().default(5000),
  })
  .refine(
    (data) => {
      const names = data.clients.map(resolveClientName);
      return new Set(names).size === names.length;
    },
    { message: 'Client names must be unique' },
  );

const StandaloneDashboardOptionsSchema = DashboardOptionsSchema.and(
  z.object({
    port: z.number().int().nonnegative().default(4000),
    host: z.string().default('localhost'),
  }),
);

export interface NormalizedClientConfig {
  name: string;
  cacheStore?: CacheStore;
  dedupeStore?: DedupeStore;
  rateLimitStore?: RateLimitStore;
}

export function normalizeClient(config: {
  client: HttpClient;
  name?: string;
}): NormalizedClientConfig {
  const name = config.name ?? config.client.name;
  const { stores } = config.client;
  return {
    name,
    cacheStore: stores.cache,
    dedupeStore: stores.dedupe,
    rateLimitStore: stores.rateLimit,
  };
}

export type ClientConfig = z.input<typeof ClientConfigSchema>;
export type DashboardOptions = z.input<typeof DashboardOptionsSchema>;
export type StandaloneDashboardOptions = z.input<
  typeof StandaloneDashboardOptionsSchema
>;

export function validateDashboardOptions(options: DashboardOptions) {
  return DashboardOptionsSchema.parse(options);
}

export function validateStandaloneOptions(options: StandaloneDashboardOptions) {
  return StandaloneDashboardOptionsSchema.parse(options);
}
