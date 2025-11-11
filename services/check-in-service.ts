import { supabaseAdmin } from "./supabase-client";
import type {
  CheckIn,
  CheckInFormData,
  CheckInToken,
  CheckInClientInfo,
} from "@/types/check-in";

// Generate a unique token for check-in link
export const generateCheckInToken = (): string => {
  // Use crypto.randomUUID() which works in both Node and Edge runtime
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
};

// Create a check-in token for a client
export const createCheckInToken = async (
  clientId: string
): Promise<{ token: string; expiresAt: string }> => {
  const token = generateCheckInToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // Expires in 7 days

  const { data, error } = await supabaseAdmin
    .from("check_in_tokens")
    .insert({
      client_id: clientId,
      token,
      expires_at: expiresAt.toISOString(),
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create check-in token: ${error.message}`);
  }

  return {
    token: data.token,
    expiresAt: data.expires_at,
  };
};

// Validate a check-in token
export const validateCheckInToken = async (
  token: string
): Promise<{ valid: boolean; clientId?: string; tokenId?: string }> => {
  const { data, error } = await supabaseAdmin
    .from("check_in_tokens")
    .select("*")
    .eq("token", token)
    .single();

  if (error || !data) {
    return { valid: false };
  }

  // Check if token is expired
  const now = new Date();
  const expiresAt = new Date(data.expires_at);
  if (now > expiresAt) {
    return { valid: false };
  }

  // Check if token was already used
  if (data.used_at) {
    return { valid: false };
  }

  return {
    valid: true,
    clientId: data.client_id,
    tokenId: data.id,
  };
};

// Mark token as used
export const markTokenAsUsed = async (
  tokenId: string,
  checkInId: string
): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("check_in_tokens")
    .update({
      used_at: new Date().toISOString(),
      check_in_id: checkInId,
    })
    .eq("id", tokenId);

  if (error) {
    throw new Error(`Failed to mark token as used: ${error.message}`);
  }
};

// Submit a check-in
export const submitCheckIn = async (
  clientId: string,
  formData: CheckInFormData
): Promise<string> => {
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
      // Training metrics
      workouts_completed: formData.workoutsCompleted,
      adherence_percentage: formData.adherencePercentage,
      prs: formData.prs,
      challenges: formData.challenges,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to submit check-in: ${error.message}`);
  }

  return data.id;
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

  return mapDatabaseRowToCheckIn(data);
};

// Get all check-ins for a client
export const getClientCheckIns = async (
  clientId: string,
  options?: {
    limit?: number;
    offset?: number;
    status?: string;
  }
): Promise<{ checkIns: CheckIn[]; total: number }> => {
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

  return {
    checkIns: (data || []).map(mapDatabaseRowToCheckIn),
    total: count || 0,
  };
};

// Update check-in status
export const updateCheckInStatus = async (
  checkInId: string,
  status: "pending" | "ai_processed" | "reviewed"
): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("check_ins")
    .update({ status })
    .eq("id", checkInId);

  if (error) {
    throw new Error(`Failed to update check-in status: ${error.message}`);
  }
};

// Update check-in with AI summary
export const updateCheckInAISummary = async (
  checkInId: string,
  aiSummary: string,
  aiInsights: any,
  aiRecommendations: any,
  aiResponseDraft: string
): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("check_ins")
    .update({
      ai_summary: aiSummary,
      ai_insights: aiInsights,
      ai_recommendations: aiRecommendations,
      ai_response_draft: aiResponseDraft,
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

  return mapDatabaseRowToCheckIn(data);
};

// Helper function to map database row to CheckIn type
const mapDatabaseRowToCheckIn = (row: any): CheckIn => {
  return {
    id: row.id,
    clientId: row.client_id,
    status: row.status,
    mood: row.mood,
    energy: row.energy,
    sleep: row.sleep,
    stress: row.stress,
    notes: row.notes,
    weight: row.weight,
    weightUnit: row.weight_unit,
    bodyFatPercentage: row.body_fat_percentage,
    waist: row.waist,
    hips: row.hips,
    chest: row.chest,
    arms: row.arms,
    thighs: row.thighs,
    measurementUnit: row.measurement_unit,
    photoFront: row.photo_front,
    photoSide: row.photo_side,
    photoBack: row.photo_back,
    workoutsCompleted: row.workouts_completed,
    adherencePercentage: row.adherence_percentage,
    prs: row.prs,
    challenges: row.challenges,
    aiSummary: row.ai_summary,
    aiInsights: row.ai_insights,
    aiRecommendations: row.ai_recommendations,
    aiResponseDraft: row.ai_response_draft,
    aiProcessedAt: row.ai_processed_at,
    coachResponse: row.coach_response,
    coachReviewedAt: row.coach_reviewed_at,
    responseSentAt: row.response_sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};
