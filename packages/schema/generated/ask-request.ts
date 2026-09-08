// Generated from packages/schema/schemas. Do not edit — run `npm run schema`.
import { z } from "zod";
import { ActivityProfile } from "./activity-profile";

/** An open-ended question for the assistant. This is the tier most requests do not take — the trace screen answers the common ones deterministically, and this is the escape hatch for what it cannot (docs/06). */
export const AskRequest = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timezone: z.string().min(1),
  days: z.number().int().min(1).max(16).optional(),
  profile: ActivityProfile,
  question: z.string().min(1).max(500),
  history: z.array(z.object({
  question: z.string().min(1).max(500),
  answer: z.string().min(1).max(600),
}).strict()).max(2).optional(),
  language: z.enum(["tr", "en"]).nullable().optional(),
}).strict();

export type AskRequest = z.infer<typeof AskRequest>;
