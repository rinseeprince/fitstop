import { supabaseAdmin } from "./supabase-admin";
import type {
  CheckIn,
  CheckInFormData,
  CheckInStatus,
  CheckInWithDailyLogCounts,
  AICheckInSummary,
} from "@/types/check-in";
import { mapCheckInRow } from "@/lib/mappers";
import {
  insertSessionCompletions,
  insertExerciseHighlights,
  insertExternalActivities,
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
  getCheckInExternalActivities,
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
    if (formData.externalActivities?.length) {
      await insertExternalActivities(checkInId, formData.externalActivities);
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
  }
): Promise<{ checkIns: (CheckIn | CheckInWithDailyLogCounts)[]; total: number }> => {
  let query = supabaseAdmin
    .from("check_ins")
    .select("*", { count: "exact" })
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  if (options?.status) {
    query = query.eq("status", options.status);
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 10) - 1);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`Failed to fetch check-ins: ${error.message}`);
  }

  const checkIns = (data || []).map(mapCheckInRow);

  // If daily log counts are requested, fetch them for each check-in period
  if (options?.includeDailyLogCounts && checkIns.length > 0) {
    const enriched: CheckInWithDailyLogCounts[] = await enrichWithDailyLogCounts(checkIns, clientId);
    return { checkIns: enriched, total: count || 0 };
  }

  return {
    checkIns,
    total: count || 0,
  };
};

// Enrich check-ins with daily log counts for each check-in period
async function enrichWithDailyLogCounts(
  checkIns: CheckIn[],
  clientId: string
): Promise<CheckInWithDailyLogCounts[]> {
  const results: CheckInWithDailyLogCounts[] = [];

  for (let i = 0; i < checkIns.length; i++) {
    const currentCheckIn = checkIns[i];
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

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    const { count: dailyLogsCount } = await supabaseAdmin
      .from("daily_logs")
      .select("*", { count: "exact", head: true })
      .eq("client_id", clientId)
      .gte("date", startDateStr)
      .lte("date", endDateStr);

    const daysDiff = Math.floor(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    ) + 1;

    results.push({
      ...currentCheckIn,
      dailyLogsCount: dailyLogsCount || 0,
      expectedDays: Math.max(daysDiff, 1),
    });
  }

  return results;
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
