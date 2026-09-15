import { supabaseAdmin } from "./supabase-admin";
import { cancelFutureEventsForPlans } from "./training-event-service";
import { resolveEventDeletionFloor } from "./event-deletion-floor";
import { addDaysToDateString } from "@/lib/date-helpers";

/** The two columns the retire rule reads. */
type RetirablePlan = { id: string; effective_from: string; effective_until: string };

/** A program and the last day it keeps. */
type PlanEnd = RetirablePlan & { lastDay: string };

/**
 * End each program on its own last day — the window is the row (migration
 * 167), so moving `effective_until` IS ending it there.
 *
 * - A program that started on or before its last day and reaches past it is
 *   CAPPED there: its days up to it keep their program.
 * - A program that would start after its last day has no day left, never ran
 *   one of its own, and is ARCHIVED.
 * - A program already ending on or before its last day is not touched: a cap
 *   never lengthens a window.
 *
 * One cap statement per distinct last day, then one archive, whatever the
 * count. The delete ends everything at yesterday (below); a block trim ends
 * each plan on the day its block allows (`block-plan-trim-service.ts`). The
 * sessions are the caller's: they go first, so a failure here leaves the
 * window where a retry finds it.
 */
export async function endTrainingPlansAt(
  plans: PlanEnd[]
): Promise<{ ended: string[]; archived: string[] }> {
  const now = new Date().toISOString();
  const capped = plans.filter(
    (plan) => plan.effective_from <= plan.lastDay && plan.effective_until > plan.lastDay
  );
  const archived = plans
    .filter((plan) => plan.effective_from > plan.lastDay)
    .map((plan) => plan.id);

  for (const lastDay of new Set(capped.map((plan) => plan.lastDay))) {
    const { error } = await supabaseAdmin
      .from("training_plans")
      .update({ effective_until: lastDay, updated_at: now })
      .in(
        "id",
        capped.filter((plan) => plan.lastDay === lastDay).map((plan) => plan.id)
      );
    if (error) throw new Error(`Failed to end the running program: ${error.message}`);
  }

  if (archived.length > 0) {
    const { error } = await supabaseAdmin
      .from("training_plans")
      .update({ status: "archived", updated_at: now })
      .in("id", archived);
    if (error) throw new Error(`Failed to retire the queued programs: ${error.message}`);
  }

  return { ended: capped.map((plan) => plan.id), archived };
}

/**
 * End the programs a delete names — a delete is a save of nothing from today
 * (owner decision 2026-09-10): every program ends at YESTERDAY.
 *
 * - A RUNNING program — started before today, still reaching it — is capped
 *   at yesterday. Its past days keep their program, on the calendar and on
 *   every block it ran in, and every "now" read finds nothing from today.
 * - A QUEUED program — starting today or later — never ran a day of its own
 *   and is ARCHIVED. One that started today has no yesterday to end on and is
 *   archived too; the floor keeps a trained today's event for the client.
 * - A FINISHED program — ended before today — is history and is not touched.
 *
 * Yesterday rather than the deletion floor, deliberately: the floor spares a
 * today the client has already trained on, and a program closed AT that day
 * would keep covering it, so the hero would go on naming a deleted program
 * until midnight. Yesterday is never a day the client can still touch.
 *
 * The per-plan DELETE route hands one row; the client-level clear below hands
 * every live program with a day still ahead.
 */
export async function retireTrainingPlans(
  plans: RetirablePlan[],
  clientToday: string
): Promise<{ ended: string[]; archived: string[] }> {
  const yesterday = addDaysToDateString(clientToday, -1);
  return endTrainingPlansAt(plans.map((plan) => ({ ...plan, lastDay: yesterday })));
}

/**
 * "Delete training plan": end the programs the client is on and remove their
 * upcoming sessions.
 *
 * One act, two callers — the training calendar's own delete (every program
 * with a day still ahead) and the block delete, which always takes the
 * block's plans (only the ones inside it). There is no delete-the-days-but-keep-the-plan
 * variant on either track (owner, 2026-09-08): the plan and its upcoming
 * sessions always travel together.
 *
 * The nutrition days need no statement of their own: a day's target is
 * computed from the version covering it and the session on it, so the
 * sessions this removes re-price their days the moment they are gone.
 */
export async function clearTrainingPlansForClient(
  clientId: string,
  clientToday: string,
  /**
   * Optional block window. Given, only the programs that START inside it go —
   * a block contains its plans (placement is bounded by the block, and drawing
   * or shortening one trims its plans to fit), so the programs starting in its
   * days are the block's own. Omitted, every program with a day still ahead
   * goes: that is the training calendar's own delete.
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

  // Every retired program's forward ray from the floor, in one call.
  await cancelFutureEventsForPlans(
    rows.map((plan) => plan.id),
    deleteFrom
  );

  return { plansCleared: rows.length };
}
