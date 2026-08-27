// Generated from packages/schema/schemas. Do not edit — run `npm run schema`.
import { z } from "zod";
import { ActivityProfile } from "./activity-profile";

/** Ask the scoring engine when to go outside. The profile is sent inline for now; once profiles are stored per account this becomes a reference to a saved one. */
export const PlanRequest = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timezone: z.string().min(1),
  days: z.number().int().min(1).max(16).optional(),
  profile: ActivityProfile,
}).strict();

export type PlanRequest = z.infer<typeof PlanRequest>;
