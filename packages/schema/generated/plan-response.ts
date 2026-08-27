// Generated from packages/schema/schemas. Do not edit — run `npm run schema`.
import { z } from "zod";

/** The assistant's answer to a planning question. Every figure in it comes from the scoring engine; the model supplies the sentence, not the facts. */
export const PlanResponse = z.object({
  verdict: z.enum(["good", "mixed", "bad"]),
  best_window: z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_hour: z.number().int().min(0).max(23),
  end_hour: z.number().int().min(0).max(23),
  score: z.number().min(0).max(100),
}).strict().nullable().optional(),
  reason: z.string().min(1).max(400),
  warnings: z.array(z.string().max(200)).max(4),
}).strict();

export type PlanResponse = z.infer<typeof PlanResponse>;
