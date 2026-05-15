import type { SessionLogRow } from "@/lib/database-helpers";
import type { Json } from "@/types/database";
// Imported directly from lib/supabase-server (not re-exported via
// client-portal-service) to avoid a circular import:
// client-portal-service ↔ client-portal-training. Aliased so call sites stay
// readable. See TECHNICAL-DEBT.md → Auth Architecture Hygiene H2 for context.
import { createServerSupabaseClient as createPortalClient } from "@/lib/supabase-server";

// Session completion type
export type SessionCompletion = {
  id: string;
  clientId: string;
  trainingSessionId: string;
  completedAt: string;
  completionQuality: "full" | "partial" | "skipped";
  notes?: string;
  weekStartDate: string;
  createdAt: string;
  updatedAt: string;
};

// Get weekly session completions
export async function getWeeklyCompletions(
  clientId: string,
  weekStartDate: string
): Promise<SessionCompletion[]> {
  const supabase = await createPortalClient();

  const { data, error } = await supabase
    .from("session_logs")
    .select("*")
    .eq("client_id", clientId)
    .eq("week_start_date", weekStartDate);

  if (error || !data) return [];

  return data.map((row: SessionLogRow) => ({
    id: row.id,
    clientId: row.client_id,
    trainingSessionId: row.training_session_id ?? "",
    completedAt: row.completed_at,
    completionQuality: (row.completion_quality ?? "full") as SessionCompletion["completionQuality"],
    notes: row.notes ?? undefined,
    weekStartDate: row.week_start_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

// Mark a session as complete
export async function markSessionComplete(
  clientId: string,
  trainingSessionId: string,
  weekStartDate: string,
  quality: "full" | "partial" | "skipped" = "full",
  notes?: string
): Promise<SessionCompletion | null> {
  const supabase = await createPortalClient();

  // Build snapshot from the training session for history preservation
  let snapshot: Json | null = null;
  const { data: sessionData } = await supabase
    .from("training_sessions")
    .select("name, day_of_week, focus, estimated_duration_minutes, estimated_calories")
    .eq("id", trainingSessionId)
    .single();
  if (sessionData) {
    snapshot = sessionData;
  }

  const upsertPayload = {
    client_id: clientId,
    training_session_id: trainingSessionId,
    week_start_date: weekStartDate,
    completion_quality: quality,
    notes,
    completed_at: new Date().toISOString(),
    ...(snapshot ? { prescribed_session_snapshot: snapshot } : {}),
  };

  const { data, error } = await supabase
    .from("session_logs")
    .upsert(upsertPayload, {
      onConflict: "client_id,training_session_id,week_start_date",
    })
    .select()
    .single();

  if (error || !data) return null;

  return {
    id: data.id,
    clientId: data.client_id,
    trainingSessionId: data.training_session_id,
    completedAt: data.completed_at,
    completionQuality: data.completion_quality,
    notes: data.notes,
    weekStartDate: data.week_start_date,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

// Remove session completion (unmark as complete)
export async function removeSessionCompletion(
  clientId: string,
  trainingSessionId: string,
  weekStartDate: string
): Promise<boolean> {
  const supabase = await createPortalClient();

  const { error } = await supabase
    .from("session_logs")
    .delete()
    .eq("client_id", clientId)
    .eq("training_session_id", trainingSessionId)
    .eq("week_start_date", weekStartDate);

  return !error;
}

