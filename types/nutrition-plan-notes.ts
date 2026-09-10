/**
 * A nutrition version's save note as it crosses the wire — the "why am I
 * adjusting this plan?" sentence, a column on the version since migration 172
 * (`nutrition_plans.coach_note`): the latest save's, empty included, and gone
 * from every read with an archived version.
 *
 * `id` is the VERSION's id and `effectiveOn` the day the version took effect.
 * One declaration for the client Program tab's `currentBlockNotes`
 * (`types/client-journey.ts`) and the service that builds it
 * (`listNutritionPlanNotesInRange`), so the two cannot drift.
 */
export interface NutritionPlanNote {
  id: string;
  /** The date the version this note explains took effect (YYYY-MM-DD). */
  effectiveOn: string;
  /** Render verbatim, whitespace preserved. Capped at 500 chars on write. */
  body: string;
}
