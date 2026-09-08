import { supabaseAdmin } from "./supabase-admin";
import { archiveTrainingPlan } from "./training-service";
import { cancelFutureEventsForPlan } from "./training-event-service";
import { cascadeNutritionAfterTrainingChange } from "./nutrition-event-service";
import { resolveEventDeletionFloor } from "./event-deletion-floor";

/**
 * "Delete training plan": retire every program the client is on and remove
 * their upcoming sessions.
 *
 * One act, two callers — the training calendar's own delete and the block
 * delete's "and its plans". There is no delete-the-days-but-keep-the-plan
 * variant on either track (owner, 2026-09-08): a plan left standing with no days
 * is restored by the next cascade, so the two always travel together.
 *
 * The nutrition cascade runs FROM the client's today, not from the deletion
 * floor: a regenerate REPLACES a day's targets rather than emptying them, so it
 * needs no floor. Only the event removal does.
 */
export async function clearAllTrainingPlansForClient(
  clientId: string,
  clientToday: string
): Promise<{ plansCleared: number }> {
  const deleteFrom = await resolveEventDeletionFloor(clientId, clientToday);

  const { data: plans, error } = await supabaseAdmin
    .from("training_plans")
    .select("id")
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .neq("status", "archived");
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
