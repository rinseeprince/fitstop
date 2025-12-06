import { supabaseAdmin } from "./supabase-admin";
import type { TrainingSession } from "@/types/training";
import type {
  ActivityMetadata,
  ActivitySuggestion,
  ActivitySuggestionRow,
  TrainingSessionRow,
  TrainingSessionUpdateData,
} from "@/types/external-activity";

// Type for Supabase query builder that bypasses strict typing for new columns
type SupabaseQueryBuilder = ReturnType<typeof supabaseAdmin.from>;

// Map database row to ActivitySuggestion
const mapActivitySuggestionRow = (row: ActivitySuggestionRow): ActivitySuggestion => ({
  id: row.id,
  activityName: row.activity_name,
  category: row.category as ActivitySuggestion["category"],
  defaultMetLow: typeof row.default_met_low === "string" ? parseFloat(row.default_met_low) : row.default_met_low,
  defaultMetModerate: typeof row.default_met_moderate === "string" ? parseFloat(row.default_met_moderate) : row.default_met_moderate,
  defaultMetVigorous: typeof row.default_met_vigorous === "string" ? parseFloat(row.default_met_vigorous) : row.default_met_vigorous,
  muscleGroupsImpacted: row.muscle_groups_impacted || [],
  recoveryNotes: row.recovery_notes ?? undefined,
  popularityScore: row.popularity_score || 0,
});

