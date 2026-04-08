import { supabaseAdmin } from "./supabase-admin";
import type { TrainingEvent, TrainingEventStatus } from "@/types/training";
import type { TrainingEventRow, TrainingEventInsert } from "@/lib/database-helpers";
import { getTodayDateString, getDateString, DAY_NUM } from "@/lib/date-helpers";

// --- Row mapper ---

function mapEventRow(row: TrainingEventRow): TrainingEvent {
  return {
    id: row.id,
    clientId: row.client_id,
    trainingPlanId: row.training_plan_id,
    trainingSessionId: row.training_session_id,
    date: row.date,
    sessionName: row.session_name,
    sessionFocus: row.session_focus,
    estimatedCalories: row.estimated_calories,
    status: row.status as TrainingEventStatus,
    sessionLogId: row.session_log_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- Session input type (narrower than full TrainingSession) ---

type SessionInput = {
  id: string;
  name: string;
  dayOfWeek?: string;
  sessionType: string;
  focus?: string;
  estimatedCalories?: number;
};

// --- Generate events ---

/**
 * Generate training events for a plan within a date range.
 * Creates one event row per training session per matching date.
 * Uses upsert with ignoreDuplicates to safely handle re-runs.
 */
export async function generateTrainingEvents(
  clientId: string,
  planId: string,
  sessions: SessionInput[],
  startDate: string,
  endDate: string
): Promise<void> {
  // Filter to training sessions with a day assigned
  const trainingSessions = sessions.filter(
    (s) => s.sessionType === "training" && s.dayOfWeek
  );

  if (trainingSessions.length === 0) return;

  // Build dayNumber → sessions[] map
  const dayMap = new Map<number, SessionInput[]>();
  for (const session of trainingSessions) {
    const dayNum = DAY_NUM[session.dayOfWeek!.toLowerCase()];
    if (dayNum === undefined) continue;
    const existing = dayMap.get(dayNum) ?? [];
    existing.push(session);
    dayMap.set(dayNum, existing);
  }

  // Iterate dates and build insert rows
  const rows: TrainingEventInsert[] = [];
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const sessionsForDay = dayMap.get(d.getDay());
    if (!sessionsForDay) continue;

    const dateStr = getDateString(d);
    for (const session of sessionsForDay) {
      rows.push({
        client_id: clientId,
        training_plan_id: planId,
        training_session_id: session.id,
        date: dateStr,
        session_name: session.name,
        session_focus: session.focus ?? null,
        estimated_calories: session.estimatedCalories ?? null,
        status: "scheduled",
      });
    }
  }

  if (rows.length === 0) return;

  const { error } = await supabaseAdmin
    .from("training_events")
    .upsert(rows, {
      onConflict: "client_id,training_session_id,date",
      ignoreDuplicates: true,
    });

  if (error) throw error;
}

// --- Regenerate future events ---

/**
 * Delete future scheduled events for a plan and regenerate from current sessions.
 * Past events and non-scheduled events (completed, partial, missed, skipped) are preserved.
 */
export async function regenerateFutureEvents(
  clientId: string,
  planId: string
): Promise<void> {
  const today = getTodayDateString();

  // Delete future scheduled events only
  const { error: deleteError } = await supabaseAdmin
    .from("training_events")
    .delete()
    .eq("training_plan_id", planId)
    .gte("date", today)
    .eq("status", "scheduled");

  if (deleteError) throw deleteError;

  // Fetch current active sessions
  const { data: sessionRows, error: sessionsError } = await supabaseAdmin
    .from("training_sessions")
    .select("id, name, day_of_week, session_type, focus, estimated_calories")
    .eq("plan_id", planId)
    .eq("is_active", true);

  if (sessionsError) throw sessionsError;
  if (!sessionRows || sessionRows.length === 0) return;

  const sessions: SessionInput[] = sessionRows.map((r) => ({
    id: r.id,
    name: r.name,
    dayOfWeek: r.day_of_week ?? undefined,
    sessionType: r.session_type ?? "training",
    focus: r.focus ?? undefined,
    estimatedCalories: r.estimated_calories ?? undefined,
  }));

  // Calculate end date
  const endDate = await calculateEndDate(planId, today);
  if (!endDate || endDate <= today) return;

  await generateTrainingEvents(clientId, planId, sessions, today, endDate);
}

// --- Calculate end date ---

async function calculateEndDate(
  planId: string,
  today: string
): Promise<string | null> {
  // Fetch plan for duration info
  const { data: plan, error: planError } = await supabaseAdmin
    .from("training_plans")
    .select("effective_from, program_duration_weeks, phase_id")
    .eq("id", planId)
    .single();

  if (planError || !plan) return fallbackEndDate(today);

  // Branch 1: program_duration_weeks is set
  if (plan.program_duration_weeks) {
    const start = new Date((plan.effective_from ?? today) + "T00:00:00");
    start.setDate(start.getDate() + plan.program_duration_weeks * 7);
    return getDateString(start);
  }

  // Branch 2: phase_id is set
  if (plan.phase_id) {
    const { data: phase, error: phaseError } = await supabaseAdmin
      .from("phases")
      .select("end_date, start_date, duration_weeks")
      .eq("id", plan.phase_id)
      .maybeSingle();

    // Sub-branch 2d: phase not found (dangling FK)
    if (phaseError || !phase) return fallbackEndDate(today);

    // Sub-branch 2a: phase has end_date
    if (phase.end_date) return phase.end_date;

    // Sub-branch 2b: phase has start_date + duration_weeks
    if (phase.start_date && phase.duration_weeks) {
      const start = new Date(phase.start_date + "T00:00:00");
      start.setDate(start.getDate() + phase.duration_weeks * 7);
      return getDateString(start);
    }

    // Sub-branch 2c: phase has start_date but no end info
    return fallbackEndDate(today);
  }

  // Branch 3: no duration info
  return fallbackEndDate(today);
}

function fallbackEndDate(today: string): string {
  const d = new Date(today + "T00:00:00");
  d.setDate(d.getDate() + 8 * 7); // 8 weeks
  return getDateString(d);
}

// --- Delete future events ---

/**
 * Delete all future scheduled events for a plan.
 * Used when a plan is being replaced or deactivated.
 */
export async function deleteFutureEventsForPlan(planId: string): Promise<void> {
  const today = getTodayDateString();

  const { error } = await supabaseAdmin
    .from("training_events")
    .delete()
    .eq("training_plan_id", planId)
    .gte("date", today)
    .eq("status", "scheduled");

  if (error) throw error;
}

// --- Query functions ---

/**
 * Get all events for a client within a date range, ordered by date ascending.
 */
export async function getEventsForDateRange(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<TrainingEvent[]> {
  const { data, error } = await supabaseAdmin
    .from("training_events")
    .select("*")
    .eq("client_id", clientId)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true });

  if (error) throw error;
  return (data ?? []).map(mapEventRow);
}

