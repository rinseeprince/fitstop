import { supabaseAdmin } from "./supabase-admin";
import { addDaysToDateString } from "@/lib/date-helpers";
import { captureApiError } from "@/lib/error-handler";

/**
 * From which day may this client's training sessions be REMOVED, and from
 * which day may a training PROGRAM start?
 *
 * Their today — unless they have already trained today, in which case
 * tomorrow.
 *
 * Replacing today is always fine: a placement overwrites the day in the same
 * breath it clears it. EMPTYING today is the harm — the client loses their
 * session for the rest of the day — and so is placing a program's first
 * session beside a workout they have already logged (the walk's upsert
 * arbitrates on the session row, so the completed event and the new one
 * stand side by side and the check-in counts a missed session). So the
 * training removals ask this, and so does the program start.
 *
 * The training log ALONE answers it (owner, 2026-09-11): an event on the date
 * that has left `scheduled`. A meal logged today moves nothing — today's
 * targets are the coach's to replace, and a logged today reads the new
 * target the moment they do, because a day's target is computed and the
 * food log stores none. Nutrition asks no floor: a version starts on any day
 * from the client's today, and the client's meals save whatever the coach
 * changes. Do not put a `nutrition_logs` read back here.
 *
 * Every removal path asks this and nothing does its own arithmetic. A removal
 * that starts here needs NO second "skip the day they trained" filter — with
 * this floor that day is never in range.
 */
export async function resolveEventDeletionFloor(
  clientId: string,
  clientToday: string
): Promise<string> {
  const tomorrow = addDaysToDateString(clientToday, 1);

  const { data: trained, error } = await supabaseAdmin
    .from("training_events")
    .select("id")
    .eq("client_id", clientId)
    .eq("date", clientToday)
    .neq("status", "scheduled")
    .limit(1)
    .maybeSingle();

  // Fail CLOSED. A failed read leaves us unable to prove today is untouched,
  // and the two wrong answers are not symmetric: skipping a day we could have
  // removed is a stale row the next removal clears, while emptying a day the
  // client trained cannot be undone.
  if (error) {
    console.error("Failed to resolve the event deletion floor:", error);
    captureApiError(error, { action: "event-deletion-floor", clientId });
    return tomorrow;
  }

  return trained ? tomorrow : clientToday;
}