// Map database row to TrainingSession (external activity)
const mapExternalActivityRow = (row: TrainingSessionRow): TrainingSession => ({
  id: row.id,
  planId: row.plan_id,
  name: row.name,
  dayOfWeek: row.day_of_week ?? undefined,
  orderIndex: row.order_index,
  focus: row.focus ?? undefined,
  notes: row.notes ?? undefined,
  estimatedDurationMinutes: row.estimated_duration_minutes ?? undefined,
  exercises: [],
  sessionType: row.session_type,
  activityMetadata: row.activity_metadata ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// Search activity suggestions
export const searchActivitySuggestions = async (
  query?: string,
  limit: number = 10
): Promise<ActivitySuggestion[]> => {
  let queryBuilder = supabaseAdmin
    .from("activity_suggestions")
    .select("*")
    .order("popularity_score", { ascending: false })
    .limit(limit);

  if (query && query.length > 0) {
    queryBuilder = queryBuilder.ilike("activity_name", `%${query}%`);
  }

  const { data, error } = await queryBuilder;

  if (error) throw new Error(`Failed to search activities: ${error.message}`);

  return (data as ActivitySuggestionRow[] || []).map(mapActivitySuggestionRow);
};

// Get activity suggestion by name (case-insensitive)
export const getActivityByName = async (
  name: string
): Promise<ActivitySuggestion | null> => {
  const { data, error } = await supabaseAdmin
    .from("activity_suggestions")
    .select("*")
    .ilike("activity_name", name)
    .limit(1)
    .single();

  if (error || !data) return null;

  return mapActivitySuggestionRow(data as ActivitySuggestionRow);
};

// Increment activity popularity
export const incrementActivityPopularity = async (
  activityName: string
): Promise<void> => {
  // Use type assertion for RPC call since Supabase types don't auto-infer Functions
  type RpcClient = {
    rpc: (fn: string, args: { p_activity_name: string }) => Promise<{ error: Error | null }>;
  };
  const { error } = await (supabaseAdmin as unknown as RpcClient).rpc(
    "increment_activity_popularity",
    { p_activity_name: activityName }
  );

  // Silently fail if RPC doesn't exist - popularity tracking is non-critical
  if (error) console.log("Popularity tracking skipped:", error.message);
};

// Type for insert/update operations on training_sessions with new columns
type SessionInsertData = {
  plan_id: string;
  name: string;
  day_of_week: string;
  order_index: number;
  focus: null;
  notes: string | null;
  estimated_duration_minutes: number;
  session_type: "external_activity";
  activity_metadata: ActivityMetadata;
};

// Add external activity to training plan
export const addExternalActivity = async (
  planId: string,
  activityData: {
    activityName: string;
    dayOfWeek: string;
    durationMinutes: number;
    notes?: string;
  },
  activityMetadata: ActivityMetadata
): Promise<TrainingSession> => {
  // Get max order index
  const { data: existingSessions } = await supabaseAdmin
    .from("training_sessions")
    .select("order_index")
    .eq("plan_id", planId)
    .order("order_index", { ascending: false })
    .limit(1);

  const sessions = existingSessions as { order_index: number }[] | null;
  const nextOrderIndex =
    sessions?.[0]?.order_index !== undefined
      ? sessions[0].order_index + 1
      : 0;

  const insertData: SessionInsertData = {
    plan_id: planId,
    name: activityData.activityName,
    day_of_week: activityData.dayOfWeek,
    order_index: nextOrderIndex,
    focus: null,
    notes: activityData.notes || null,
    estimated_duration_minutes: activityData.durationMinutes,
    session_type: "external_activity",
    activity_metadata: activityMetadata,
  };

  // Use type assertion for insert with new columns
  const { data, error } = await (supabaseAdmin.from("training_sessions") as unknown as {
    insert: (data: SessionInsertData) => { select: () => { single: () => Promise<{ data: TrainingSessionRow; error: Error | null }> } };
  }).insert(insertData).select().single();

  if (error) throw new Error(`Failed to add activity: ${error.message}`);

  return mapExternalActivityRow(data);
};

// Update external activity
export const updateExternalActivity = async (
  activityId: string,
  updates: {
    activityName?: string;
    dayOfWeek?: string;
    durationMinutes?: number;
    notes?: string;
  },
  activityMetadata?: ActivityMetadata
): Promise<TrainingSession> => {
  const updateData: TrainingSessionUpdateData = { updated_at: new Date().toISOString() };

  if (updates.activityName !== undefined) updateData.name = updates.activityName;
  if (updates.dayOfWeek !== undefined) updateData.day_of_week = updates.dayOfWeek;
  if (updates.durationMinutes !== undefined)
    updateData.estimated_duration_minutes = updates.durationMinutes;
  if (updates.notes !== undefined) updateData.notes = updates.notes;
  if (activityMetadata !== undefined) updateData.activity_metadata = activityMetadata;

  // Use type assertion for update with new columns
  const { data, error } = await (supabaseAdmin.from("training_sessions") as unknown as {
    update: (data: TrainingSessionUpdateData) => {
      eq: (col: string, val: string) => {
        eq: (col: string, val: string) => {
          select: () => {
            single: () => Promise<{ data: TrainingSessionRow; error: Error | null }>
          }
        }
      }
    };
  }).update(updateData).eq("id", activityId).eq("session_type", "external_activity").select().single();

  if (error) throw new Error(`Failed to update activity: ${error.message}`);

  return mapExternalActivityRow(data);
};

// Delete external activity
export const deleteExternalActivity = async (activityId: string): Promise<void> => {
  // Use type assertion for delete with session_type filter
  const { error } = await (supabaseAdmin.from("training_sessions") as unknown as {
    delete: () => {
      eq: (col: string, val: string) => {
        eq: (col: string, val: string) => Promise<{ error: Error | null }>
      }
    };
  }).delete().eq("id", activityId).eq("session_type", "external_activity");

  if (error) throw new Error(`Failed to delete activity: ${error.message}`);
};

// Get all external activities for a plan
export const getExternalActivitiesForPlan = async (
  planId: string
): Promise<TrainingSession[]> => {
  // Use type assertion for query with session_type filter
  const { data, error } = await (supabaseAdmin.from("training_sessions") as unknown as {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        eq: (col: string, val: string) => {
          order: (col: string, opts: { ascending: boolean }) => Promise<{ data: TrainingSessionRow[]; error: Error | null }>
        }
      }
    };
  }).select("*").eq("plan_id", planId).eq("session_type", "external_activity").order("day_of_week", { ascending: true });

  if (error) throw new Error(`Failed to fetch activities: ${error.message}`);

  return (data || []).map(mapExternalActivityRow);
};
