// Generated from packages/schema/schemas. Do not edit — run `npm run schema`.
import { z } from "zod";

/** One normalised hour of forecast. Canonical units only: Celsius, km/h, millimetres, UTC. */
export const ForecastHour = z.object({
  hour_utc: z.string().datetime({ offset: true }),
  local_hour: z.number().int().min(0).max(23),
  temperature_c: z.number(),
  precip_prob_pct: z.number().int().min(0).max(100),
  precip_mm: z.number().min(0),
  wind_kmh: z.number().min(0),
  uv_index: z.number().min(0),
  cloud_cover_pct: z.number().int().min(0).max(100),
  weather_code: z.number().int(),
}).strict();

export type ForecastHour = z.infer<typeof ForecastHour>;
