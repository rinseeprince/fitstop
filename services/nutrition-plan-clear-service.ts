import { supabaseAdmin } from "./supabase-admin";
import { addDaysToDateString } from "@/lib/date-helpers";
import { deleteNutritionDayEditsInRanges } from "./nutrition-day-edits-service";

/**
 * "Delete nutrition plan": end the versions a delete names — the nutrition
 * twin of `clearTrainingPlansForClient` / `retireTrainingPlans`.
 *
 * A delete is a save of nothing from today (owner decision 2026-09-10). The
 * RUNNING version — started before today, still reaching it — is capped at
 * YESTERDAY: its past days keep their version, on the calendar and on every
 * block it ran in, and every "now" read finds nothing from today. A QUEUED
 * version — starting today or later — never ran a day of its own and is
 * ARCHIVED. A FINISHED version — ended before today — is history and is not
 * touched. Yesterday, never today, deliberately: a version closed AT today
 * would keep covering it, so the hero would go on saying "Active since" after
 * the delete. Today is the coach's to end whatever the client has eaten
 * (owner, 2026-09-11) — nutrition asks no floor — and the client's meals
 * still save on the days this uncovers, with no target to judge them: the
 * food log holds what they ate and nothing else.
 *
 * A day's target is COMPUTED from the version covering it (owner decision
 * 2026-09-10), so this issues NO day statement: ending the versions IS
 * removing the days, and nothing can be left standing on the calendar for a
 * version this did not select. That is what makes the block-scoped delete
 * safe — a version is either ended whole or left whole; there is no day range
 * for a bound to get wrong.
 *
 * The one thing stored per day is the coach's hand edit, and the days this
 * uncovers take their edits with them (owner decision 2026-09-10): the edits
 * dated from today inside the ended versions' windows, in one statement, so a
 * surviving version's days — a crossing plan's, a later block's — and every
 * past day keep theirs. Left behind, an edit on an uncovered day would be
 * invisible (no day to see or revert it on) and would answer again under
 * whatever version next covered the date.
 *
 * ONE act, three selections: the nutrition calendar's own delete (every
 * running or queued version), the block delete, which always takes the
 * block's plans (only the versions inside it), and the block card's per-plan
 * delete (one version by id). Every selection hands its rows to the same
 * retire path — the statements are spelled once, in `endNutritionVersionsAt`,
 * which a block trim shares. There is no delete-the-days-but-keep-the-
 * plan variant (owner, 2026-09-08): a version left standing covers its days,
 * so the two cannot be separated. Deleting one version never touches another
 * (owner, 2026-09-11): a queued version's dates go empty and the coach fills
 * them; nothing regrows.
 *
 * Three statements, whatever the count: the edits first, then the cap at
 * yesterday, then the archive. The edits go FIRST so a mid-flight failure leaves every
 * version whole for the retry to find; the other order would end the versions
 * and strand their edits, which a retry can no longer reach.
 */

/** The three columns the retire rule reads. */
type RetirableVersion = { id: string; effective_from: string; effective_until: string };

type RetireResult = { versionsCleared: number; versionIds: string[]; editsCleared: number };

const VERSION_COLUMNS = "id, effective_from, effective_until";

/** A version and the last day it keeps. */
type VersionEnd = RetirableVersion & { lastDay: string };

/**
 * End each version on its own last day — the statements, spelled once. Takes
 * rows the caller has already proved are the client's, active, and still
 * reaching a day ahead.
 *
 * - A version that started on or before its last day and reaches past it is
 *   CAPPED there: the days after it are no longer computed from it.
 * - A version that would start after its last day has no day left, never ran
 *   one of its own, and is ARCHIVED.
 * - A cap never lengthens a window: a version already ending by then moves not.
 *
 * The edits on the days each version gives up — from the day after its last
 * day (its start, when it is archived) to its own end — go first, in one
 * statement. Then one cap statement per distinct last day, then one archive.
 * The delete ends everything at yesterday (below); a block trim ends each
 * version on the day its block allows (`block-plan-trim-service.ts`).
 */
