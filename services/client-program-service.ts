import { supabaseAdmin } from "./supabase-admin";
import type { ClientProgram } from "@/types/client-program";
import type { PhaseStatus, Milestone } from "@/types/roadmap";

/**
 * Client-facing program read.
 * File-isolated from roadmap-service.ts to prevent accidental import of
 * coach-oriented helpers that fan out across clients.
 */
export async function getClientProgram(
  clientId: string
): Promise<ClientProgram | null> {
  const { data: roadmapRow, error: roadmapErr } = await supabaseAdmin
    .from("roadmaps")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "active")
    .maybeSingle();

  if (roadmapErr) {
    throw new Error(`Failed to fetch client roadmap: ${roadmapErr.message}`);
  }
  if (!roadmapRow) return null;

  const { data: phaseRows, error: phaseErr } = await supabaseAdmin
    .from("phases")
    .select("*")
    .eq("roadmap_id", roadmapRow.id)
    .order("order_index", { ascending: true });

  if (phaseErr) {
    throw new Error(`Failed to fetch phases: ${phaseErr.message}`);
  }

  const { data: clientRow, error: clientErr } = await supabaseAdmin
    .from("clients")
    .select("weight_unit, starting_weight, current_weight")
    .eq("id", clientId)
    .maybeSingle();

  if (clientErr) {
    throw new Error(`Failed to fetch client metrics: ${clientErr.message}`);
  }

  const phases = (phaseRows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    objectives: row.objectives ?? null,
    orderIndex: row.order_index,
    status: row.status as PhaseStatus,
    startDate: row.start_date ?? null,
    endDate: row.end_date ?? null,
    durationWeeks: row.duration_weeks ?? null,
    phaseGoalWeight: row.phase_goal_weight ?? null,
    phaseGoalBodyFatPercentage: row.phase_goal_body_fat_percentage ?? null,
    coachReflection: row.coach_reflection ?? null,
    milestones: (row.milestones as unknown as Milestone[]) ?? [],
  }));

  const activePhase = phases.find((p) => p.status === "active");

  const weightUnit: "lbs" | "kg" =
    clientRow?.weight_unit === "kg" ? "kg" : "lbs";

  return {
    roadmap: {
      id: roadmapRow.id,
      name: roadmapRow.name,
      longTermGoal: roadmapRow.long_term_goal ?? null,
      goalWeight: roadmapRow.goal_weight ?? null,
      goalBodyFatPercentage: roadmapRow.goal_body_fat_percentage ?? null,
      status: roadmapRow.status,
      startedAt: roadmapRow.started_at ?? null,
      targetEndDate: roadmapRow.target_end_date ?? null,
    },
    phases,
    activePhaseId: activePhase?.id ?? null,
    weightUnit,
    metrics: {
      startingWeight: clientRow?.starting_weight ?? null,
      currentWeight: clientRow?.current_weight ?? null,
    },
  };
}
