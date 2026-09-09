import { supabaseAdmin } from "./supabase-admin";
import { archiveTrainingPlan } from "./training-service";
import { cancelFutureEventsForPlan } from "./training-event-service";
import { cascadeNutritionAfterTrainingChange } from "./nutrition-event-service";
import { resolveEventDeletionFloor } from "./event-deletion-floor";

/**
 * "Delete training plan": retire every program the client is on and remove
 * their upcoming sessions.
 *
 * One act, two callers — the training calendar's own delete (every live program)
 * and the block delete's "and its plans" (only the ones placed inside it).
 * There is no delete-the-days-but-keep-the-plan variant on either track (owner,
 * 2026-09-08): a plan left standing with no days is restored by the next
 * cascade, so the two always travel together.
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
   * to the block it is placed in. Omitted, every live program goes: that is the
   * training calendar's own delete.
   *
   * A program that merely CROSSES the block (placed before it existed, or
   * extended into it) belongs to no block and survives — the coach removes it
   * from the calendar, where they can see what they are removing.
   */
  window?: { from: string; to: string }
): Promise<{ plansCleared: number }> {
  const deleteFrom = await resolveEventDeletionFloor(clientId, clientToday);

  let query = supabaseAdmin
    .from("training_plans")
    .select("id")
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .neq("status", "archived");
  if (window) {
    query = query.gte("effective_from", window.from).lte("effective_from", window.to);
  }
  const { data: plans, error } = await query;
  if (error) throw error;

  // The furthest day ANY of these plans had an event on. Every one of them is
  // archived by the loop, so the nutrition horizon can no longer see them, and
  // the cascade has to be told how far their prescription reached or it leaves a
  // stale training surplus on every day past the horizon.
  let clearedThrough: string | null = null;
  for (const plan of plans ?? []) {
    await archiveTrainingPlan(plan.id);
    const cleared = await cancelFutureEventsForPlan(plan.id, deleteFrom);
    if (cleared !== null && (clearedThrough === null || cleared > clearedThrough)) {
      clearedThrough = cleared;
    }
  }

  // Cascade once: nutrition burn estimates depend on training events. Open-ended
  // forward to the client's own horizon, extended to cover every day the loop
  // above just cleared.
  await cascadeNutritionAfterTrainingChange(
    clientId,
    { kind: "from", from: clientToday, to: clearedThrough ?? undefined },
    "cascade-nutrition-events-from-clear-all-training"
  );

  return { plansCleared: plans?.length ?? 0 };
}
