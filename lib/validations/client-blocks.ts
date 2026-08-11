import { z } from "zod";
import {
  BLOCK_FOCUS_MAX,
  BLOCK_NAME_MAX,
  BLOCK_WEEKS_MAX,
  BLOCKS_PER_CLIENT_MAX,
  WEIGHT_KG_MAX,
  WEIGHT_KG_MIN,
} from "@/lib/constants";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const dateMessage = "Date must be in YYYY-MM-DD format";

/** Format AND calendar validity: the value feeds UTC date math before it ever
 *  reaches Postgres, so a regex-passing "2026-13-99" must 400 here rather
 *  than crash the chain walk. */
const dateString = z
  .string()
  .regex(dateRegex, dateMessage)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    message: "Not a real calendar date",
  });

/**
 * One block in the PUT chain. `weeks` is optional HERE because pinned elapsed
 * rows omit it (their dates come from storage — a truncated block's day count
 * is not whole weeks); the service 422s a current/future row without it.
 * `targetWeightKg` is canonical kilograms on the wire (CONVENTIONS §20) — the
 * form converts from the viewer's unit before sending; bounds describe
 * storage. Explicit null clears; omitted means null for a new row and must
 * echo null for an elapsed one.
 */
const blockEntrySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(BLOCK_NAME_MAX),
  weeks: z.number().int().min(1).max(BLOCK_WEEKS_MAX).optional(),
  focus: z
    .string()
    .trim()
    .max(BLOCK_FOCUS_MAX)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional(),
  targetWeightKg: z
    .number()
    .min(WEIGHT_KG_MIN)
    .max(WEIGHT_KG_MAX)
    .nullable()
    .optional(),
});

/** The whole chain — durations in, dates out; the caller never sends date
 *  pairs (workstream invariant 3). */
export const replaceBlockChainSchema = z.object({
  startsOn: dateString,
  blocks: z.array(blockEntrySchema).min(1).max(BLOCKS_PER_CLIENT_MAX),
});

export type ReplaceBlockChainPayload = z.infer<typeof replaceBlockChainSchema>;
