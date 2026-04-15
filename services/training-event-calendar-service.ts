import { supabaseAdmin } from "./supabase-admin";
import { regenerateFutureEvents, getEventsForDateRange } from "./training-event-service";
import { getTodayDateString, getDateString } from "@/lib/date-helpers";
import type { Json } from "@/types/database";

/**
 * Move a single training event to a new date.
 * Marks the event as is_modified so regeneration preserves it.
 */
export async function moveEvent(
  eventId: string,
  newDate: string,
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
    throw new Error("Only scheduled events can be moved");
  }

  const today = getTodayDateString();
  if (newDate < today) {
    throw new Error("Cannot move event to a past date");
  }

  // Phase boundary check
  await validatePhaseBounds(planId, newDate);

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
}

/**
 * Move a single event and update the template session's day_of_week,
 * then regenerate all future events from the day after the dragged event.
 */
export async function moveEventAndFuture(
  trainingSessionId: string,
  newDayOfWeek: string,
  clientId: string,
  planId: string,
  draggedEventId: string,
  draggedNewDate: string
): Promise<void> {
  // Update the template session's day_of_week
  const { error: sessionError } = await supabaseAdmin
    .from("training_sessions")
    .update({ day_of_week: newDayOfWeek })
    .eq("id", trainingSessionId);

  if (sessionError) throw sessionError;

  // Update the dragged event directly
  const { error: eventError } = await supabaseAdmin
    .from("training_events")
    .update({
      date: draggedNewDate,
      is_modified: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", draggedEventId);

  if (eventError) throw eventError;

  // Regenerate from the day after the dragged event with force=true
  const dayAfter = new Date(draggedNewDate + "T00:00:00");
  dayAfter.setDate(dayAfter.getDate() + 1);
  const effectiveFrom = getDateString(dayAfter);

  await regenerateFutureEvents(clientId, planId, effectiveFrom, true);
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

  const today = getTodayDateString();
  if (targetDate < today) {
    throw new Error("Cannot duplicate event to a past date");
  }

  // Phase boundary check
  await validatePhaseBounds(planId, targetDate);

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
 * Count future scheduled events that have been manually modified (moved/duplicated).
 */
export async function countModifiedFutureEvents(
  clientId: string,
  planId: string
): Promise<number> {
  const today = getTodayDateString();

  const { count, error } = await supabaseAdmin
    .from("training_events")
    .select("*", { count: "exact", head: true })
    .eq("training_plan_id", planId)
    .eq("client_id", clientId)
    .eq("is_modified", true)
    .eq("status", "scheduled")
    .gte("date", today);

  if (error) throw error;
  return count ?? 0;
}

/**
 * Duplicate an entire week of training events to a target week.
 * Clones sessions and exercises so each week is independent.
 */
export async function duplicateWeek(
  clientId: string,
  planId: string,
  sourceStartDate: string,
  targetStartDate: string
): Promise<{ eventsCreated: number }> {
  // Fetch source week events (7 days)
  const sourceEnd = new Date(sourceStartDate + "T00:00:00");
  sourceEnd.setDate(sourceEnd.getDate() + 6);
  const sourceEndDate = getDateString(sourceEnd);

  const sourceEvents = await getEventsForDateRange(clientId, sourceStartDate, sourceEndDate);
  const scheduledEvents = sourceEvents.filter(
    (e) => e.status === "scheduled" && e.trainingSessionId
  );

  if (scheduledEvents.length === 0) return { eventsCreated: 0 };

  // Validate target week falls within phase bounds
  const targetEnd = new Date(targetStartDate + "T00:00:00");
  targetEnd.setDate(targetEnd.getDate() + 6);
  await validatePhaseBounds(planId, targetStartDate);
  await validatePhaseBounds(planId, getDateString(targetEnd));

  // Deduplicate sessions (multiple events could share a session)
  const sessionIds = [...new Set(scheduledEvents.map((e) => e.trainingSessionId!))];

  // Fetch all source sessions with exercises in one query per session
  const sessionDataMap = new Map<string, {
    session: Record<string, unknown>;
    exercises: Record<string, unknown>[];
  }>();

  for (const sessionId of sessionIds) {
    const { data: session, error: sessionError } = await supabaseAdmin
      .from("training_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("is_active", true)
      .single();

    if (sessionError || !session) continue;

    const { data: exercises } = await supabaseAdmin
      .from("training_exercises")
      .select("*")
      .eq("session_id", sessionId)
      .eq("is_active", true)
      .order("order_index", { ascending: true });

    sessionDataMap.set(sessionId, { session, exercises: exercises || [] });
  }

  // Clone sessions and exercises, then create events
  const sourceStart = new Date(sourceStartDate + "T00:00:00");
  const targetStart = new Date(targetStartDate + "T00:00:00");
  // Map from original session ID to cloned session ID (within this week)
  const clonedSessionMap = new Map<string, string>();
  let eventsCreated = 0;

  for (const event of scheduledEvents) {
    const sourceData = sessionDataMap.get(event.trainingSessionId!);
    if (!sourceData) continue;

    // Clone session (once per unique session ID)
    let clonedSessionId = clonedSessionMap.get(event.trainingSessionId!);
    if (!clonedSessionId) {
      const { session } = sourceData;
      const { data: clonedSession, error: cloneError } = await supabaseAdmin
        .from("training_sessions")
        .insert({
          plan_id: session.plan_id as string,
          name: session.name as string,
          day_of_week: null, // Calendar-placed sessions don't use template day matching
          order_index: session.order_index as number,
          focus: session.focus as string | null,
          notes: session.notes as string | null,
          estimated_duration_minutes: session.estimated_duration_minutes as number | null,
          session_type: session.session_type as string,
          activity_metadata: session.activity_metadata as Json | null,
          estimated_calories: session.estimated_calories as number | null,
          calories_calculated_at: session.calories_calculated_at as string | null,
          is_active: true,
        })
        .select("id")
        .single();

      if (cloneError || !clonedSession) {
        throw new Error(`Failed to clone session: ${cloneError?.message}`);
      }

      clonedSessionId = clonedSession.id;
      clonedSessionMap.set(event.trainingSessionId!, clonedSessionId);

      // Clone exercises for this session
      const { exercises } = sourceData;
      if (exercises.length > 0) {
        const exerciseInserts = exercises.map((ex) => ({
          session_id: clonedSessionId!,
          name: ex.name as string,
          exercise_id: ex.exercise_id as string | null, // Preserve catalog FK directly
          order_index: ex.order_index as number,
          sets: ex.sets as number,
          reps_min: ex.reps_min as number | null,
          reps_max: ex.reps_max as number | null,
          reps_target: ex.reps_target as string | null,
          rpe_target: ex.rpe_target as number | null,
          percentage_1rm: ex.percentage_1rm as number | null,
          tempo: ex.tempo as string | null,
          rest_seconds: ex.rest_seconds as number | null,
          notes: ex.notes as string | null,
          superset_group: ex.superset_group as string | null,
          is_warmup: ex.is_warmup as boolean,
          is_active: true,
        }));

        const { error: exError } = await supabaseAdmin
          .from("training_exercises")
          .insert(exerciseInserts);

        if (exError) throw new Error(`Failed to clone exercises: ${exError.message}`);
      }
    }

    // Calculate target date: offset from source week start
    const eventDate = new Date(event.date + "T00:00:00");
    const dayOffset = Math.round(
      (eventDate.getTime() - sourceStart.getTime()) / (1000 * 60 * 60 * 24)
    );
    const targetDate = new Date(targetStart);
    targetDate.setDate(targetDate.getDate() + dayOffset);
    const targetDateStr = getDateString(targetDate);

    // Insert new event
    const { error: eventError } = await supabaseAdmin
      .from("training_events")
      .insert({
        client_id: clientId,
        training_plan_id: planId,
        training_session_id: clonedSessionId,
        date: targetDateStr,
        session_name: event.sessionName,
        session_focus: event.sessionFocus,
        estimated_calories: event.estimatedCalories,
        status: "scheduled",
        is_modified: true,
      });

    if (eventError) throw new Error(`Failed to create event: ${eventError.message}`);
    eventsCreated++;
  }

  return { eventsCreated };
}

/**
 * Duplicate a source week to all remaining weeks until the phase end date.
 */
export async function duplicateWeekToRemaining(
  clientId: string,
  planId: string,
  sourceStartDate: string,
  phaseEndDate: string
): Promise<{ weeksCreated: number; eventsCreated: number }> {
  const sourceStart = new Date(sourceStartDate + "T00:00:00");
  const endDate = new Date(phaseEndDate + "T00:00:00");

  let weeksCreated = 0;
  let totalEventsCreated = 0;

  // Iterate week by week starting from sourceStartDate + 7
  const currentWeekStart = new Date(sourceStart);
  currentWeekStart.setDate(currentWeekStart.getDate() + 7);

  while (currentWeekStart <= endDate) {
    const targetStartDate = getDateString(currentWeekStart);
    const result = await duplicateWeek(clientId, planId, sourceStartDate, targetStartDate);
    if (result.eventsCreated > 0) weeksCreated++;
    totalEventsCreated += result.eventsCreated;
    currentWeekStart.setDate(currentWeekStart.getDate() + 7);
  }

  return { weeksCreated, eventsCreated: totalEventsCreated };
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

  const today = getTodayDateString();
  if (event.date < today) {
    throw new Error("Cannot delete past events");
  }

  const { error: deleteError } = await supabaseAdmin
    .from("training_events")
    .delete()
    .eq("id", eventId);
  if (deleteError) throw new Error(`Failed to delete event: ${deleteError.message}`);
}

// --- Helpers ---

/**
 * Validate that a target date falls within the plan's phase boundaries.
 * Only enforced when the plan has a phase_id with defined date bounds.
 */
export async function validatePhaseBounds(planId: string, targetDate: string): Promise<void> {
  const { data: plan } = await supabaseAdmin
    .from("training_plans")
    .select("phase_id")
    .eq("id", planId)
    .single();

  if (!plan?.phase_id) return;

  const { data: phase } = await supabaseAdmin
    .from("phases")
    .select("start_date, end_date")
    .eq("id", plan.phase_id)
    .single();

  if (!phase) return;

  if (phase.start_date && targetDate < phase.start_date) {
    throw new Error("Target date is outside the current phase");
  }
  if (phase.end_date && targetDate > phase.end_date) {
    throw new Error("Target date is outside the current phase");
  }
}
