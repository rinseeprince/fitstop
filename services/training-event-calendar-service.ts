import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString } from "@/services/today-service";
import {
  assertDateFree,
  DateOccupiedError,
  occupiedMessage,
  rethrowIfDateOccupied,
} from "./training-event-occupancy";
import { readMoveRpcError, type MoveRpcError } from "./training-event-layout-service";

/** The coach's calendar is stale: the session moved since it loaded. The route answers 409. */
export class CalendarMoveDriftError extends Error {}
/** An event that does not exist for this client and plan. The route answers 404 (no existence oracle). */
export class CalendarMoveNotFoundError extends Error {}

const MOVE_DRIFT_MESSAGE =
  "This session moved since your calendar loaded. The calendar now shows where it is.";

/**
 * Move a single scheduled training event to a new date — the coach's calendar
 * drag.
 *
 * A move writes ONLY the event, never the plan's session rows. Under
 * events-as-SOT (CONVENTIONS §8) the event carries the date and the session
 * rows are the program's blueprint, so a plan whose slot order differs from
 * the calendar is a blueprint superseded for those dates, not two sources of
 * truth disagreeing.
 *
 * The write goes through `move_training_events_atomic` (migration 150), the
 * same database function as the client's week view
 * (`training-event-layout-service.ts`). Each side keeps its own rules, and the
 * coach's are checked here. `fromDate` is the day the coach's calendar showed
 * the session on: it is checked here and re-checked by the function under a
 * row lock, so a drag racing the client's own move is refused rather than
 * applied to a session that has left that day. The function also sets
 * is_modified, which drives the calendar card's edited badge.
 */
export async function moveEvent(
  eventId: string,
  fromDate: string,
  newDate: string,
  clientId: string,
  planId: string
): Promise<void> {
  const { data: event, error } = await supabaseAdmin
    .from("training_events")
    .select("*")
    .eq("id", eventId)
    .single();

  if (error || !event) throw new CalendarMoveNotFoundError("Event not found");
  if (event.client_id !== clientId || event.training_plan_id !== planId) {
    throw new CalendarMoveNotFoundError("Event does not belong to this client/plan");
  }
  if (event.status !== "scheduled") {
    throw new Error("Only scheduled events can be moved");
  }
  // The client moves sessions from their own week view, so a calendar loaded
  // before that move would drag the session from a day it has already left.
  if (event.date !== fromDate) throw new CalendarMoveDriftError(MOVE_DRIFT_MESSAGE);

  const today = await getClientTodayString(clientId);
  if (newDate < today) {
    throw new Error("Cannot move event to a past date");
  }

  // One session per day. The old check here matched on training_session_id and
  // could therefore never fire — see training-event-occupancy.ts.
  await assertDateFree(clientId, newDate, eventId);

  const { error: rpcError } = await supabaseAdmin.rpc("move_training_events_atomic", {
    p_client_id: clientId,
    p_moves: [{ event_id: eventId, from_date: fromDate, to_date: newDate }],
  });
  if (rpcError) throw translateMoveRpcError(rpcError);
}

/**
 * The function's refusal in the coach's sentences. A duplicate takes two moves,
 * so a single drag cannot raise one; it fails like an unrecognised refusal.
 */
function translateMoveRpcError(error: MoveRpcError): Error {
  const failure = readMoveRpcError(error);
  switch (failure.kind) {
    case "drift":
      return new CalendarMoveDriftError(MOVE_DRIFT_MESSAGE);
    case "occupied":
      return new DateOccupiedError(occupiedMessage(failure.date));
    case "not_found":
      return new CalendarMoveNotFoundError("Event not found");
    case "not_scheduled":
      return new Error("Only scheduled events can be moved");
    case "duplicate":
    case "other":
      return new Error(`Failed to move event: ${error.message ?? ""}`);
  }
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
