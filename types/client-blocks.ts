// Journey blocks. The DB table is client_phases; the coach-facing noun in
// routes, types and UI is "block" — a deliberate divergence recorded on the
// table comment (migration 145). Do not consistency-rename either half.

export type BlockState = "past" | "current" | "future";

/** A stored block. Weights are canonical kilograms (CONVENTIONS §20); dates
 *  are YYYY-MM-DD strings. `archivedAt` CURATES THE PRESENTED JOURNEY for
 *  both audiences (Session 4 decision — it is not a coach-private view
 *  preference): an archived elapsed block leaves the coach's main Journey
 *  list AND the client journey payload (GET /api/client/journey filters it
 *  server-side), surviving only in the coach's Archive view and the chart
 *  bands, which render every block forever. No DATE derivation consults it
 *  (state stays current/past/future from the range — the mig-133 lesson),
 *  the chain PUT never writes it (the archive PATCH owns it), and the chain
 *  contracts always see ALL blocks. */
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
 * The block's nutrition story — the PRESCRIPTION, owner-specified: `calories`
 * is the plan VERSION's own daily target (custom-macros override honoured;
 * per-day hand edits and training surpluses excluded by construction — the
 * plan row contains neither), and `deficitPerDay` = that version's
 * `tdee − calories` (positive = deficit; null without a tdee). The version is
 * the one covering the block's reference date: TODAY for a current block
 * ("what are they on now"), the final day for a past block, the first day for
 * a future one. No covering version → the whole fact is null ("Not set").
 *
 * `changeCount`/`lastChangedOn` stay EVENT-derived: baseline transitions
 * across consecutive unmodified lived days — catching every prescription
 * change that regenerated events, including pre-versioning history no plan
 * row remembers, while hand-edited stretches can neither flag nor mask one.
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
