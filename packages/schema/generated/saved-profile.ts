// Generated from packages/schema/schemas. Do not edit — run `npm run schema`.
import { z } from "zod";
import { ActivityProfile } from "./activity-profile";

/** A named profile belonging to an account. Identity and wording live here; what the scoring engine actually reads is the ActivityProfile inside it, defined once and shared with every request that carries one. */
export const SavedProfile = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/),
  name: z.string().min(1).max(60),
  constraints: ActivityProfile,
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
}).strict();

export type SavedProfile = z.infer<typeof SavedProfile>;
