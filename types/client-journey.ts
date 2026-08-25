import type { BlockWeekOfTotal } from "@/lib/blocks/block-derivations";
import type { BlockState } from "@/types/client-blocks";
import type { NutritionPlanNote } from "@/types/nutrition-plan-notes";

// Wire types for GET /api/client/journey — the client-facing journey read
// (Session 4). Weights are canonical kilograms with no unit tags and no
// rounding (CONVENTIONS §20; the renderer converts to the viewer's unit).
//
// Display parity rule for deltas: there is deliberately NO changeKg field.
// The coach card computes a block's change from points already rounded to
// one decimal in the viewer's unit (end − start AFTER rounding), and
// round(end − start) can differ from round(end) − round(start) by 0.1 — so
// the wire ships both endpoints raw and the renderer converts each, rounds,
// THEN subtracts. The same discipline applies to the "to go" lines.

/** One block, decorated exactly like the coach GET (decorateBlocks) plus the
 *  weight facts the coach card derives (deriveBlockWeightFacts) — same
 *  functions, same merged series, so the two audiences read the same numbers
 *  by construction. Archived blocks are excluded server-side: the archive
 *  curates the presented journey for both audiences (Session 4 decision). */
export interface ClientJourneyBlock {
  id: string;
  name: string;
  /** The coach's "what's this block for?" sentence; render verbatim. */
  focus: string | null;
  targetWeightKg: number | null;
  startsOn: string;
  endsOn: string;
  weeks: number;
  state: BlockState;
  weekOfTotal: BlockWeekOfTotal | null;
  /** Latest merged-series weight (kg) at or before startsOn. */
  startWeightKg: number | null;
  /** Past blocks: latest weight (kg) inside the window. Current: latest
   *  overall. Future: null. */
  endWeightKg: number | null;
}

/** The client's long-term goal, resolved through resolveEffectiveGoal over
 *  client_goals (owner decision 2026-08-12: the deadline is client-visible
 *  here, scoped to this endpoint only). A null weightKg means maintenance —
 *  render no goal line. */
interface ClientJourneyGoal {
  weightKg: number | null;
  deadline: string | null;
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
  /** Latest merged-series weight (kg) overall; the "to go" lines' left side. */
  currentWeightKg: number | null;
  /** See the type doc: the shape is the policy. `null` = no current block. */
  currentBlockNotes: ClientJourneyCurrentBlockNotes | null;
}
