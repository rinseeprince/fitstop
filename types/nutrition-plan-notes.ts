/**
 * The coach's plan-save note (`nutrition_plan_notes`, migration 147) — the
 * "why am I adjusting this plan?" sentence, kept append-only and client-scoped
 * so neither a plan delete nor a later save can destroy it.
 *
 * One declaration, imported by the service and by both wire types
 * (`types/client-blocks.ts` for the coach's block facts,
 * `types/client-journey.ts` for the client's Program tab), because the three
 * would otherwise be byte-identical copies that only have to be edited once
 * apart to diverge.
 */
export interface NutritionPlanNote {
  id: string;
  /** The date the plan change this note explains took effect (YYYY-MM-DD). */
  effectiveOn: string;
  /** Render verbatim, whitespace preserved. Capped at 500 chars on write. */
  body: string;
}