/**
 * Get a single event for a client on a specific date.
 * Returns null if no event exists.
 */
export async function getEventForDate(
  clientId: string,
  date: string
): Promise<TrainingEvent | null> {
  const { data, error } = await supabaseAdmin
    .from("training_events")
    .select("*")
    .eq("client_id", clientId)
    .eq("date", date)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapEventRow(data) : null;
}

/**
 * Get a single event for a client + session on a specific date.
 * More specific than getEventForDate — handles multiple sessions on the same day.
 */
export async function getEventForSessionAndDate(
  clientId: string,
  trainingSessionId: string,
  date: string
): Promise<TrainingEvent | null> {
  const { data, error } = await supabaseAdmin
    .from("training_events")
    .select("*")
    .eq("client_id", clientId)
    .eq("training_session_id", trainingSessionId)
    .eq("date", date)
    .maybeSingle();

  if (error) throw error;
  return data ? mapEventRow(data) : null;
}

/**
 * Map completion quality ("full"/"partial"/"skipped") to event status.
 */
export function mapCompletionQualityToEventStatus(
  quality: string
): "completed" | "partial" | "skipped" {
  if (quality === "full") return "completed";
  if (quality === "partial") return "partial";
  return "skipped";
}

/**
 * Count events for a client within a date range.
 */
export async function countEventsInRange(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("training_events")
    .select("*", { count: "exact", head: true })
    .eq("client_id", clientId)
    .gte("date", startDate)
    .lte("date", endDate);

  if (error) throw error;
  return count ?? 0;
}

/**
 * Link a session log to an event and update its status.
 */
export async function linkSessionLogToEvent(
  eventId: string,
  sessionLogId: string,
  status: "completed" | "partial" | "skipped"
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("training_events")
    .update({
      session_log_id: sessionLogId,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", eventId);

  if (error) throw error;
}
