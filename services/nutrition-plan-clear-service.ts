import { supabaseAdmin } from "./supabase-admin";
import { resolveEventDeletionFloor } from "./event-deletion-floor";

/**
 * "Delete nutrition plan": retire the versions the client is on and remove
 * their upcoming targets — the nutrition twin of `clearTrainingPlansForClient`.
 *
 * One act, two callers: the nutrition calendar's own delete (every version
 * with days on or after the deletion floor — the running one and any queued
 * ones) and the block delete's "and its plans" (only the versions laid inside
 * it). There is no delete-the-days-but-keep-the-plan variant (owner,
 * 2026-09-08): a version left active with no days is restored by the next
 * cascade, so the two always travel together.
 *
 * A retired version is ARCHIVED, never closed at the floor and never
 * hard-deleted (migration 166). Every read resolves among `status = 'active'`
 * rows, so an archived row governs nothing: no cascade regenerates its days,
 * the block card stops claiming it, and the client's food log is refused on
 * the days it used to cover — a gap is a real state. Its stored window is left
 * as it was, the record of what was placed; `updated_at` records the retirement.
 *
 * Days first, so a mid-flight failure leaves a state a retry completes: with
 * the versions still active a re-run finds them again, and until then the
 * next cascade puts the days back — the delete has simply not happened yet.
 * A failure AFTER the archive leaves archived versions whose days are still
 * on the calendar; the next from-scope cascade's gap sweep removes them, and
 * a re-run of the delete answers 404 because nothing active is left.
 */
export async function clearNutritionPlansForClient(
  clientId: string,
  clientToday: string,
  /**
   * Optional block window. Given, only the versions LAID INSIDE it go — a
   * version belongs to a block when its start falls in the block's days, which
   * is a question dates answer on their own because a version's end is
   * resolved to the block covering its start (see resolveNutritionPlacementEnd).
   * Omitted, every version with days on or after the floor goes: that is the
   * nutrition calendar's own delete. A finished version has no days left to
   * remove and stays as history either way.
   *
   * A version that merely CROSSES the block (saved before it existed) belongs
   * to no block and survives — the coach removes it from the calendar, where
   * they can see what they are removing.
   */
  window?: { from: string; to: string }
): Promise<{ versionsCleared: number; versionIds: string[] }> {
  const deleteFrom = await resolveEventDeletionFloor(clientId, clientToday);

  const versionsQuery = supabaseAdmin
    .from("nutrition_plans")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "active")
    .order("effective_from", { ascending: true });
  const { data: versions, error } = window
    ? await versionsQuery.gte("effective_from", window.from).lte("effective_from", window.to)
    : await versionsQuery.gte("effective_until", deleteFrom);
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

  const { error: archiveError } = await supabaseAdmin
    .from("nutrition_plans")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .in("id", versionIds);
  if (archiveError) {
    throw new Error(`Failed to retire the nutrition versions: ${archiveError.message}`);
  }

  return { versionsCleared: versionIds.length, versionIds };
}
