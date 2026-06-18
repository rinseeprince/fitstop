// Uses supabaseAdmin: service-to-service calls require bypassing RLS,
// and phase operations span multiple tables (phases, roadmaps, plans).
import { supabaseAdmin } from "./supabase-admin";
import { mapPhaseRow } from "./roadmap-service";
import { getCurrentGoals } from "./client-goals-service";
import { getClientTodayString } from "./today-service";
import type { Phase, PhaseRow, Milestone } from "@/types/roadmap";

/**
 * Reject a [startDate, endDate] range that overlaps a dated sibling phase in the
 * same roadmap (two phases can't run at once, and a phase can't start mid-phase).
 * Only fully-dated siblings participate; half-dated/dateless phases are skipped
 * (they can't be bounded). YYYY-MM-DD compares lexicographically = chronologically.
 */
async function assertNoSiblingOverlap(
  roadmapId: string,
  startDate: string,
  endDate: string,
  excludePhaseId?: string,
): Promise<void> {
  let query = supabaseAdmin
    .from("phases")
    .select("id, name, start_date, end_date")
    .eq("roadmap_id", roadmapId)
    .not("start_date", "is", null)
    .not("end_date", "is", null);
  if (excludePhaseId) query = query.neq("id", excludePhaseId);

  const { data: siblings, error } = await query;
  if (error) {
    console.error("Failed to check phase overlap:", error);
    throw new Error(`Failed to check phase overlap: ${error.message}`);
  }

  for (const sib of siblings ?? []) {
    // Half-open guard: overlap iff start <= sibEnd AND sibStart <= end.
    if (startDate <= (sib.end_date as string) && (sib.start_date as string) <= endDate) {
      throw new Error(
        `These dates overlap the phase "${sib.name}" (${sib.start_date} to ${sib.end_date}). Phases in a roadmap can't overlap.`,
      );
    }
  }
}

