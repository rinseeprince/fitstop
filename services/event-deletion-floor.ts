import { supabaseAdmin } from "./supabase-admin";
import { addDaysToDateString } from "@/lib/date-helpers";
import { captureApiError } from "@/lib/error-handler";

/**
 * From which day may this client's training sessions be REMOVED, and from
 * which day may a plan on either track START?
 *
 * Their today — unless they have already touched today, in which case tomorrow.
 *
 * Replacing today is always fine: a placement overwrites the day in the same
 * breath it clears it. EMPTYING today is the harm — the client loses their
 * session for the rest of the day — and so is re-prescribing a day they have
 * already lived. So the training removals ask this, and so does every plan
 * start on both tracks; nutrition days are computed from the versions and are
 * never removed by anything, so nothing on that side asks it but the start.
 *
 * "Touched" is one question with two answers, because the two tracks record it
 * differently:
 *   - nutrition: a `nutrition_logs` row for the date.
 *   - training: an event on the date that has left `scheduled`.
 *
 * Every removal path asks this and nothing does its own arithmetic. A removal
 * that starts here needs NO second "skip the day they logged" filter — with this
 * floor that day is never in range.
 */
export async function resolveEventDeletionFloor(
  clientId: string,
  clientToday: string
): Promise<string> {
  const tomorrow = addDaysToDateString(clientToday, 1);

  const [nutrition, training] = await Promise.all([
    supabaseAdmin
      .from("nutrition_logs")
      .select("id")
      .eq("client_id", clientId)
      .eq("date", clientToday)
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("training_events")
      .select("id")
      .eq("client_id", clientId)
      .eq("date", clientToday)
      .neq("status", "scheduled")
      .limit(1)
      .maybeSingle(),
  ]);

  // Fail CLOSED. Either read failing leaves us unable to prove today is
  // untouched, and the two wrong answers are not symmetric: skipping a day we
  // could have removed is a stale row the next removal clears, while emptying a
  // day the client logged cannot be undone.
  const readError = nutrition.error ?? training.error;
  if (readError) {
    console.error("Failed to resolve the event deletion floor:", readError);
    captureApiError(readError, { action: "event-deletion-floor", clientId });
    return tomorrow;
  }

  return nutrition.data || training.data ? tomorrow : clientToday;
}
