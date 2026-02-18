import type {
  CacheStore,
  DedupeStore,
  RateLimitStore,
} from '@http-client-toolkit/core';
import { z } from 'zod';

const CLIENT_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

const ClientConfigSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Client name must not be empty')
      .regex(
        CLIENT_NAME_REGEX,
        'Client name must be URL-safe (a-z, 0-9, -, _)',
      ),
    cacheStore: z.custom<CacheStore>().optional(),
    dedupeStore: z.custom<DedupeStore>().optional(),
    rateLimitStore: z.custom<RateLimitStore>().optional(),
  })
  .refine(
    (data) => data.cacheStore || data.dedupeStore || data.rateLimitStore,
    { message: 'At least one store must be provided per client' },
  );

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
      const names = data.clients.map((c) => c.name);
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
