/**
 * The whole-row reads rule A of scripts/check-perf.ts lets stand
 * (CONVENTIONS §14 "A read returns what the screen renders").
 *
 * A `select("*")` belongs here only when the row goes to a screen whole, the
 * client record of GET /api/clients/[id] being the kind of case: an entry names
 * the file, how many of its whole-row selects are sanctioned, and why. A read
 * a screen uses a few fields of is not an entry; its fix is naming the fields.
 */
export type WholeRowSelect = { file: string; count: number; reason: string };

export const WHOLE_ROW_SELECTS: readonly WholeRowSelect[] = [];
