// Uses supabaseAdmin: service-to-service calls require bypassing RLS,
// and roadmap operations span multiple tables atomically.
import { supabaseAdmin } from "./supabase-admin";
import type {
  Roadmap,
  RoadmapRow,
  RoadmapStatus,
  Phase,
  PhaseRow,
  PhaseStatus,
} from "@/types/roadmap";

function mapRoadmapRow(row: RoadmapRow): Roadmap {
  return {
    id: row.id,
    clientId: row.client_id,
    coachId: row.coach_id,
    name: row.name,
    longTermGoal: row.long_term_goal ?? undefined,
    status: row.status as RoadmapStatus,
    startedAt: row.started_at ?? undefined,
    targetEndDate: row.target_end_date ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapPhaseRow(row: PhaseRow): Phase {
  return {
    id: row.id,
    roadmapId: row.roadmap_id,
    clientId: row.client_id,
    name: row.name,
    description: row.description ?? undefined,
    objectives: row.objectives ?? undefined,
    orderIndex: row.order_index,
    status: row.status as PhaseStatus,
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    durationWeeks: row.duration_weeks ?? undefined,
    phaseGoalsSnapshot: row.phase_goals_snapshot,
    phaseGoalWeight: row.phase_goal_weight ?? null,
    phaseGoalBodyFatPercentage: row.phase_goal_body_fat_percentage ?? null,
    coachReflection: row.coach_reflection ?? undefined,
    phaseSummary: row.phase_summary,
    milestones: row.milestones ?? [],
    completionSeen: row.completion_seen ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type RoadmapWithPhases = Roadmap & { phases: Phase[] };

async function fetchPhasesForRoadmap(roadmapId: string): Promise<Phase[]> {
  const { data, error } = await supabaseAdmin
    .from("phases")
    .select("*")
    .eq("roadmap_id", roadmapId)
    .order("order_index", { ascending: true });

  if (error) {
    console.error("Failed to fetch phases:", error);
    throw new Error(`Failed to fetch phases: ${error.message}`);
  }

  return (data || []).map((row) => mapPhaseRow(row as unknown as PhaseRow));
}

export const createRoadmap = async (
  clientId: string,
  coachId: string,
  data: {
    name: string;
    longTermGoal?: string;
    startedAt?: string;
    targetEndDate?: string;
  }
): Promise<Roadmap> => {
  const now = new Date().toISOString();

  // Check for existing active roadmap
  const { data: existing } = await supabaseAdmin
    .from("roadmaps")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "active")
    .maybeSingle();

  if (existing) {
    throw new Error("This client already has an active roadmap.");
  }

  try {
    const { data: row, error } = await supabaseAdmin
      .from("roadmaps")
      .insert({
        client_id: clientId,
        coach_id: coachId,
        name: data.name,
        long_term_goal: data.longTermGoal ?? null,
        status: "active",
        started_at: data.startedAt ?? now,
        target_end_date: data.targetEndDate ?? null,
      })
      .select()
      .single();

    if (error) {
      // Handle race condition: unique constraint on (client_id) WHERE status = 'active'
      if (error.code === "23505") {
        throw new Error("This client already has an active roadmap.");
      }
      console.error("Failed to create roadmap:", error);
      throw new Error(`Failed to create roadmap: ${error.message}`);
    }

    return mapRoadmapRow(row);
  } catch (err) {
    // Re-throw known errors
    if (
      err instanceof Error &&
      err.message === "This client already has an active roadmap."
    ) {
      throw err;
    }
    console.error("Failed to create roadmap:", err);
    throw err;
  }
};

export const getActiveRoadmap = async (
  clientId: string
): Promise<RoadmapWithPhases | null> => {
  const { data, error } = await supabaseAdmin
    .from("roadmaps")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    console.error("Failed to fetch active roadmap:", error);
    throw new Error(`Failed to fetch active roadmap: ${error.message}`);
  }

  if (!data) return null;

  const roadmap = mapRoadmapRow(data);
  const phases = await fetchPhasesForRoadmap(roadmap.id);

  return { ...roadmap, phases };
};

export const getRoadmap = async (
  roadmapId: string
): Promise<RoadmapWithPhases> => {
  const { data, error } = await supabaseAdmin
    .from("roadmaps")
    .select("*")
    .eq("id", roadmapId)
    .single();

  if (error) {
    console.error("Failed to fetch roadmap:", error);
    throw new Error(`Failed to fetch roadmap: ${error.message}`);
  }

  const roadmap = mapRoadmapRow(data);
  const phases = await fetchPhasesForRoadmap(roadmap.id);

  return { ...roadmap, phases };
};

export const updateRoadmap = async (
  roadmapId: string,
  data: {
    name?: string;
    longTermGoal?: string;
    startedAt?: string;
    targetEndDate?: string;
  }
): Promise<Roadmap> => {
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.longTermGoal !== undefined)
    updateData.long_term_goal = data.longTermGoal;
  if (data.startedAt !== undefined) updateData.started_at = data.startedAt;
  if (data.targetEndDate !== undefined)
    updateData.target_end_date = data.targetEndDate;

  const { data: row, error } = await supabaseAdmin
    .from("roadmaps")
    .update(updateData)
    .eq("id", roadmapId)
    .select()
    .single();

  if (error) {
    console.error("Failed to update roadmap:", error);
    throw new Error(`Failed to update roadmap: ${error.message}`);
  }

  return mapRoadmapRow(row);
};

export const archiveRoadmap = async (
  roadmapId: string
): Promise<Roadmap> => {
  const { data, error } = await supabaseAdmin
    .from("roadmaps")
    .update({
      status: "archived",
      updated_at: new Date().toISOString(),
    })
    .eq("id", roadmapId)
    .select()
    .single();

  if (error) {
    console.error("Failed to archive roadmap:", error);
    throw new Error(`Failed to archive roadmap: ${error.message}`);
  }

  return mapRoadmapRow(data);
};

export const deleteRoadmap = async (roadmapId: string): Promise<void> => {
  // Check all phases are 'planned'
  const { data: phases, error: phasesError } = await supabaseAdmin
    .from("phases")
    .select("id, status")
    .eq("roadmap_id", roadmapId);

  if (phasesError) {
    console.error("Failed to check phases:", phasesError);
    throw new Error(`Failed to check phases: ${phasesError.message}`);
  }

  const nonPlanned = (phases || []).find(
    (p: { id: string; status: string }) => p.status !== "planned"
  );
  if (nonPlanned) {
    throw new Error(
      "This roadmap has phases that were started or completed. Archive it instead of deleting."
    );
  }

  // Delete phases first (ON DELETE RESTRICT requires this)
  if (phases && phases.length > 0) {
    const { error: deletePhaseError } = await supabaseAdmin
      .from("phases")
      .delete()
      .eq("roadmap_id", roadmapId);

    if (deletePhaseError) {
      console.error("Failed to delete phases:", deletePhaseError);
      throw new Error(`Failed to delete phases: ${deletePhaseError.message}`);
    }
  }

  // Delete roadmap
  const { error: deleteError } = await supabaseAdmin
    .from("roadmaps")
    .delete()
    .eq("id", roadmapId);

  if (deleteError) {
    console.error("Failed to delete roadmap:", deleteError);
    throw new Error(`Failed to delete roadmap: ${deleteError.message}`);
  }
};
