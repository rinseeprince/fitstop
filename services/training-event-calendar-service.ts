import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString } from "@/services/today-service";
import { assertDateFree, rethrowIfDateOccupied } from "./training-event-occupancy";

/**
 * Move a single training event to a new date. The only move there is — the
 * "this and all future X sessions" scope was removed because it matched
 * siblings by `training_session_id`, and whole-program placement gives every
 * day its own cloned session row, so the sibling set was never more than the
 * dragged event itself.
 *
 * Sets is_modified, which drives the calendar card's edited badge. It is NOT a
 * write predicate: the amendment rewrite deletes and re-lays future scheduled
 * events without consulting it.
 *
 * A move writes ONLY the event, and never the plan's day-slots. That is the
 * model, not an oversight. Under events-as-SOT (CONVENTIONS §8) the event
 * carries the date-specific truth and `training_sessions` is a blueprint, so a
 * plan whose slot order no longer matches the calendar is a blueprint that has
 * been superseded for those dates — not two sources of truth disagreeing.
 *
 * The two only meet when a coach saves an amendment, which re-lays the future
 * from the slots. That moment is already guarded: the confirm dialog itemises
 * every is_modified future event by date and name and lets the coach cancel
 * (amend-plan-dialogs.tsx:67-91). Nothing else can surface a contradiction,
 * because the plan editor is positional — "Week 3 · Day 5", never a weekday —
 * and the ONLY date formatting anywhere in program-builder/ is inside that
 * dialog. The calendar owns dated, tactical edits; the editor owns structural
 * ones; one re-lay warning is the whole coupling between them.
 *
 * Writing moves back into the slot coordinates was designed in full and
 * rejected (owner decision, 2026-07-27): it inverts the model by making the
 * blueprint chase the events, and it buys nothing a coach can see. Do not
 * rebuild it. If it is ever revisited, two findings from that pass are worth
 * keeping: distinct (week_index, order_index) pairs — not a canonical grid —
 * are the necessary condition for a coordinate swap to be position-preserving,
 * and a single CASE-expression UPDATE inside an RPC is the only atomic way to
 * perform one, since a two-statement swap that half-fails leaves duplicate
 * coordinates that nothing detects.
 */
export async function moveEvent(
  eventId: string,
  newDate: string,
  clientId: string,
  planId: string
): Promise<{ sourceDate: string; targetDate: string }> {
  const { data: event, error } = await supabaseAdmin
    .from("training_events")
    .select("*")
    .eq("id", eventId)
    .single();

  if (error || !event) throw new Error("Event not found");
  if (event.client_id !== clientId || event.training_plan_id !== planId) {
    throw new Error("Event does not belong to this client/plan");
  }
  if (event.status !== "scheduled") {
    throw new Error("Only scheduled events can be moved");
  }

  const today = await getClientTodayString(clientId);
  if (newDate < today) {
    throw new Error("Cannot move event to a past date");
  }

  // One session per day. The old check here matched on training_session_id and
  // could therefore never fire — see training-event-occupancy.ts.
  await assertDateFree(clientId, newDate, eventId);

  const { error: updateError } = await supabaseAdmin
    .from("training_events")
    .update({
      date: newDate,
      is_modified: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", eventId);

  if (updateError) throw updateError;

  return { sourceDate: event.date, targetDate: newDate };
}

/**
 * Duplicate a training event to a new date.
 * The new event is marked as is_modified.
 */
export async function duplicateEvent(
  sourceEventId: string,
  targetDate: string,
  clientId: string,
  planId: string
): Promise<string> {
  const { data: source, error } = await supabaseAdmin
    .from("training_events")
    .select("*")
    .eq("id", sourceEventId)
    .single();

  if (error || !source) throw new Error("Source event not found");
  if (source.client_id !== clientId || source.training_plan_id !== planId) {
    throw new Error("Event does not belong to this client/plan");
  }

  const today = await getClientTodayString(clientId);
  if (targetDate < today) {
    throw new Error("Cannot duplicate event to a past date");
  }

  // One session per day — the old training_session_id check could never fire.
  await assertDateFree(clientId, targetDate);

  const { data: newEvent, error: insertError } = await supabaseAdmin
    .from("training_events")
    .insert({
      client_id: source.client_id,
      training_plan_id: source.training_plan_id,
      training_session_id: source.training_session_id,
      session_name: source.session_name,
      session_focus: source.session_focus,
      estimated_calories: source.estimated_calories,
      // Load-bearing: the nutrition cascade reads surplus % from the event.
      // Omitting it leaves the duplicated event with NULL, which falls through
      // to rest-day calories even though the TRAIN badge still renders (the
      // badge is driven by event presence, the calorie bump by surplus value).
      calorie_surplus_percentage: source.calorie_surplus_percentage,
      date: targetDate,
      status: "scheduled",
      is_modified: true,
    })
    .select("id")
    .single();

  if (insertError || !newEvent) {
    rethrowIfDateOccupied(insertError, targetDate);
    throw insertError ?? new Error("Failed to duplicate event");
  }
  return newEvent.id;
}

/**
 * Delete a single scheduled training event.
 * Only future scheduled events can be deleted.
 *
 * Returns the deleted event's date so the caller can cascade nutrition over
 * exactly that day instead of anchoring at today and rewriting the horizon.
 */
export async function deleteEvent(
  eventId: string,
  clientId: string,
  planId: string
): Promise<{ date: string }> {
  const { data: event, error } = await supabaseAdmin
    .from("training_events")
    .select("*")
    .eq("id", eventId)
    .single();

  if (error || !event) throw new Error("Event not found");
  if (event.client_id !== clientId || event.training_plan_id !== planId) {
    throw new Error("Event does not belong to this client/plan");
  }
  if (event.status !== "scheduled") {
    throw new Error("Only scheduled events can be deleted");
  }

  const today = await getClientTodayString(clientId);
  if (event.date < today) {
    throw new Error("Cannot delete past events");
  }

  const { error: deleteError } = await supabaseAdmin
    .from("training_events")
    .delete()
    .eq("id", eventId);
  if (deleteError) throw new Error(`Failed to delete event: ${deleteError.message}`);

  return { date: event.date };
}