export async function endNutritionVersionsAt(
  clientId: string,
  versions: VersionEnd[]
): Promise<RetireResult> {
  const versionIds = versions.map((version) => version.id);
  if (versionIds.length === 0) return { versionsCleared: 0, versionIds: [], editsCleared: 0 };

  // Read before anything moves. Days on or before a version's last day are
  // never in range — they keep their version and their edits.
  const editsCleared = await deleteNutritionDayEditsInRanges(
    clientId,
    versions.map((version) => {
      const dayAfter = addDaysToDateString(version.lastDay, 1);
      return {
        from: version.effective_from > dayAfter ? version.effective_from : dayAfter,
        to: version.effective_until,
      };
    })
  );

  const now = new Date().toISOString();
  const capped = versions.filter(
    (version) => version.effective_from <= version.lastDay && version.effective_until > version.lastDay
  );
  const archived = versions
    .filter((version) => version.effective_from > version.lastDay)
    .map((version) => version.id);

  for (const lastDay of new Set(capped.map((version) => version.lastDay))) {
    const { error: capError } = await supabaseAdmin
      .from("nutrition_plans")
      .update({ effective_until: lastDay, updated_at: now })
      .in(
        "id",
        capped.filter((version) => version.lastDay === lastDay).map((version) => version.id)
      );
    if (capError) {
      throw new Error(`Failed to end the running nutrition version: ${capError.message}`);
    }
  }

  if (archived.length > 0) {
    const { error: archiveError } = await supabaseAdmin
      .from("nutrition_plans")
      .update({ status: "archived", updated_at: now })
      .in("id", archived);
    if (archiveError) {
      throw new Error(`Failed to retire the queued nutrition versions: ${archiveError.message}`);
    }
  }

  return { versionsCleared: versionIds.length, versionIds, editsCleared };
}

/** The delete's end: every version it names ends at YESTERDAY. */
function retireNutritionVersions(
  clientId: string,
  clientToday: string,
  versions: RetirableVersion[]
): Promise<RetireResult> {
  const yesterday = addDaysToDateString(clientToday, -1);
  return endNutritionVersionsAt(
    clientId,
    versions.map((version) => ({ ...version, lastDay: yesterday }))
  );
}

/** Every version of the client with a day still ahead — a finished one is untouched history. */
function versionsStillAhead(clientId: string, clientToday: string) {
  return supabaseAdmin
    .from("nutrition_plans")
    .select(VERSION_COLUMNS)
    .eq("client_id", clientId)
    .eq("status", "active")
    .gte("effective_until", clientToday);
}

export async function clearNutritionPlansForClient(
  clientId: string,
  clientToday: string,
  /**
   * Optional block window. Given, only the versions that START inside it go —
   * a block contains its plans (a version's end is resolved to the block
   * covering its start, see resolveNutritionPlacementEnd, and drawing or
   * shortening a block trims its versions to fit), so the versions starting
   * in its days are the block's own. Omitted, every running or queued version
   * goes: that is the nutrition calendar's own delete, and it is the training
   * calendar's shape.
   */
  window?: { from: string; to: string }
): Promise<RetireResult> {
  const versionsQuery = versionsStillAhead(clientId, clientToday).order("effective_from", {
    ascending: true,
  });
  const { data: versions, error } = window
    ? await versionsQuery.gte("effective_from", window.from).lte("effective_from", window.to)
    : await versionsQuery;
  if (error) {
    throw new Error(`Failed to resolve the nutrition versions to clear: ${error.message}`);
  }

  return retireNutritionVersions(clientId, clientToday, versions ?? []);
}

type NutritionVersionDeleteOutcome = {
  /** `ended` for a running version capped at yesterday; `archived` for a queued one. */
  outcome: "ended" | "archived";
  editsCleared: number;
};

/**
 * The block card's per-plan delete: ONE version by id, and nothing else. The
 * row must belong to the client, be active and still reach today — a foreign
 * id, an archived version or a finished one answers null, and the route says
 * not found. The running version beside it and the queued version after it
 * are left exactly where they are.
 */
export async function clearNutritionPlanById(
  clientId: string,
  clientToday: string,
  versionId: string
): Promise<NutritionVersionDeleteOutcome | null> {
  const { data: version, error } = await versionsStillAhead(clientId, clientToday)
    .eq("id", versionId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to resolve the nutrition version to delete: ${error.message}`);
  }
  if (!version) return null;

  const { editsCleared } = await retireNutritionVersions(clientId, clientToday, [version]);
  return {
    outcome: version.effective_from < clientToday ? "ended" : "archived",
    editsCleared,
  };
}
