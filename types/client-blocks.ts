// Journey blocks. The DB table is client_phases; the coach-facing noun in
// routes, types and UI is "block" — a deliberate divergence recorded on the
// table comment (migration 145). Do not consistency-rename either half.

export type BlockState = "past" | "current" | "future";

/** A stored block. Weights are canonical kilograms (CONVENTIONS §20); dates
 *  are YYYY-MM-DD strings. `archivedAt` is a coach VIEW PREFERENCE (hides an
 *  elapsed block from the main Journey list) — no derivation consults it, the
 *  chain PUT never writes it (the archive PATCH owns it), and the chain
 *  contracts always see ALL blocks; filtering happens only at render. */
export interface ClientBlock {
  id: string;
  name: string;
  focus: string | null;
  targetWeightKg: number | null;
  startsOn: string;
  endsOn: string;
  archivedAt: string | null;
}

/**
 * One entry in the PUT payload. `endsOn` sets the block's END for current and
 * future rows (day-granular — Session 3.6-B, owner-directed); its START is
 * always derived (the previous end + 1, or the chain anchor), so date PAIRS
 * still never cross the wire. Elapsed rows omit it — their dates are pinned
 * from storage.
 */
export interface BlockChainEntryInput {
  id?: string;
  name: string;
  endsOn?: string;
  focus?: string | null;
  targetWeightKg?: number | null;
}

/** The PUT body: the whole chain. Ends in, starts out — the caller never
 *  sends date pairs, so overlaps and gaps stay unexpressible (workstream
 *  invariant 3's mechanism, with the duration unit now a date). */
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

// ---------------------------------------------------------------------------
// Block facts (GET /api/clients/[id]/blocks/facts) — the server-derived
// Training and Nutrition columns of the Journey tab's expanded block card.
// Read-only decoration; the chain routes stay pure CRUD.
// ---------------------------------------------------------------------------

/** A training program whose window overlapped the block. `startsOn` is the
 *  plan's `effective_from` — when it started on the calendar. */
export interface BlockTrainingFact {
  id: string;
  name: string;
  startsOn: string;
}

/**
 * The block's nutrition story, from the EVENTS (per-date SOT), never the plan
 * row: `calories` is the modal `baseline_calories` across the block's lived
 * UNMODIFIED days (per-day coach edits are day-level overrides, not the
 * prescription), and `deficitPerDay` = covering VERSION's `tdee − calories`
 * (positive = deficit), resolved at the latest date that modal value actually
 * appeared — that era's tdee against that era's baseline, never today's.
 * Null when the version carries no tdee.
 *
 * A block spanning a prescription change reports the DOMINANT era as the
 * headline and says so: `changeCount` counts observed baseline transitions
 * across consecutive unmodified days, `lastChangedOn` is the first day of the
 * newest era seen in-window (null when nothing changed). Detected on observed
 * baselines, not version rows, so a re-save with identical numbers does not
 * flag.
 */
export interface BlockNutritionFact {
  calories: number;
  deficitPerDay: number | null;
  changeCount: number;
  lastChangedOn: string | null;
}

/** Per-block server facts. `nutrition` null = no events in the window
 *  ("Not set"). */
export interface BlockFacts {
  blockId: string;
  training: BlockTrainingFact[];
  nutrition: BlockNutritionFact | null;
}
