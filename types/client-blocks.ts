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
  startsOn: string;
  endsOn: string;
  archivedAt: string | null;
}

/** One entry in the PUT payload. Elapsed rows omit their dates — those are
 *  pinned from storage. */
export interface BlockChainEntryInput {
  id?: string;
  name: string;
  startsOn?: string;
  endsOn?: string;
  focus?: string | null;
}

/** The PUT body: every block the client has, each carrying its OWN window.
 *  Gaps between blocks are a real state — the client is between programs and
 *  nothing is planned; overlaps are refused, in the service and by a database
 *  constraint (migration 164). `confirmTrims` is the coach's yes to the one
 *  question: a save that draws or shortens a block over days that already hold
 *  a plan is refused without it (409, the trims beside it). */
export interface ReplaceBlockChainInput {
  blocks: BlockChainEntryInput[];
  confirmTrims?: true;
}

/**
 * One plan a block save changes so the block contains it — a training program
 * or a nutrition version (`name` null: a version has no name the coach gave
 * it). `startsOn` / `endsOn` are its window before the save; `newEndsOn` is its
 * last day after it, or null when the trim leaves it no day and it is removed.
 */
export interface BlockPlanTrim {
  track: "training" | "nutrition";
  id: string;
  name: string | null;
  startsOn: string;
  endsOn: string;
  newEndsOn: string | null;
}

// ---------------------------------------------------------------------------
// Block facts (GET /api/clients/[id]/blocks/facts) — the server-derived
// Training and Nutrition columns of the Journey tab's expanded block card.
// Read-only decoration; the chain routes stay pure CRUD.
// ---------------------------------------------------------------------------

/**
 * A plan's standing against the CLIENT's today, stamped server-side by the
 * block's own date rule (`derivePlanState`) so the card never re-derives it:
 * `active` = the window covers today, `upcoming` = it starts later, `ended` =
 * it closed before today. The platform's plan vocabulary (the client
 * training-plan read, the Overview's `upcomingTraining`); the card's chip
 * renders `upcoming` as "Planned", as a block's `future` renders "Not started".
 */
export type BlockPlanState = "active" | "upcoming" | "ended";

/** A training program whose window overlapped the block. `startsOn` /
 *  `endsOn` are the plan's own `effective_from` / `effective_until` — when it
 *  started on the calendar and the last day of its window (migration 167). */
export interface BlockTrainingFact {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  state: BlockPlanState;
}

/**
 * A nutrition-plan VERSION whose window overlaps the block — the nutrition twin
 * of a training fact. `calories` is the version's own daily target
 * (custom-macros override honoured; per-day hand edits and training surpluses
 * excluded by construction, since the plan row contains neither) and
 * `deficitPerDay` is that version's `tdee − calories` (positive = deficit;
 * null without a tdee). Every active version overlapping the block is listed,
 * queued ones included, in start order, each carrying the numbers off its OWN
 * row — a closed window is immutable, so an entry dated in the past never
 * rewrites itself on a later save.
 */
export interface BlockNutritionFact {
  id: string;
  /** The version's `effective_from` — when its targets took (or take) effect;
   *  earlier than the block's start for a version already running when the
   *  block began, as a crossing program's `startsOn` is. */
  startsOn: string;
  /** The version's `effective_until` — the last day it answers for. */
  endsOn: string;
  state: BlockPlanState;
  calories: number;
  deficitPerDay: number | null;
  /** The version's save note (`nutrition_plans.coach_note`, migration 172) —
   *  the latest save's, empty included — or null. Rendered nested under the
   *  version's entry on the block timeline. */
  note: string | null;
}

/** Per-block server facts: the WHOLE list per track, in start order, each
 *  entry carrying its window and state. The timeline reads the list entire;
 *  the card headlines ONE entry per track by precedence over the states
 *  (`selectHeadlineFact`, `lib/blocks/block-headline.ts`). An empty list =
 *  nothing set on that track ("No program placed" / "Not set"). */
export interface BlockFacts {
  blockId: string;
  training: BlockTrainingFact[];
  nutrition: BlockNutritionFact[];
}
