// Generated from packages/schema/schemas. Do not edit — run `npm run schema`.
import { z } from "zod";

/** Everything the trace screen needs in one response: the scored hours it draws, the windows it ranks, and the constraint that closed the rest. No language model is involved in producing any of it. */
export const PlanResult = z.object({
  latitude: z.number(),
  longitude: z.number(),
  timezone: z.string(),
  fetched_at: z.string().datetime(),
  stale: z.boolean(),
  hours: z.array(z.object({
  hour_utc: z.string().datetime(),
  local_hour: z.number().int().min(0).max(23),
  score: z.number().min(0).max(100),
  excluded: z.boolean(),
  worst_penalty: z.string().nullable().optional(),
  temperature_c: z.number(),
  precip_prob_pct: z.number().int(),
  wind_kmh: z.number(),
  uv_index: z.number(),
  cloud_cover_pct: z.number().int(),
  weather_code: z.number().int(),
}).strict()),
  windows: z.array(z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_hour: z.number().int().min(0).max(23),
  end_hour: z.number().int().min(0).max(23),
  score: z.number().min(0).max(100),
  length_hours: z.number().int().min(1),
}).strict()),
  blocker: z.object({
  constraint: z.string(),
  hours: z.number().int().min(1),
}).strict().nullable().optional(),
}).strict();

export type PlanResult = z.infer<typeof PlanResult>;
