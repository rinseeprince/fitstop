import { supabaseAdmin } from "./supabase-admin";
import { resolveEventDeletionFloor } from "./event-deletion-floor";
import { addDaysToDateString } from "@/lib/date-helpers";

/**
 * "Delete nutrition plan": end the versions the client is on and remove their
 * upcoming targets — the nutrition twin of `clearTrainingPlansForClient`.
 *
 * A delete is a save of nothing from today (owner decision 2026-09-10). The
 * RUNNING version — started before today, still reaching it — is capped at
 * YESTERDAY: its past days keep their version, on the calendar and on every
 * block it ran in, and every "now" read finds nothing from today. A QUEUED
 * version — starting today or later — never ran a day of its own and is
 * ARCHIVED. A FINISHED version — ended before today — is history and is not
 * touched. Yesterday rather than the deletion floor, deliberately: the floor
 * spares a today the client has already logged, and a version closed AT that
 * day kept covering it, so the hero went on saying "Active since" after the
 * delete. Yesterday is never a day the client can still touch; the logged
 * today keeps its event (the floor) and the sweep's floor keeps it standing.
 *
 * One act, two callers: the nutrition calendar's own delete (every running or
 * queued version) and the block delete's "and its plans" (only the versions
 * laid inside the block). There is no delete-the-days-but-keep-the-plan
 * variant (owner, 2026-09-08): a version left standing with no days is
 * restored by the next cascade, so the two always travel together.
 *
 * Days first, so a mid-flight failure leaves a state a retry completes: with
 * the versions still whole a re-run finds them again, and until then the next
 * cascade puts the days back — the delete has simply not happened yet.
 */
export async function clearNutritionPlansForClient(
  clientId: string,
  clientToday: string,
  /**
   * Optional block window. Given, only the versions LAID INSIDE it go — a
   * version belongs to a block when its start falls in the block's days, which
   * is a question dates answer on their own because a version's end is
   * resolved to the block covering its start (see resolveNutritionPlacementEnd).
   * Omitted, every running or queued version goes: that is the nutrition
   * calendar's own delete, and it is the training calendar's shape.
   *
   * A version that merely CROSSES the block (saved before it existed) belongs
   * to no block and survives — the coach removes it from the calendar, where
   * they can see what they are removing.
   */
  window?: { from: string; to: string }
): Promise<{ versionsCleared: number; versionIds: string[] }> {
  const deleteFrom = await resolveEventDeletionFloor(clientId, clientToday);

  // Only versions with a day still ahead: a finished one is untouched history.
  const versionsQuery = supabaseAdmin
    .from("nutrition_plans")
    .select("id, effective_from")
    .eq("client_id", clientId)
    .eq("status", "active")
    .gte("effective_until", clientToday)
    .order("effective_from", { ascending: true });
  const { data: versions, error } = window
    ? await versionsQuery.gte("effective_from", window.from).lte("effective_from", window.to)
    : await versionsQuery;
  if (error) {
    throw new Error(`Failed to resolve the nutrition versions to clear: ${error.message}`);
  }

  const versionIds = (versions ?? []).map((version) => version.id);
  if (versionIds.length === 0) return { versionsCleared: 0, versionIds: [] };

  // Client-scoped and date-bounded, never by plan id: a day inside a version's
  // window may still carry a prior version's id, or none. Floored at the shared
  // deletion floor — a day the client has touched is never in range, so no
  // second "skip the day they logged" filter exists here. Edited days go too:
  // the dialog says everything upcoming goes.
  const from = window && window.from > deleteFrom ? window.from : deleteFrom;
  if (!window || from <= window.to) {
    const eventsQuery = supabaseAdmin
      .from("nutrition_events")
      .delete()
      .eq("client_id", clientId)
      .gte("date", from)
      .eq("status", "scheduled");
    const { error: eventsError } = window
      ? await eventsQuery.lte("date", window.to)
      : await eventsQuery;
    if (eventsError) {
      throw new Error(`Failed to clear the upcoming nutrition days: ${eventsError.message}`);
    }
  }

  const now = new Date().toISOString();
  const running = (versions ?? [])
    .filter((version) => version.effective_from < clientToday)
    .map((version) => version.id);
  const queued = (versions ?? [])
    .filter((version) => version.effective_from >= clientToday)
    .map((version) => version.id);

  if (running.length > 0) {
    const { error: capError } = await supabaseAdmin
      .from("nutrition_plans")
      .update({ effective_until: addDaysToDateString(clientToday, -1), updated_at: now })
      .in("id", running);
    if (capError) {
      throw new Error(`Failed to end the running nutrition version: ${capError.message}`);
    }
  }

  if (queued.length > 0) {
    const { error: archiveError } = await supabaseAdmin
      .from("nutrition_plans")
      .update({ status: "archived", updated_at: now })
      .in("id", queued);
    if (archiveError) {
      throw new Error(`Failed to retire the queued nutrition versions: ${archiveError.message}`);
    }
  }

  return { versionsCleared: versionIds.length, versionIds };
}
