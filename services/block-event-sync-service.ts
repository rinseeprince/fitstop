import { supabaseAdmin } from "./supabase-admin";
import { addDaysToDateString } from "@/lib/date-helpers";
import { deleteNutritionDayEditsInRanges } from "./nutrition-day-edits-service";
import { resolveEventDeletionFloor } from "./event-deletion-floor";

/**
 * Bringing a client's calendar in line with a block the coach has just
 * SHORTENED.
 *
 * A block edit still writes NOTHING on its own — this runs only when the coach
 * picks "Clear those days" out of the confirm dialog, and it is the whole of
 * what that dialog offers. A block's end moves earlier or not at all (more
 * time is a new block after it, with its own program and targets), so the one
 * act here is the clear: remove the scheduled sessions that now sit outside
 * the block and pull both tracks' windows back to it. It reconciles rather
 * than replaying a diff, so it needs no memory of the old window and
 * re-running it is idempotent.
 *
 * The past and everything trained are left alone, the same way every other
 * training clear in the product does it: removals start at the deletion floor,
 * never a completed or missed row.
 */

/** Where a clear may reach: the day before the next block, else the last event. */
async function clearCeiling(
  clientId: string,
  blockEndsOn: string
): Promise<string | null> {
  const { data: nextBlock } = await supabaseAdmin
    .from("client_phases")
    .select("starts_on")
    .eq("client_id", clientId)
    .gt("starts_on", blockEndsOn)
    .order("starts_on", { ascending: true })
    .limit(1)
    .maybeSingle();

  // Bounded by the next block so a clear can never reach into a window this
  // block does not own — the coach asked about THIS block's days.
  if (nextBlock?.starts_on) return addDaysToDateString(nextBlock.starts_on, -1);

  // Else the last session past the block. Nutrition has no row past a block
  // to reach: its days are computed from the versions, and the caps below pull
  // those back to the block's end on their own.
  const { data: lastTraining } = await supabaseAdmin
    .from("training_events")
    .select("date")
    .eq("client_id", clientId)
    .gt("date", blockEndsOn)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return lastTraining?.date ?? null;
}

/**
 * Remove the scheduled training sessions in [from, to], and deactivate the
 * slot rows behind them.
 *
 * The slots matter as much as the events: the plan's active rows are its
 * blueprint, so rows left active past its end would describe days the window
 * no longer has.
 *
 * Floored at the deletion floor and scoped to `status = 'scheduled'`, so the
 * past and everything trained survive — the same two guards every other
 * training removal in the product uses.
 */
export async function clearScheduledEvents(params: {
  clientId: string;
  clientToday: string;
  from: string;
  to: string;
}): Promise<{ trainingCleared: number }> {
  const { clientId, clientToday, to } = params;
  const floor = await resolveEventDeletionFloor(clientId, clientToday);
  const from = params.from > floor ? params.from : floor;
  if (to < from) return { trainingCleared: 0 };

  const { data: removedTraining, error: trainingError } = await supabaseAdmin
    .from("training_events")
    .delete()
    .eq("client_id", clientId)
    .gte("date", from)
    .lte("date", to)
    .eq("status", "scheduled")
    .select("training_session_id");
  if (trainingError) throw trainingError;

  const orphanedSlots = (removedTraining ?? [])
    .map((row) => row.training_session_id)
    .filter((id): id is string => typeof id === "string");

  if (orphanedSlots.length > 0) {
    const { error: slotError } = await supabaseAdmin
      .from("training_sessions")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .in("id", orphanedSlots);
    if (slotError) throw slotError;
  }

  return { trainingCleared: removedTraining?.length ?? 0 };
}

/**
 * The shorten arm: clear the sessions that have LEFT the block — everything
 * after its new end, bounded so the clear can never reach a window this block
 * does not own.
 *
 * The nutrition VERSIONS follow the block (migration 166), and so do the
 * training PROGRAMS (migration 167). A version's end is stored and its days
 * are computed from it, so pulling one that reaches past the block's new end
 * back to that end IS removing those days; a queued version that now starts
 * in the cleared stretch is retired with them. A version crossing into the
 * NEXT block is pulled back too; the days it leaves behind there belong to
 * that block's own setup. The coach's hand edits on the days this uncovers
 * go with them (owner decision 2026-09-10) — the same one-statement delete
 * the plan delete issues, read off the versions before they move and run
 * before they do, so a failure leaves the versions whole for the retry.
 */
export async function clearEventsOutsideBlock(params: {
  clientId: string;
  clientToday: string;
  blockEndsOn: string;
}): Promise<{ trainingCleared: number }> {
  const { clientId, clientToday, blockEndsOn } = params;

  const ceiling = await clearCeiling(clientId, blockEndsOn);
  const cleared = ceiling
    ? await clearScheduledEvents({
        clientId,
        clientToday,
        from: addDaysToDateString(blockEndsOn, 1),
        to: ceiling,
      })
    : { trainingCleared: 0 };

  // The versions this cuts, read BEFORE they move: one reaching past the new
  // end loses the days past it, one queued in the cleared stretch loses its
  // whole window — exactly the two predicates the cap and the retirement below
  // apply. Their hand edits on those days go first.
  const { data: cut, error: cutError } = await supabaseAdmin
    .from("nutrition_plans")
    .select("id, effective_from, effective_until")
    .eq("client_id", clientId)
    .eq("status", "active")
    .gt("effective_until", blockEndsOn)
    .lte("effective_from", ceiling ?? blockEndsOn);
  if (cutError) throw cutError;
  await deleteNutritionDayEditsInRanges(
    clientId,
    (cut ?? []).map((version) => ({
      from:
        version.effective_from > blockEndsOn
          ? version.effective_from
          : addDaysToDateString(blockEndsOn, 1),
      to: version.effective_until,
    }))
  );

  const now = new Date().toISOString();
  const { error: capError } = await supabaseAdmin
    .from("nutrition_plans")
    .update({ effective_until: blockEndsOn, updated_at: now })
    .eq("client_id", clientId)
    .eq("status", "active")
    .lte("effective_from", blockEndsOn)
    .gt("effective_until", blockEndsOn);
  if (capError) throw capError;

  if (ceiling) {
    const { error: retireError } = await supabaseAdmin
      .from("nutrition_plans")
      .update({ status: "archived", updated_at: now })
      .eq("client_id", clientId)
      .eq("status", "active")
      .gt("effective_from", blockEndsOn)
      .lte("effective_from", ceiling);
    if (retireError) throw retireError;
  }

  // The training programs follow their days too (migration 167): one reaching
  // past the new end is pulled back to it, and one queued to start in the
  // cleared stretch — its every day just removed — is archived.
  const { error: trainingCapError } = await supabaseAdmin
    .from("training_plans")
    .update({ effective_until: blockEndsOn, updated_at: now })
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .neq("status", "archived")
    .lte("effective_from", blockEndsOn)
    .gt("effective_until", blockEndsOn);
  if (trainingCapError) throw trainingCapError;

  if (ceiling) {
    const { error: trainingRetireError } = await supabaseAdmin
      .from("training_plans")
      .update({ status: "archived", updated_at: now })
      .eq("client_id", clientId)
      .is("deleted_at", null)
      .neq("status", "archived")
      .gt("effective_from", blockEndsOn)
      .lte("effective_from", ceiling);
    if (trainingRetireError) throw trainingRetireError;
  }

  return cleared;
}
