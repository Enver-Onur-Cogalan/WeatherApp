// Generated from packages/schema/schemas. Do not edit — run `npm run schema`.
import { z } from "zod";
import { PlanResponse } from "./plan-response";

/** The assistant's answer, and how it was produced. The provenance is not diagnostics: the interface shows it (docs/11), because an assistant that runs on your own device should say so, and an answer the model did not write should not be presented as though it had. */
export const AskResponse = z.object({
  answer: PlanResponse,
  tool_calls: z.array(z.string()),
  duration_ms: z.number().int().min(0),
  from_model: z.boolean(),
  fallback_reason: z.string().nullable().optional(),
  on_device: z.boolean(),
}).strict();

export type AskResponse = z.infer<typeof AskResponse>;
