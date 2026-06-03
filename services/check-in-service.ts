import { supabaseAdmin } from "./supabase-admin";
import type {
  CheckIn,
  CheckInFormData,
  CheckInStatus,
  CheckInWithDailyLogCounts,
  CheckInReview,
} from "@/types/check-in";
import { mapCheckInRow } from "@/lib/mappers";
import { getDateString, dateStringToDayNumber, resolveCheckInWindow } from "@/lib/date-helpers";
import type { CheckInCursor } from "@/lib/cursor";
import { insertExerciseHighlights } from "./check-in-details-service";
import { getCheckInTrainingPeriodStats } from "./check-in-context-service";
import { getNutritionSummaryForPeriod } from "./weekly-nutrition-service";
import { getDailyLogs } from "./daily-logs-service";
import { calculateMetricAverages } from "@/utils/daily-logs-aggregation";
import { getClientById } from "./client-service";

// Re-export split modules so existing imports continue to work
export {
  generateCheckInToken,
  createCheckInToken,
  validateCheckInToken,
  claimTokenForProcessing,
  updateTokenWithCheckInId,
  releaseToken,
  markTokenAsUsed,
} from "./check-in-token-service";

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
  const { periodStart, periodEnd } = resolveCheckInWindow(
    new Date(),
    client?.expectedCheckInDay,
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
      notes: formData.notes,
      // Body metrics
      weight: formData.weight,
      weight_unit: formData.weightUnit,
      body_fat_percentage: formData.bodyFatPercentage,
      waist: formData.waist,
      hips: formData.hips,
      chest: formData.chest,
      arms: formData.arms,
      thighs: formData.thighs,
      measurement_unit: formData.measurementUnit,
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
    includeDailyLogCounts?: boolean;
    // Keyset pagination (the client list's native contract). `keyset: true` selects
    // keyset mode even for the first page (no cursor); `cursor` pages to older rows
    // on (created_at, id) and is pre-validated via lib/cursor.decodeCursor, so its
    // values are safe to interpolate into the filter. The coach route and internal
    // callers pass neither and keep the offset path.
    keyset?: boolean;
    cursor?: CheckInCursor;
  }
): Promise<{
  checkIns: (CheckIn | CheckInWithDailyLogCounts)[];
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

  // If daily log counts are requested, fetch them for the whole page in one query.
  if (options?.includeDailyLogCounts && checkIns.length > 0) {
    const enriched: CheckInWithDailyLogCounts[] = await enrichWithDailyLogCounts(checkIns, clientId);
    return { checkIns: enriched, total: count || 0, nextCursor };
  }

  return {
    checkIns,
    total: count || 0,
    nextCursor,
  };
};

// Enrich check-ins with daily-log counts for each check-in's period.
//
// Each period is contiguous with the next: period(i).start = period(i+1).end + 1
// day (the older check-in's date), so a page's periods tile [oldest start, newest
// end] with no gap and no overlap. That lets us replace the previous N parallel
// COUNT round-trips (one per check-in) with a SINGLE bounded fetch of the page's
// logged dates, then bucket them in JS — O(P + D).
//
// `expectedDays` is still derived from the raw timestamp delta (not the date-string
// span) so same-day / DST cases match the previous behavior exactly. Same-day
// check-ins produce an inverted period (start > end); those count 0 and consume no
// dates — daily_logs UNIQUE(client_id, date) guarantees the shared day is counted
// once, by the older period that actually spans it.
async function enrichWithDailyLogCounts(
  checkIns: CheckIn[],
  clientId: string
): Promise<CheckInWithDailyLogCounts[]> {
  // Activation date: clamps the oldest check-in's period to a partial first week so
  // its denominator matches the check-in form (never counts pre-activation days).
  const { data: clientRow } = await supabaseAdmin
    .from("clients")
    .select("start_date")
    .eq("id", clientId)
    .maybeSingle();
  const activationMs = clientRow?.start_date
    ? new Date(clientRow.start_date + "T00:00:00").getTime()
    : null;

  const periods = checkIns.map((currentCheckIn, i) => {
    const previousCheckIn = i < checkIns.length - 1 ? checkIns[i + 1] : null;

    const endDate = new Date(currentCheckIn.createdAt);
    let startDate: Date;

    if (previousCheckIn) {
      startDate = new Date(previousCheckIn.createdAt);
      startDate.setDate(startDate.getDate() + 1);
    } else {
      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 6);
    }
    // Partial first week: never reach before the client was activated.
    if (activationMs != null && startDate.getTime() < activationMs) {
      startDate = new Date(activationMs);
    }

    const daysDiff = Math.floor(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    ) + 1;

    const startStr = getDateString(startDate);
    const endStr = getDateString(endDate);

    return {
      startStr,
      endStr,
      startNum: dateStringToDayNumber(startStr),
      endNum: dateStringToDayNumber(endStr),
      expectedDays: Math.max(daysDiff, 1),
    };
  });

  // checkIns are newest-first: periods[0] holds the newest end, and the oldest
  // check-in (last) holds the oldest start (its fixed -6 day lookback is always the
  // minimum). One spine-only query for the page's logged dates.
  const rangeStart = periods[periods.length - 1].startStr;
  const rangeEnd = periods[0].endStr;

  const { data, error } = await supabaseAdmin
    .from("daily_logs")
    .select("date")
    .eq("client_id", clientId)
    .gte("date", rangeStart)
    .lte("date", rangeEnd)
    .order("date", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch daily log counts: ${error.message}`);
  }

  // Dates newest-first as day numbers, aligned with the newest-first periods so a
  // single forward two-pointer pass buckets every date in O(P + D).
  const dateNums = (data || []).map((row) => dateStringToDayNumber(row.date));

  const counts = new Array(periods.length).fill(0);
  let di = 0;
  for (let pi = 0; pi < periods.length; pi++) {
    const { startNum, endNum } = periods[pi];
    // Skip dates newer than this period's end (none for pi=0 given lte(rangeEnd)).
    while (di < dateNums.length && dateNums[di] > endNum) di++;
    // Count dates within [startNum, endNum]. An inverted period (startNum > endNum,
    // i.e. same-day check-ins) matches zero rows and advances the pointer nothing.
    while (di < dateNums.length && dateNums[di] <= endNum && dateNums[di] >= startNum) {
      counts[pi]++;
      di++;
    }
  }

  return checkIns.map((currentCheckIn, i) => ({
    ...currentCheckIn,
    dailyLogsCount: counts[i],
    expectedDays: periods[i].expectedDays,
  }));
}

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

// Update check-in status
export const updateCheckInStatus = async (
  checkInId: string,
  status: CheckInStatus
): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("check_ins")
    .update({ status })
    .eq("id", checkInId);

  if (error) {
    throw new Error(`Failed to update check-in status: ${error.message}`);
  }
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
