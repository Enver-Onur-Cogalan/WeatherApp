// Generated from packages/schema/schemas. Do not edit — run `npm run schema`.
import { z } from "zod";

/** What the language model is asked to produce, which is deliberately less than the API returns. The window itself is a computed fact and comes from the scoring engine; letting the model emit one invited it to name a window nobody had ranked. The model contributes the judgement and the sentence, and nothing that can be calculated. */
export const AgentAnswer = z.object({
  verdict: z.enum(["good", "mixed", "bad"]),
  reason: z.string().min(1).max(400),
  warnings: z.array(z.string().max(200)).max(4),
  window_index: z.number().int().min(0).max(4).nullable(),
}).strict();

export type AgentAnswer = z.infer<typeof AgentAnswer>;