export const createPhase = async (
  roadmapId: string,
  data: {
    name: string;
    description?: string | null;
    objectives?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    durationWeeks?: number;
    orderIndex?: number;
    phaseGoalWeight?: number | null;
    phaseGoalBodyFatPercentage?: number | null;
    milestones?: Milestone[];
  }
): Promise<Phase> => {
  // Get roadmap to set client_id
  const { data: roadmap, error: roadmapError } = await supabaseAdmin
    .from("roadmaps")
    .select("client_id")
    .eq("id", roadmapId)
    .single();

  if (roadmapError) {
    console.error("Failed to fetch roadmap:", roadmapError);
    throw new Error(`Failed to fetch roadmap: ${roadmapError.message}`);
  }

  // A fully-dated phase must not overlap a dated sibling.
  if (data.startDate && data.endDate) {
    await assertNoSiblingOverlap(roadmapId, data.startDate, data.endDate);
  }

  // Optionally snapshot current goals
  let goalsSnapshot: Record<string, unknown> | null = null;
  try {
    const goals = await getCurrentGoals(roadmap.client_id);
    if (goals) {
      goalsSnapshot = {
        goalWeight: goals.goalWeight,
        goalBodyFatPercentage: goals.goalBodyFatPercentage,
        goalDeadline: goals.goalDeadline,
        primaryGoal: goals.primaryGoal,
      };
    }
  } catch {
    // Non-critical: proceed without snapshot
    console.error("Failed to snapshot goals for phase");
  }

  const { data: row, error } = await supabaseAdmin
    .from("phases")
    .insert({
      roadmap_id: roadmapId,
      client_id: roadmap.client_id,
      name: data.name,
      description: data.description ?? null,
      objectives: data.objectives ?? null,
      order_index: data.orderIndex ?? 0,
      status: "planned",
      start_date: data.startDate ?? null,
      end_date: data.endDate ?? null,
      duration_weeks: data.durationWeeks ?? null,
      phase_goals_snapshot: goalsSnapshot as unknown as undefined,
      phase_goal_weight: data.phaseGoalWeight ?? null,
      phase_goal_body_fat_percentage: data.phaseGoalBodyFatPercentage ?? null,
      milestones: data.milestones ?? [],
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to create phase:", error);
    throw new Error(`Failed to create phase: ${error.message}`);
  }

  return mapPhaseRow(row as unknown as PhaseRow);
};

export const activatePhase = async (
  phaseId: string,
  clientId: string
): Promise<Phase> => {
  // Fetch phase, scoped to clientId to prevent cross-client access
  const { data: phase, error: phaseError } = await supabaseAdmin
    .from("phases")
    .select("*")
    .eq("id", phaseId)
    .eq("client_id", clientId)
    .maybeSingle();

  if (phaseError) {
    console.error("Failed to fetch phase:", phaseError);
    throw new Error(`Failed to fetch phase: ${phaseError.message}`);
  }

  if (!phase) {
    throw new Error("Phase not found");
  }

  // Check no other active phase in this roadmap
  const { data: activePhases, error: activeError } = await supabaseAdmin
    .from("phases")
    .select("id")
    .eq("roadmap_id", phase.roadmap_id)
    .eq("status", "active");

  if (activeError) {
    console.error("Failed to check active phases:", activeError);
    throw new Error(`Failed to check active phases: ${activeError.message}`);
  }

  if (activePhases && activePhases.length > 0) {
    throw new Error(
      "Another phase is currently active. Complete it first using the phase transition flow."
    );
  }

  const now = new Date().toISOString();
  const { data: row, error } = await supabaseAdmin
    .from("phases")
    .update({
      status: "active",
      start_date: phase.start_date ?? now,
      updated_at: now,
    })
    .eq("id", phaseId)
    .select()
    .single();

  if (error) {
    console.error("Failed to activate phase:", error);
    throw new Error(`Failed to activate phase: ${error.message}`);
  }

  return mapPhaseRow(row as unknown as PhaseRow);
};

export const completePhase = async (
  phaseId: string,
  clientId: string
): Promise<Phase> => {
  // Fetch phase, scoped to clientId to prevent cross-client access
  const { data: phase, error: phaseError } = await supabaseAdmin
    .from("phases")
    .select("*")
    .eq("id", phaseId)
    .eq("client_id", clientId)
    .maybeSingle();

  if (phaseError) {
    console.error("Failed to fetch phase:", phaseError);
    throw new Error(`Failed to fetch phase: ${phaseError.message}`);
  }

  if (!phase) {
    throw new Error("Phase not found");
  }

  // A phase that hasn't started yet (start_date in the client's future) can't be
  // completed - there's nothing to look back on.
  if (phase.start_date) {
    const clientToday = await getClientTodayString(clientId);
    if (phase.start_date > clientToday) {
      throw new Error("This phase hasn't started yet and can't be completed.");
    }
  }

  const now = new Date().toISOString();
  const { data: row, error } = await supabaseAdmin
    .from("phases")
    .update({
      status: "completed",
      end_date: phase.end_date ?? now,
      updated_at: now,
    })
    .eq("id", phaseId)
    .select()
    .single();

  if (error) {
    console.error("Failed to complete phase:", error);
    throw new Error(`Failed to complete phase: ${error.message}`);
  }

  return mapPhaseRow(row as unknown as PhaseRow);
};

export const getActivePhase = async (
  clientId: string
): Promise<Phase | null> => {
  // Find the active roadmap first
  const { data: roadmap, error: roadmapError } = await supabaseAdmin
    .from("roadmaps")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "active")
    .maybeSingle();

  if (roadmapError) {
    console.error("Failed to fetch active roadmap:", roadmapError);
    throw new Error(
      `Failed to fetch active roadmap: ${roadmapError.message}`
    );
  }

  if (!roadmap) return null;

  const { data, error } = await supabaseAdmin
    .from("phases")
    .select("*")
    .eq("roadmap_id", roadmap.id)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    console.error("Failed to fetch active phase:", error);
    throw new Error(`Failed to fetch active phase: ${error.message}`);
  }

  return data ? mapPhaseRow(data as unknown as PhaseRow) : null;
};

export const updatePhase = async (
  phaseId: string,
  clientId: string,
  data: {
    name?: string;
    description?: string | null;
    objectives?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    durationWeeks?: number;
    orderIndex?: number;
    phaseGoalWeight?: number | null;
    phaseGoalBodyFatPercentage?: number | null;
    milestones?: Milestone[];
  }
): Promise<Phase> => {
  // Phase goals are editable while the phase is planned OR active; once it is
  // completed or skipped they lock. Whitelist (deny-by-default) so any future
  // status stays locked unless explicitly allowed.
  const hasGoalEdits =
    data.phaseGoalWeight !== undefined ||
    data.phaseGoalBodyFatPercentage !== undefined;
  if (hasGoalEdits) {
    const { data: phase } = await supabaseAdmin
      .from("phases")
      .select("status")
      .eq("id", phaseId)
      .eq("client_id", clientId)
      .single();
    if (!phase || !["planned", "active"].includes(phase.status)) {
      throw new Error(
        "Phase goals can only be edited while the phase is planned or active"
      );
    }
  }

  // Date edits: the resulting fully-dated range must not overlap a dated sibling.
  if (data.startDate !== undefined || data.endDate !== undefined) {
    const { data: phase } = await supabaseAdmin
      .from("phases")
      .select("roadmap_id, start_date, end_date")
      .eq("id", phaseId)
      .eq("client_id", clientId)
      .single();
    if (phase) {
      const effStart =
        data.startDate !== undefined ? data.startDate : phase.start_date;
      const effEnd = data.endDate !== undefined ? data.endDate : phase.end_date;
      if (effStart && effEnd) {
        await assertNoSiblingOverlap(phase.roadmap_id, effStart, effEnd, phaseId);
      }
    }
  }

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.objectives !== undefined) updateData.objectives = data.objectives;
  if (data.startDate !== undefined) updateData.start_date = data.startDate;
  if (data.endDate !== undefined) updateData.end_date = data.endDate;
  if (data.durationWeeks !== undefined)
    updateData.duration_weeks = data.durationWeeks;
  if (data.orderIndex !== undefined) updateData.order_index = data.orderIndex;
  if (data.phaseGoalWeight !== undefined)
    updateData.phase_goal_weight = data.phaseGoalWeight;
  if (data.phaseGoalBodyFatPercentage !== undefined)
    updateData.phase_goal_body_fat_percentage = data.phaseGoalBodyFatPercentage;
  if (data.milestones !== undefined) updateData.milestones = data.milestones;

  // Scope to clientId to prevent cross-client access
  const { data: row, error } = await supabaseAdmin
    .from("phases")
    .update(updateData)
    .eq("id", phaseId)
    .eq("client_id", clientId)
    .select()
    .maybeSingle();

  if (error) {
    console.error("Failed to update phase:", error);
    throw new Error(`Failed to update phase: ${error.message}`);
  }

  if (!row) {
    throw new Error("Phase not found");
  }

  return mapPhaseRow(row as unknown as PhaseRow);
};

