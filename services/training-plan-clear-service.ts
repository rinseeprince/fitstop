import { supabaseAdmin } from "./supabase-admin";
import { cancelFutureEventsForPlans } from "./training-event-service";
import { cascadeNutritionAfterTrainingChange } from "./nutrition-event-service";
import { resolveEventDeletionFloor } from "./event-deletion-floor";
import { addDaysToDateString } from "@/lib/date-helpers";

/** The two columns the retire rule reads. */
type RetirablePlan = { id: string; effective_from: string; effective_until: string };

/**
 * End the programs a delete names — a delete is a save of nothing from today
 * (owner decision 2026-09-10; the window is the row, migration 167).
 *
 * - A RUNNING program — started before today, still reaching it — is capped
 *   at YESTERDAY. Its past days keep their program, on the calendar and on
 *   every block it ran in, and every "now" read finds nothing from today.
 * - A QUEUED program — starting today or later — never ran a day of its own
 *   and is ARCHIVED. One that started today has no yesterday to end on and is
 *   archived too; the floor keeps a logged today's event for the client.
 * - A FINISHED program — ended before today — is history and is not touched.
 *
 * Yesterday rather than the deletion floor, deliberately: the floor spares a
 * today the client has already logged, and a program closed AT that day would
 * keep covering it, so the hero would go on naming a deleted program until
 * midnight. Yesterday is never a day the client can still touch.
 *
 * Two statements, one per outcome, whatever the count. The per-plan DELETE
 * route hands one row; the client-level clear below hands every live program
 * with a day still ahead.
 */
export async function retireTrainingPlans(
  plans: RetirablePlan[],
  clientToday: string
): Promise<{ ended: string[]; archived: string[] }> {
  const now = new Date().toISOString();
  const ended = plans
    .filter((plan) => plan.effective_from < clientToday && plan.effective_until >= clientToday)
    .map((plan) => plan.id);
  const archived = plans
    .filter((plan) => plan.effective_from >= clientToday)
    .map((plan) => plan.id);

  if (ended.length > 0) {
    const { error } = await supabaseAdmin
      .from("training_plans")
      .update({ effective_until: addDaysToDateString(clientToday, -1), updated_at: now })
      .in("id", ended);
    if (error) throw new Error(`Failed to end the running program: ${error.message}`);
  }

  if (archived.length > 0) {
    const { error } = await supabaseAdmin
      .from("training_plans")
      .update({ status: "archived", updated_at: now })
      .in("id", archived);
    if (error) throw new Error(`Failed to retire the queued programs: ${error.message}`);
  }

  return { ended, archived };
}

/**
 * "Delete training plan": end the programs the client is on and remove their
 * upcoming sessions.
 *
 * One act, two callers — the training calendar's own delete (every program
 * with a day still ahead) and the block delete's "and its plans" (only the
 * ones placed inside it). There is no delete-the-days-but-keep-the-plan
 * variant on either track (owner, 2026-09-08): a plan left standing with no
 * days is restored by the next cascade, so the two always travel together.
 *
 * The nutrition cascade runs FROM the client's today, not from the deletion
 * floor: a regenerate REPLACES a day's targets rather than emptying them, so it
 * needs no floor. Only the event removal does.
 */
export async function clearTrainingPlansForClient(
  clientId: string,
  clientToday: string,
  /**
   * Optional block window. Given, only the programs PLACED INSIDE it go — a
   * plan belongs to a block when its start falls in the block's days, which is
   * a question dates answer on their own because placement truncates a program
   * to the block it is placed in. Omitted, every program with a day still
   * ahead goes: that is the training calendar's own delete.
   *
   * A program that merely CROSSES the block (placed before it existed, or
   * extended into it) belongs to no block and survives — the coach removes it
   * from the calendar, where they can see what they are removing.
   */
  window?: { from: string; to: string }
): Promise<{ plansCleared: number }> {
  const deleteFrom = await resolveEventDeletionFloor(clientId, clientToday);

  // Only programs with a day still ahead: a finished one is untouched history.
  let query = supabaseAdmin
    .from("training_plans")
    .select("id, effective_from, effective_until")
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .neq("status", "archived")
    .gte("effective_until", clientToday);
  if (window) {
    query = query.gte("effective_from", window.from).lte("effective_from", window.to);
  }
  const { data: plans, error } = await query;
  if (error) throw error;

  const rows = plans ?? [];
  await retireTrainingPlans(rows, clientToday);

  // The furthest day ANY of these programs had a session on. The nutrition
  // bound can no longer see them, and the cascade has to be told how far their
  // prescription reached or it leaves a stale training surplus on every day
  // past the bound.
  const clearedThrough = await cancelFutureEventsForPlans(
    rows.map((plan) => plan.id),
    deleteFrom
  );

  // Cascade once: nutrition burn estimates depend on training events. Open-ended
  // forward to the client's own bound, extended to cover every day the removal
  // above just cleared.
  await cascadeNutritionAfterTrainingChange(
    clientId,
    { kind: "from", from: clientToday, to: clearedThrough ?? undefined },
    "cascade-nutrition-events-from-clear-all-training"
  );

  return { plansCleared: rows.length };
}
