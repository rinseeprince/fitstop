import { supabaseAdmin } from "./supabase-admin";
import type { ClientProgram } from "@/types/client-program";
import type { PhaseStatus, Milestone, RoadmapRow, PhaseRow } from "@/types/roadmap";

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
    milestones: (row.milestones as unknown as Milestone[]) ?? [],
  }));

  const activePhase = phases.find((p) => p.status === "active");

  return {
    roadmap: {
      id: roadmapRow.id,
      name: roadmapRow.name,
      longTermGoal: roadmapRow.long_term_goal ?? null,
      status: roadmapRow.status,
      startedAt: roadmapRow.started_at ?? null,
      targetEndDate: roadmapRow.target_end_date ?? null,
    },
    phases,
    activePhaseId: activePhase?.id ?? null,
  };
}
