import { z } from "zod";
import {
  BLOCK_FOCUS_MAX,
  BLOCK_NAME_MAX,
  BLOCKS_PER_CLIENT_MAX,
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
 * One block in the PUT payload. Both dates are optional HERE because pinned
 * elapsed rows omit them (their dates come from storage); the service 422s a
 * current/future row missing either, rejects an end before its start, caps the
 * window length (BLOCK_WEEKS_MAX weeks in days), refuses a new block starting
 * in the past, and refuses any overlap — all of which need the client's stored
 * rows and their today, which only the service has.
 */
const blockEntrySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(BLOCK_NAME_MAX),
  startsOn: dateString.optional(),
  endsOn: dateString.optional(),
  focus: z
    .string()
    .trim()
    .max(BLOCK_FOCUS_MAX)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional(),
});

/** Every block the client has, each carrying its own window. `confirmTrims`
 *  is the coach's yes to the question a save that trims plans raises. */
export const replaceBlockChainSchema = z.object({
  blocks: z.array(blockEntrySchema).min(1).max(BLOCKS_PER_CLIENT_MAX),
  confirmTrims: z.literal(true).optional(),
});


/** PATCH /blocks/[blockId]: archive (true) or restore (false) an elapsed
 *  block — a coach view preference, not lifecycle. */
export const archiveBlockSchema = z.object({
  archived: z.boolean(),
});
