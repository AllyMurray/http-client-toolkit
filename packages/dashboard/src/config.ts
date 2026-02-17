import type {
  CacheStore,
  DedupeStore,
  RateLimitStore,
} from '@http-client-toolkit/core';
import { z } from 'zod';

const DashboardOptionsSchema = z
  .object({
    cacheStore: z.custom<CacheStore>().optional(),
    dedupeStore: z.custom<DedupeStore>().optional(),
    rateLimitStore: z.custom<RateLimitStore>().optional(),
    basePath: z.string().default('/'),
    pollIntervalMs: z.number().int().positive().default(5000),
  })
  .refine(
    (data) => data.cacheStore || data.dedupeStore || data.rateLimitStore,
    { message: 'At least one store must be provided' },
  );

const StandaloneDashboardOptionsSchema = DashboardOptionsSchema.and(
  z.object({
    port: z.number().int().nonnegative().default(4000),
    host: z.string().default('localhost'),
  }),
);

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