export const deletePhase = async (
  phaseId: string,
  clientId: string
): Promise<void> => {
  // Fetch phase, scoped to clientId to prevent cross-client access
  const { data: phase, error: phaseError } = await supabaseAdmin
    .from("phases")
    .select("*")
    .eq("id", phaseId)
    .eq("client_id", clientId)
    .maybeSingle();

  if (phaseError) {
    console.error("Failed to fetch phase:", phaseError);
    throw new Error(`Failed to fetch phase: ${phaseError.message}`);
  }

  if (!phase) {
    throw new Error("Phase not found");
  }

  if (phase.status !== "planned") {
    throw new Error(
      "This phase has been started or completed and cannot be deleted."
    );
  }

  // Unlink plans before deleting
  await supabaseAdmin
    .from("training_plans")
    .update({ phase_id: null })
    .eq("phase_id", phaseId);

  await supabaseAdmin
    .from("nutrition_plans")
    .update({ phase_id: null })
    .eq("phase_id", phaseId);

  await supabaseAdmin
    .from("daily_habits")
    .update({ phase_id: null })
    .eq("phase_id", phaseId);

  // Delete phase
  const { error } = await supabaseAdmin
    .from("phases")
    .delete()
    .eq("id", phaseId);

  if (error) {
    console.error("Failed to delete phase:", error);
    throw new Error(`Failed to delete phase: ${error.message}`);
  }
};

/**
 * Lazy date-driven auto-activation: if a planned phase's window now contains the
 * client's local today and no phase is active, flip it to active. Mirrors the
 * (deleted) training-plan promotion's laziness; called on roadmap reads (coach
 * and client) so activation tracks the client's day, not coach attention.
 *
 * Deterministic: the earliest eligible planned phase wins (start_date ASC, then
 * order_index ASC). Conflict-tolerant: a concurrent reader may activate first
 * and trip idx_phases_active_unique (23505) - treat that as a no-op, not a 500.
 */
export const promotePhaseIfReady = async (
  clientId: string,
  clientToday?: string,
): Promise<{ promoted: boolean; phaseId?: string }> => {
  const today = clientToday ?? (await getClientTodayString(clientId));

  const { data: roadmap } = await supabaseAdmin
    .from("roadmaps")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "active")
    .maybeSingle();
  if (!roadmap) return { promoted: false };

  // Single-active invariant: if a phase is already active, nothing to promote.
  const { data: activePhase } = await supabaseAdmin
    .from("phases")
    .select("id")
    .eq("roadmap_id", roadmap.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (activePhase) return { promoted: false };

  // The earliest planned phase whose window actually contains today (skip wholly
  // past planned phases - a data anomaly left for the coach).
  const { data: due } = await supabaseAdmin
    .from("phases")
    .select("id")
    .eq("roadmap_id", roadmap.id)
    .eq("status", "planned")
    .lte("start_date", today)
    .or(`end_date.gte.${today},end_date.is.null`)
    .order("start_date", { ascending: true })
    .order("order_index", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!due) return { promoted: false };

  const { error } = await supabaseAdmin
    .from("phases")
    .update({ status: "active", updated_at: new Date().toISOString() })
    .eq("id", due.id)
    .eq("status", "planned");

  if (error) {
    // 23505 = another reader activated a phase first; the invariant still holds.
    if ((error as { code?: string }).code === "23505") return { promoted: false };
    console.error("Failed to auto-activate phase:", error);
    throw new Error(`Failed to auto-activate phase: ${error.message}`);
  }

  return { promoted: true, phaseId: due.id };
};
