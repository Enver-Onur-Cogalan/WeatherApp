// Generated from packages/schema/schemas. Do not edit — run `npm run schema`.
import { z } from "zod";

/** What a person wants from the weather before they will go outside. Extracted from natural language once, confirmed by the user, then read by the scoring engine on every request. */
export const ActivityProfile = z.object({
  activity: z.enum(["running", "cycling", "walking", "picnic", "photography", "gardening", "swimming", "other"]),
  temp_min: z.number().int().min(-40).max(50),
  temp_max: z.number().int().min(-40).max(50),
  wind_max_kmh: z.number().int().min(0).max(150),
  precip_max_pct: z.number().int().min(0).max(100),
  uv_max: z.number().int().min(0).max(15).nullable().optional(),
  preferred_hours: z.array(z.number().int().min(0).max(23)).min(2).max(2),
}).strict();

export type ActivityProfile = z.infer<typeof ActivityProfile>;
