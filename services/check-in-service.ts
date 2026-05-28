import { supabaseAdmin } from "./supabase-admin";
import type {
  CheckIn,
  CheckInFormData,
  CheckInStatus,
  CheckInWithDailyLogCounts,
  AICheckInSummary,
} from "@/types/check-in";
import { mapCheckInRow } from "@/lib/mappers";
import { getDateString, dateStringToDayNumber } from "@/lib/date-helpers";
import type { CheckInCursor } from "@/lib/cursor";
import {
  insertSessionCompletions,
  insertExerciseHighlights,
} from "./check-in-details-service";

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
  getCheckInSessionCompletions,
  getCheckInExerciseHighlights,
  getCheckInWithDetails,
} from "./check-in-details-service";

// Submit a check-in
export const submitCheckIn = async (
  clientId: string,
  formData: CheckInFormData
): Promise<string> => {
  // Calculate legacy fields from enhanced data for backward compatibility
  const workoutsCompleted = formData.sessionCompletions?.length
    ? formData.sessionCompletions.filter((s) => s.completed).length
    : formData.workoutsCompleted;
  // Cap at 100% to satisfy database constraint
  const adherencePercentage = formData.nutritionAdherence?.daysOnTarget !== undefined
    ? Math.min(100, Math.round((formData.nutritionAdherence.daysOnTarget / 7) * 100))
    : formData.adherencePercentage;

  const { data, error } = await supabaseAdmin
    .from("check_ins")
    .insert({
      client_id: clientId,
      status: "pending",
      // Subjective metrics
      mood: formData.mood,
      energy: formData.energy,
      sleep: formData.sleep,
      stress: formData.stress,
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
      // Training metrics (legacy)
      workouts_completed: workoutsCompleted,
      adherence_percentage: adherencePercentage,
      prs: formData.prs,
      challenges: formData.challenges,
      // Enhanced nutrition tracking
      nutrition_days_on_target: formData.nutritionAdherence?.daysOnTarget,
      nutrition_notes: formData.nutritionAdherence?.notes,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to submit check-in: ${error.message}`);
  }

  const checkInId = data.id;

  // Insert related data - errors here shouldn't fail the entire check-in
  try {
    if (formData.sessionCompletions?.length) {
      await insertSessionCompletions(checkInId, formData.sessionCompletions);
    }
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

// Update check-in with AI summary (v2 format stores enhanced data in ai_insights JSONB)
export const updateCheckInAISummary = async (
  checkInId: string,
  summary: AICheckInSummary
): Promise<void> => {
  const enhancedInsights = {
    _version: 2 as const,
    insights: summary.insights,
    nutritionInsight: summary.nutritionInsight,
    notesIntelligence: summary.notesIntelligence,
    trainingInsight: summary.trainingInsight,
    wellnessInsight: summary.wellnessInsight,
    coachActions: summary.coachActions,
    clientHighlights: summary.clientHighlights,
  };

  const { error } = await supabaseAdmin
    .from("check_ins")
    .update({
      ai_summary: summary.summary,
      ai_insights: enhancedInsights,
      ai_recommendations: summary.recommendations,
      ai_response_draft: summary.responseDraft,
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
