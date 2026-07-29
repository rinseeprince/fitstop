import { z } from "zod";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const dateMessage = "Date must be in YYYY-MM-DD format";

/**
 * Goal blocks ("Cut 1, 8 weeks, -0.6 kg/wk").
 *
 * These bounds live here, not in CHECK constraints on `client_phases`, following
 * the rule migration 131 states: coach input is validated "at the route layer",
 * where the message can actually reach the coach. Nothing in this repo translates
 * SQLSTATE 23514 (measured: zero occurrences), so a CHECK violation would surface
 * as raw Postgres text. The table carries only server-derived CHECKs.
 */

/** A block cannot exceed a year. */
export const MAX_PHASE_WEEKS = 52;

/**
 * The whole chain cannot exceed two years.
 *
 * This is the bound on the nutrition generation horizon, which is
 * `max(from + 56d, last block end, scope.to)`. A `{kind:"from"}` cascade upserts
 * one row per date in that range, so an unbounded chain would make every
 * placement, amendment and plan deletion write an unbounded number of rows. At
 * this cap the worst case is 729 dates per from-scope cascade (against 57 today);
 * the narrow `{kind:"dates"}` paths — move, duplicate, surplus edit — are
 * unaffected and stay at one or two rows.
 */
export const MAX_CHAIN_WEEKS = 104;

/** Guard against a fat-fingered chain, not a product limit. */
export const MAX_PHASES = 12;

/**
 * A sanity bound, NOT the safety cap.
 *
 * The gender safety caps (0.75/1.0 kg-wk loss, 0.35/0.5 gain) live once in
 * `lib/goals/goal-rate.ts` and are applied by the calculator. Invariant 12
 * requires storing the rate the coach actually entered and SURFACING the cap in
 * the per-block preview — clamping it here would make that impossible.
 */
export const MAX_ABS_RATE_KG_PER_WEEK = 5;

export const phaseInputSchema = z
  .object({
    // Present when editing an existing block; absent for a new one.
    id: z.string().uuid().optional(),
    name: z
      .string()
      .trim()
      .min(1, "Block name is required")
      .max(60, "Block name must be 60 characters or fewer"),
    weeks: z
      .number()
      .int("Length must be a whole number of weeks")
      .min(1, "A block must be at least 1 week")
      .max(MAX_PHASE_WEEKS, `A block cannot be longer than ${MAX_PHASE_WEEKS} weeks`),
    // Rate 0 IS maintenance, explicitly — not a missing value (invariant 5).
    ratePerWeekKg: z
      .number()
      .finite("Rate must be a number")
      .min(-MAX_ABS_RATE_KG_PER_WEEK, `Rate must be between -${MAX_ABS_RATE_KG_PER_WEEK} and ${MAX_ABS_RATE_KG_PER_WEEK} kg per week`)
      .max(MAX_ABS_RATE_KG_PER_WEEK, `Rate must be between -${MAX_ABS_RATE_KG_PER_WEEK} and ${MAX_ABS_RATE_KG_PER_WEEK} kg per week`),
  })
  .strict();

/**
 * The whole desired block list, replacing whatever is stored.
 *
 * Lengths only — never date pairs (invariant 6). The server chains the dates, so
 * a client that sent overlapping windows could not express them in the first
 * place. `startDate` is format-only here; the elapsed-block guard is enforced
 * service-side against the CLIENT's today, not the coach's device date.
 */
export const replacePhasesSchema = z
  .object({
    startDate: z.string().regex(dateRegex, dateMessage),
    phases: z
      .array(phaseInputSchema)
      .max(MAX_PHASES, `A plan cannot have more than ${MAX_PHASES} blocks`),
  })
  .strict()
  .superRefine((data, ctx) => {
    const totalWeeks = data.phases.reduce((sum, p) => sum + p.weeks, 0);
    if (totalWeeks > MAX_CHAIN_WEEKS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["phases"],
        message: `Blocks total ${totalWeeks} weeks; the maximum is ${MAX_CHAIN_WEEKS}`,
      });
    }

    const seen = new Set<string>();
    for (const phase of data.phases) {
      if (!phase.id) continue;
      if (seen.has(phase.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["phases"],
          message: "The same block appears more than once",
        });
        return;
      }
      seen.add(phase.id);
    }
  });

export const deletePhaseSchema = z
  .object({ phaseId: z.string().uuid() })
  .strict();

export type PhaseInput = z.infer<typeof phaseInputSchema>;
export type ReplacePhasesInput = z.infer<typeof replacePhasesSchema>;
export type DeletePhaseInput = z.infer<typeof deletePhaseSchema>;
