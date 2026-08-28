import { supabaseAdmin } from "./supabase-admin";
import type {
  CheckIn,
  CheckInFormData,
  CheckInStatus,
  CheckInReview,
} from "@/types/check-in";
import { mapCheckInRow } from "@/lib/mappers";
import {
  addDays,
  formatDateISO,
  getTodayInTimezone,
  resolveCheckInWindow,
} from "@/lib/date-helpers";
import { checkInWeekday } from "@/lib/check-in-week";
import { getFrequencyInDays, resolveCheckInDue } from "@/lib/check-in-schedule";
import type { CheckInCursor } from "@/lib/cursor";
import { insertExerciseHighlights } from "./check-in-details-service";
import { getCheckInTrainingPeriodStats } from "./check-in-context-service";
import { getNutritionSummaryForPeriod } from "./weekly-nutrition-service";
import { getDailyLogs } from "./daily-logs-service";
import { calculateMetricAverages } from "@/utils/daily-logs-aggregation";
import { getClientById } from "./client-service";

// Re-export split modules so existing imports continue to work
export {
  deriveSessionCompletionsForCheckIn,
  getCheckInExerciseHighlights,
  getCheckInWithDetails,
  mapExerciseHighlight,
} from "./check-in-details-service";

// Submit a check-in.
//
// Session 6.4: daily logs are the single source of truth. The check-in's weekly
// snapshot columns (workouts_completed, nutrition_days_on_target,
// adherence_percentage, mood/energy/sleep/stress) are DERIVED server-side from
// the spine for the check-in's period — never read from the form body. These
// columns stay populated so the AI's previous-check-in trend
// (utils/ai-prompt-builder.ts) keeps working. The form no longer sends
// sessionCompletions / nutritionAdherence / mood…stress; any such fields on
// formData are ignored.
export const submitCheckIn = async (
  clientId: string,
  formData: CheckInFormData
): Promise<string> => {
  // Resolve the period for THIS check-in via the shared helper, so the stored
  // period_start/period_end match what the check-in form/route showed (and the 6.4
  // coach-detail derivation reads). The window ends on the check-in day, clamped
  // forward to the activation date for a partial first week.
  const client = await getClientById(clientId);
  // Client-local today: the stored period must agree with the gate/form, which
  // both resolve the window on the client's day.
  const { periodStart, periodEnd } = resolveCheckInWindow(
    getTodayInTimezone(client?.timezone ?? "UTC"),
    // A NULL due date is "no schedule", which resolveCheckInWindow answers with
    // a trailing 7 days ending today. checkInWeekday never returns null, so the
    // no-schedule case is tested here.
    client?.nextCheckInDue ? checkInWeekday(client) : null,
    client?.startDate
  );

  // Derive snapshot columns from the spine for the period. Pin 1: reuse
  // getNutritionSummaryForPeriod so submit-path and AI-path numbers match. Pin 2:
  // read wellness rows from the consolidated daily_logs_full (mood/energy/sleep/
  // stress live in wellness_logs, not the bare daily_logs spine).
  let workoutsCompleted: number | undefined;
  let nutritionDaysOnTarget: number | undefined;
  let adherencePercentage: number | undefined;
  let mood: number | undefined;
  let energy: number | undefined;
  let sleep: number | undefined;
  let stress: number | undefined;
  let soreness: number | undefined;

  if (periodStart && periodEnd) {
    const [trainingStats, nutritionSummary, wellnessLogs] = await Promise.all([
      getCheckInTrainingPeriodStats(clientId, periodStart, periodEnd),
      getNutritionSummaryForPeriod(clientId, periodStart, periodEnd),
      getDailyLogs(clientId, periodStart, periodEnd),
    ]);

    workoutsCompleted = trainingStats.sessionsCompleted;

    if (nutritionSummary) {
      nutritionDaysOnTarget = nutritionSummary.daysOnTarget;
      adherencePercentage =
        nutritionSummary.adherencePercentage != null
          ? Math.max(0, Math.min(100, Math.round(nutritionSummary.adherencePercentage)))
          : undefined;
    }

    if (wellnessLogs.length > 0) {
      const averages = calculateMetricAverages(wellnessLogs);
      mood = averages.mood;
      energy = averages.energy;
      sleep = averages.sleep;
      stress = averages.stress;
      // Stays undefined (-> NULL snapshot) when the period logged no soreness.
      soreness = averages.soreness;
    }
  }

  const { data, error } = await supabaseAdmin
    .from("check_ins")
    .insert({
      client_id: clientId,
      status: "pending",
      // Subjective metrics (DERIVED from wellness_logs over the period)
      mood,
      energy,
      sleep,
      stress,
      soreness,
      notes: formData.notes,
      // Body metrics
      // Canonical kg/cm (migration 141). Callers convert at the API boundary —
      // this service never sees a display unit.
      weight: formData.weight,
      body_fat_percentage: formData.bodyFatPercentage,
      waist: formData.waist,
      hips: formData.hips,
      chest: formData.chest,
      arms: formData.arms,
      thighs: formData.thighs,
      // Photos
      photo_front: formData.photoFront,
      photo_side: formData.photoSide,
      photo_back: formData.photoBack,
      // Training metrics (DERIVED from training_events.status='completed')
      workouts_completed: workoutsCompleted,
      adherence_percentage: adherencePercentage,
      prs: formData.prs,
      challenges: formData.challenges,
      // Enhanced nutrition tracking (DERIVED from nutrition_logs over the period).
      // There's no separate nutrition-notes field anymore — the single reflection
      // textarea maps to `notes` above.
      nutrition_days_on_target: nutritionDaysOnTarget,
      nutrition_notes: null,
      // Persist the resolved period so detail readers derive the exact window.
      period_start: periodStart ?? null,
      period_end: periodEnd ?? null,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to submit check-in: ${error.message}`);
  }

  const checkInId = data.id;

  // The SECOND of the two writers of clients.next_check_in_due (the other is
  // the coach's date picker). A submitted check-in advances the schedule by one
  // frequency step from the due date it satisfies — resolveCheckInDue, not the
  // raw column, so a client answering a check-in whose date lapsed weeks ago
  // advances from the live one rather than from a dead one.
  //
  // If this UPDATE fails the check-in still stands and the date is left behind,
  // which is a visible, self-healing divergence rather than a silent one: the
  // client reads as due until resolveCheckInDue's lapse roll moves them on
  // within CHECK_IN_GRACE_DAYS, and the coach can set the date by hand. It is
  // deliberately not allowed to fail the submission — the check-in is the
  // client's work, the schedule is bookkeeping.
  if (client?.nextCheckInDue) {
    const live = resolveCheckInDue(client);
    const step = getFrequencyInDays(
      client.checkInFrequency ?? "weekly",
      client.checkInFrequencyDays
    );
    if (live && step > 0) {
      const { error: advanceError } = await supabaseAdmin
        .from("clients")
        .update({
          next_check_in_due: formatDateISO(addDays(live, step)),
          updated_at: new Date().toISOString(),
        })
        .eq("id", clientId);
      if (advanceError) {
        console.error(
          "Check-in submitted but the schedule did not advance:",
          advanceError.message
        );
      }
    }
  }

  // Exercise highlights remain a real backing table (OUT OF SCOPE for 6.4).
  // Errors here shouldn't fail the entire check-in.
  try {
    if (formData.exerciseHighlights?.length) {
      await insertExerciseHighlights(checkInId, formData.exerciseHighlights);
    }
  } catch (relatedDataError) {
    // Log the error but don't fail the check-in submission
    console.error("Error inserting related check-in data:", relatedDataError instanceof Error ? relatedDataError.message : "Unknown error");
  }

  return checkInId;
};

// Get a check-in by ID
export const getCheckInById = async (
  checkInId: string
): Promise<CheckIn | null> => {
  const { data, error } = await supabaseAdmin
    .from("check_ins")
    .select("*")
    .eq("id", checkInId)
    .single();

  if (error || !data) {
    return null;
  }

  return mapCheckInRow(data);
};

// Get all check-ins for a client
export const getClientCheckIns = async (
  clientId: string,
  options?: {
    limit?: number;
    offset?: number;
    status?: CheckInStatus;
    // Keyset pagination (the client list's native contract). `keyset: true` selects
    // keyset mode even for the first page (no cursor); `cursor` pages to older rows
    // on (created_at, id) and is pre-validated via lib/cursor.decodeCursor, so its
    // values are safe to interpolate into the filter. The coach route and internal
    // callers pass neither and keep the offset path.
    keyset?: boolean;
    cursor?: CheckInCursor;
  }
): Promise<{
  checkIns: CheckIn[];
  total: number;
  nextCursor: CheckInCursor | null;
}> => {
  const limit = options?.limit ?? 10;
  const cursor = options?.cursor;
  const keyset = options?.keyset === true || cursor !== undefined;

  // Keyset reads page on (created_at, id) and don't need — and shouldn't pay for —
  // an exact count. The legacy offset path keeps count:"exact" so the coach route
  // can still surface a total.
  let query = supabaseAdmin
    .from("check_ins")
    .select("*", keyset ? undefined : { count: "exact" })
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false }); // tiebreak for a stable keyset cursor

  if (options?.status) {
    query = query.eq("status", options.status);
  }

  if (keyset) {
    if (cursor) {
      // "older than the cursor" under ORDER BY created_at DESC, id DESC:
      //   created_at < c.createdAt OR (created_at = c.createdAt AND id < c.id)
      query = query.or(
        `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
      );
    }
    query = query.limit(limit + 1); // one extra row tells us whether a further page exists
  } else {
    if (options?.limit) {
      query = query.limit(limit);
    }
    if (options?.offset) {
      query = query.range(options.offset, options.offset + limit - 1);
    }
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`Failed to fetch check-ins: ${error.message}`);
  }

  let rows = data || [];
  let nextCursor: CheckInCursor | null = null;

  if (keyset) {
    const hasMore = rows.length > limit;
    if (hasMore) {
      rows = rows.slice(0, limit);
    }
    const last = rows[rows.length - 1];
    // created_at is nullable in the schema but submitCheckIn never sets it, so
    // DEFAULT NOW() always fires; the truthiness guard also stops a (theoretical)
    // null from producing a broken cursor — pagination just ends safely.
    nextCursor = hasMore && last?.created_at ? { createdAt: last.created_at, id: last.id } : null;
  }

  const checkIns = rows.map(mapCheckInRow);

  return {
    checkIns,
    total: count || 0,
    nextCursor,
  };
};

