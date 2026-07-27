import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString } from "@/services/today-service";

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

  // Conflict check: same training_session_id on the target date
  if (event.training_session_id) {
    const { data: conflict } = await supabaseAdmin
      .from("training_events")
      .select("id")
      .eq("client_id", clientId)
      .eq("training_session_id", event.training_session_id)
      .eq("date", newDate)
      .maybeSingle();

    if (conflict) {
      throw new Error("Session is already scheduled on this date");
    }
  }

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

  // Conflict check: same training_session_id on the target date
  if (source.training_session_id) {
    const { data: conflict } = await supabaseAdmin
      .from("training_events")
      .select("id")
      .eq("client_id", clientId)
      .eq("training_session_id", source.training_session_id)
      .eq("date", targetDate)
      .maybeSingle();

    if (conflict) {
      throw new Error("Session is already scheduled on this date");
    }
  }

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

  if (insertError || !newEvent) throw insertError ?? new Error("Failed to duplicate event");
  return newEvent.id;
}

/**
 * Update a single event's calorie_surplus_percentage. Used for the "Just this
 * day" scope when a coach edits the surplus for one specific date without
 * affecting the shared session's other occurrences.
 *
 * Sets is_modified=true so regeneration doesn't overwrite this edit.
 * Nutrition cascade reads surplus from events, not sessions, so this update
 * alone is sufficient for that day's nutrition to recompute correctly on the
 * next cascade.
 */
export async function updateEventSurplus(
  eventId: string,
  surplus: number | null,
  clientId: string,
): Promise<{ date: string }> {
  // Scope the UPDATE to the caller's client so a foreign eventId matches zero rows
  // and is never mutated (previously the row was written first and ownership was
  // only checked afterwards — a cross-tenant write-then-verify).
  const { data, error } = await supabaseAdmin
    .from("training_events")
    .update({
      calorie_surplus_percentage: surplus,
      is_modified: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", eventId)
    .eq("client_id", clientId)
    .select("date")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update event surplus: ${error.message}`);
  }
  if (!data) {
    // No row matched: unknown event or it belongs to another client.
    throw new Error("Event not found");
  }

  return { date: data.date };
}

/**
 * Delete a single scheduled training event.
 * Only future scheduled events can be deleted.
 */
export async function deleteEvent(
  eventId: string,
  clientId: string,
  planId: string
): Promise<void> {
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
}
