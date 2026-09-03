// Generated from packages/schema/schemas. Do not edit — run `npm run schema`.
import { z } from "zod";

/** A place an account asks about. The label is what the person calls it, not what a geocoder returned. */
export const SavedLocation = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/),
  label: z.string().min(1).max(60),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timezone: z.string().min(1).max(64),
  is_current: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(9999).optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
}).strict();

export type SavedLocation = z.infer<typeof SavedLocation>;
