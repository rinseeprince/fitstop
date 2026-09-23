import type { BlockWeekOfTotal } from "@/lib/blocks/block-derivations";
import type { GoalType } from "@/lib/goals/goal-types";
import type { BlockState } from "@/types/client-blocks";
import type { NutritionPlanNote } from "@/types/nutrition-plan-notes";

// Wire types for GET /api/client/journey — the client-facing journey read
// (Session 4). Weights are canonical kilograms with no unit tags and no
// rounding (CONVENTIONS §20; the renderer converts to the viewer's unit,
// rounds, then subtracts for the "to go" line).

/** One block, decorated exactly like the coach GET (decorateBlocks). Archived
 *  blocks are excluded server-side: the archive curates the presented journey
 *  for both audiences (Session 4 decision). */
export interface ClientJourneyBlock {
  id: string;
  name: string;
  /** The coach's "what's this block for?" sentence; render verbatim. */
  focus: string | null;
  startsOn: string;
  endsOn: string;
  weeks: number;
  state: BlockState;
  weekOfTotal: BlockWeekOfTotal | null;
}

/** The readings a goal's progress is judged from (kg, %): the client's newest,
 *  and the ones on the goal's start day, which its progress runs from. */
export interface ClientJourneyGoalReadings {
  weightKg: number | null;
  bodyFatPercentage: number | null;
  startWeightKg: number | null;
  startBodyFatPercentage: number | null;
}

/** The goal in force on the client's today (`client_goals`), with that day's
 *  deadline — the one client wire that carries the deadline. A planned goal is
 *  not here before its day. `weightKg` is resolved through
 *  resolveEffectiveGoal: null means maintenance. The rest are what the
 *  client's goal card shows — optional on the wire, all null when no goal is
 *  in force; `description` is the goal's own words, the client's for the goal
 *  their questionnaire set. */
interface ClientJourneyGoal {
  weightKg: number | null;
  deadline: string | null;
  name?: string | null;
  type?: GoalType | null;
  bodyFatPercentage?: number | null;
  description?: string | null;
  readings?: ClientJourneyGoalReadings | null;
}

/**
 * The coach's plan-save notes the client may CURRENTLY see, and the block they
 * belong to.
 *
 * THE SHAPE IS THE POLICY. There is deliberately no per-block `notes` field on
 * `ClientJourneyBlock`: a client sees these notes only while the block
 * containing them is current, and that rule is enforced HERE, on the wire, not
 * in a renderer. This endpoint is the RN contract — a rule expressed in one web
 * component would ship elapsed-block notes to RN and leave it to re-derive the
 * same drop, or the two client apps would disagree about what a client is
 * allowed to read. Same reason archived blocks are filtered server-side.
 *
 * So widening visibility to finished blocks is a deliberate CONTRACT change,
 * not a filter removal. If that day comes, move notes onto the block objects on
 * purpose rather than loosening a `.filter()`.
 *
 * `blockId` is carried so a client can ASSERT the notes belong to the block it
 * is rendering rather than infer it, and so the empty cases stay distinct:
 * `null` means no current block, while `{ blockId, notes: [] }` means there is
 * one and the coach has written nothing. A bare array could not tell those
 * apart.
 */
export interface ClientJourneyCurrentBlockNotes {
  blockId: string;
  /** Oldest first — the order the coach wrote them. */
  notes: NutritionPlanNote[];
}

export interface ClientJourney {
  /** The client's calendar day — the anchor every block was decorated with;
   *  the renderer's progress math must use this, never the device day. */
  clientToday: string;
  /** Unarchived blocks in date order. */
  blocks: ClientJourneyBlock[];
  goal: ClientJourneyGoal;
  /** The newest weight (kg), from the day-values; null for a client with no blocks. */
  currentWeightKg: number | null;
  /** See the type doc: the shape is the policy. `null` = no current block. */
  currentBlockNotes: ClientJourneyCurrentBlockNotes | null;
}
