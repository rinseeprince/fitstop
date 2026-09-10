import { supabaseAdmin } from "./supabase-admin";
import { addDaysToDateString } from "@/lib/date-helpers";
import { deleteNutritionDayEditsInRanges } from "./nutrition-day-edits-service";

/**
 * "Delete nutrition plan": end the versions the client is on — the nutrition
 * twin of `clearTrainingPlansForClient`.
 *
 * A delete is a save of nothing from today (owner decision 2026-09-10). The
 * RUNNING version — started before today, still reaching it — is capped at
 * YESTERDAY: its past days keep their version, on the calendar and on every
 * block it ran in, and every "now" read finds nothing from today. A QUEUED
 * version — starting today or later — never ran a day of its own and is
 * ARCHIVED. A FINISHED version — ended before today — is history and is not
 * touched. Yesterday rather than the shared deletion floor, deliberately: the
 * floor spares a today the client has already logged, and a version closed AT
 * that day kept covering it, so the hero went on saying "Active since" after
 * the delete. Yesterday is never a day the client can still touch.
 *
 * A day's target is COMPUTED from the version covering it (owner decision
 * 2026-09-10), so this issues NO day statement: ending the versions IS
 * removing the days, and nothing can be left standing on the calendar for a
 * version this did not select. That is what makes the block-scoped delete
 * safe — a version saved before the block was drawn and reaching past the
 * block's end is either ended whole or left whole; there is no day range for
 * a bound to get wrong.
 *
 * The one thing stored per day is the coach's hand edit, and the days this
 * uncovers take their edits with them (owner decision 2026-09-10): the edits
 * dated from today inside the ended versions' windows, in one statement, so a
 * surviving version's days — a crossing plan's, a later block's — and every
 * past day keep theirs. Left behind, an edit on an uncovered day would be
 * invisible (no day to see or revert it on) and would answer again under
 * whatever version next covered the date.
 *
 * One act, two callers: the nutrition calendar's own delete (every running or
 * queued version) and the block delete's "and its plans" (only the versions
 * laid inside the block). There is no delete-the-days-but-keep-the-plan
 * variant (owner, 2026-09-08): a version left standing covers its days, so the
 * two cannot be separated.
 *
 * Three statements, whatever the count: the edits first, then one per
 * version outcome. The edits go FIRST so a mid-flight failure leaves every
 * version whole for the retry to find; the other order would end the versions
 * and strand their edits, which a retry can no longer reach.
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
): Promise<{ versionsCleared: number; versionIds: string[]; editsCleared: number }> {
  // Only versions with a day still ahead: a finished one is untouched history.
  const versionsQuery = supabaseAdmin
    .from("nutrition_plans")
    .select("id, effective_from, effective_until")
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
  if (versionIds.length === 0) return { versionsCleared: 0, versionIds: [], editsCleared: 0 };

  // The days these versions answer for from today, read before anything
  // moves: a running version's from today, a queued one's whole window. Past
  // days are never in range — they keep their version and their edits.
  const editsCleared = await deleteNutritionDayEditsInRanges(
    clientId,
    (versions ?? []).map((version) => ({
      from: version.effective_from > clientToday ? version.effective_from : clientToday,
      to: version.effective_until,
    }))
  );

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

  return { versionsCleared: versionIds.length, versionIds, editsCleared };
}
