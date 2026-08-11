// Journey blocks. The DB table is client_phases; the coach-facing noun in
// routes, types and UI is "block" — a deliberate divergence recorded on the
// table comment (migration 145). Do not consistency-rename either half.

export type BlockState = "past" | "current" | "future";

/** A stored block. Weights are canonical kilograms (CONVENTIONS §20); dates
 *  are YYYY-MM-DD strings. */
export interface ClientBlock {
  id: string;
  name: string;
  focus: string | null;
  targetWeightKg: number | null;
  startsOn: string;
  endsOn: string;
}

/**
 * One entry in the PUT payload. `weeks` drives the date recompute for current
 * and future rows and is ignored for pinned elapsed rows — their dates come
 * from storage, and a truncated block's day count is not a whole number of
 * weeks, so no `weeks` value could reproduce it.
 */
export interface BlockChainEntryInput {
  id?: string;
  name: string;
  weeks?: number;
  focus?: string | null;
  targetWeightKg?: number | null;
}

/** The PUT body: the whole chain. The caller never sends date pairs —
 *  durations in, dates out (workstream invariant 3). */
export interface ReplaceBlockChainInput {
  startsOn: string;
  blocks: BlockChainEntryInput[];
}

/** A date movement produced by a delete. Computed pre-confirm by the UI and
 *  returned realized by the DELETE route, through the same pure helper
 *  (`lib/blocks/block-chain.ts`), so the two can never disagree. */
export interface BlockDateChange {
  id: string;
  name: string;
  previous: { startsOn: string; endsOn: string };
  next: { startsOn: string; endsOn: string };
}
