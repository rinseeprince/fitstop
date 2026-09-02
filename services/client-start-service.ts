import { supabaseAdmin } from "./supabase-admin";

/**
 * A client's ORIGIN — the day coaching began. ONE definition, one writer:
 * `clients.start_date`, written here and nowhere else.
 *
 * The origin is a DATE and nothing more. What the client measured when they
 * began is not stored beside it: the baseline is DERIVED from the measurement
 * log as the reading as of the start date (`client_baseline_measurements`,
 * migration 158 — the latest live row on or before it, else the earliest
 * after), so it cannot disagree with the series and cannot be edited into a
 * number no reading carried. Moving the start date therefore re-derives the
 * baseline and re-dates nothing; the details sheet's Baseline fields append a
 * coach entry dated on the start date (`updateClient`), which the as-of rule
 * then reads.
 *
 * Deliberately NOT the origin (each was considered and rejected):
 *   - a plan's `effective_from` — there are many per client, one can be queued
 *     in the future, and a queued nutrition version can be hard-deleted
 *     (migration 144). An origin that can vanish is not an origin.
 *   - `client_goals.goal_start_date` — versioned per goal, and it answers a
 *     different question ("spread this deficit from when").
 *   - the earliest measurement — that is where the DATA starts, not where the
 *     coaching did; the gap between them is exactly what this records.
 */

type ClientStartInput = {
  /** YYYY-MM-DD. */
  startsOn: string;
};

/**
 * Set the client's origin. Used by activation (which supplies the date it was
 * activated on, or the coach's backdated choice) and by the details sheet's
 * "Started" field after activation.
 */
export async function recordClientStart(
  clientId: string,
  input: ClientStartInput
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("clients")
    .update({ start_date: input.startsOn, updated_at: new Date().toISOString() })
    .eq("id", clientId);

  if (error) {
    console.error("Failed to write client start:", error);
    throw new Error(`Failed to save start date: ${error.message}`);
  }
}