// Get the first (oldest) check-in for a client
export const getFirstCheckIn = async (
  clientId: string
): Promise<CheckIn | null> => {
  const { data, error } = await supabaseAdmin
    .from("check_ins")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  return mapCheckInRow(data);
};

// Update check-in with the AI review (v3 format). summary and clientMessage are
// stored in their own columns; watchItems/themes/coachActions go in ai_insights.
export const updateCheckInAISummary = async (
  checkInId: string,
  review: CheckInReview
): Promise<void> => {
  const enhancedInsights = {
    _version: 3 as const,
    watchItems: review.watchItems,
    themes: review.themes,
    coachActions: review.coachActions,
  };

  const { error } = await supabaseAdmin
    .from("check_ins")
    .update({
      ai_summary: review.summary,
      ai_insights: enhancedInsights,
      // coachActions share the { priority, text } shape with the legacy
      // ai_recommendations column, so any pre-v3 reader still resolves.
      ai_recommendations: review.coachActions,
      ai_response_draft: review.clientMessage,
      ai_processed_at: new Date().toISOString(),
      status: "ai_processed",
    })
    .eq("id", checkInId);

  if (error) {
    throw new Error(`Failed to update AI summary: ${error.message}`);
  }
};

// Update check-in with coach response
export const updateCheckInResponse = async (
  checkInId: string,
  coachResponse: string
): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("check_ins")
    .update({
      coach_response: coachResponse,
      coach_reviewed_at: new Date().toISOString(),
      status: "reviewed",
    })
    .eq("id", checkInId);

  if (error) {
    throw new Error(`Failed to update coach response: ${error.message}`);
  }
};

// Mark response as sent
export const markResponseAsSent = async (checkInId: string): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("check_ins")
    .update({
      response_sent_at: new Date().toISOString(),
    })
    .eq("id", checkInId);

  if (error) {
    throw new Error(`Failed to mark response as sent: ${error.message}`);
  }
};

// Get previous check-in for comparison
export const getPreviousCheckIn = async (
  clientId: string,
  currentCheckInId: string
): Promise<CheckIn | null> => {
  const currentCheckIn = await getCheckInById(currentCheckInId);
  if (!currentCheckIn) return null;

  const { data, error } = await supabaseAdmin
    .from("check_ins")
    .select("*")
    .eq("client_id", clientId)
    .lt("created_at", currentCheckIn.createdAt)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  return mapCheckInRow(data);
};
