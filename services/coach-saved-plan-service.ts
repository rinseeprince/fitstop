import { supabaseAdmin } from "./supabase-admin";
import { resolveExercises } from "./exercise-catalog-service";
import {
  mapSavedExerciseRow,
  mapSavedSessionRow,
  mapSavedPlanRow,
} from "@/lib/coach-mappers";
import {
  copySavedExerciseRows,
  dedupeCopyName,
  deriveCycleInfoFromSessions,
  insertSavedExercises,
} from "./coach-library-helpers";
import { projectExerciseCompact } from "@/utils/exercise-set-specs";
import type { SetSpec } from "@/utils/exercise-set-specs";
import type {
  SavedPlan,
  SavedPlanListItem,
  SavedPlansSummary,
  SavedPlanSource,
  SavedPlanStatus,
  ManualSessionDraft,
} from "@/types/training";
import type {
  CoachSavedPlanRow,
  CoachSavedSessionRow,
  CoachSavedExerciseRow,
  CoachSavedPlanInsert,
  CoachSavedSessionInsert,
  CoachSavedExerciseInsert,
} from "@/lib/database-helpers";

export async function createSavedPlanManual(
  coachId: string,
  name: string,
  splitType: string | null,
  sessions: ManualSessionDraft[],
  opts?: { description?: string | null; defaultSurplusPercentage?: number | null }
): Promise<string> {
  // Only collect names from training sessions — rest days have no exercises.
  const allNames: string[] = [];
  for (const s of sessions) {
    if (s.isRest) continue;
    for (const e of s.exercises) allNames.push(e.name);
  }
  const exerciseIdMap = await resolveExercises(allNames, coachId);

  // Derive cycle info from session order: rest_pattern is the indices of rest sessions.
  const cycleLength = sessions.length;
  const restPattern = sessions
    .map((s, i) => (s.isRest ? i : -1))
    .filter((i) => i >= 0);
  const trainingCount = sessions.filter((s) => !s.isRest).length;

  const planRow: CoachSavedPlanInsert = {
    coach_id: coachId,
    name,
    split_type: splitType,
    description: opts?.description ?? null,
    default_surplus_percentage: opts?.defaultSurplusPercentage ?? null,
    frequency_per_week: trainingCount,
    status: "draft",
    cycle_length: cycleLength,
    rest_pattern: restPattern,
    source: "manual",
  };

  const { data: plan, error: planError } = await supabaseAdmin
    .from("coach_saved_plans")
    .insert(planRow)
    .select("id")
    .single();
  if (planError || !plan) throw new Error(`Failed to create saved plan: ${planError?.message}`);

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const isRest = !!s.isRest;
    const sessionRow: CoachSavedSessionInsert = {
      coach_id: coachId,
      saved_plan_id: plan.id,
      name: isRest ? "Rest" : s.name,
      focus: isRest ? null : (s.focus ?? null),
      order_index: i,
      is_rest: isRest,
      estimated_duration_minutes: null,
      notes: null,
      session_type: "training",
    };

    const { data: session, error: sessionError } = await supabaseAdmin
      .from("coach_saved_sessions")
      .insert(sessionRow)
      .select("id")
      .single();
    if (sessionError || !session) throw new Error(`Failed to create saved session: ${sessionError?.message}`);

    if (!isRest) {
      await insertSavedExercises(session.id, s.exercises, exerciseIdMap);
    }
  }

  return plan.id;
}

// --- Promote draft to saved ---

export async function promoteDraftToSaved(
  planId: string,
  coachId: string,
  options: { saveSessionsIndividually: boolean }
): Promise<{ nameConflict?: string }> {
  // Fetch the plan
  const { data: plan, error } = await supabaseAdmin
    .from("coach_saved_plans")
    .select("id, name, coach_id, status")
    .eq("id", planId)
    .single();
  if (error || !plan) throw new Error("Plan not found");
  if (plan.coach_id !== coachId) throw new Error("Access denied");
  if (plan.status !== "draft") throw new Error("Plan is not a draft");

  // Check name conflict against saved plans
  const { data: existingPlan } = await supabaseAdmin
    .from("coach_saved_plans")
    .select("id")
    .eq("coach_id", coachId)
    .eq("status", "saved")
    .ilike("name", plan.name)
    .neq("id", planId)
    .maybeSingle();

  if (existingPlan) {
    return { nameConflict: "A plan with this name already exists in your library" };
  }

  // Promote
  const { error: updateError } = await supabaseAdmin
    .from("coach_saved_plans")
    .update({ status: "saved", updated_at: new Date().toISOString() })
    .eq("id", planId);
  if (updateError) throw new Error(`Failed to promote plan: ${updateError.message}`);

  // Optionally save sessions individually
  if (options.saveSessionsIndividually) {
    const { data: sessions } = await supabaseAdmin
      .from("coach_saved_sessions")
      .select("*, coach_saved_exercises(*)")
      .eq("saved_plan_id", planId)
      .eq("is_rest", false)
      .order("order_index");

    for (const s of sessions ?? []) {
      // Check for existing standalone session with same name
      const { data: existing } = await supabaseAdmin
        .from("coach_saved_sessions")
        .select("id")
        .eq("coach_id", coachId)
        .is("saved_plan_id", null)
        .ilike("name", s.name)
        .maybeSingle();

      if (existing) continue; // Dedup: skip if standalone already exists

      // Create standalone copy
      const { data: newSession, error: sError } = await supabaseAdmin
        .from("coach_saved_sessions")
        .insert({
          coach_id: coachId,
          saved_plan_id: null,
          name: s.name,
          focus: s.focus,
          order_index: 0,
          is_rest: false,
          estimated_duration_minutes: s.estimated_duration_minutes,
          calorie_surplus_percentage: s.calorie_surplus_percentage,
          notes: s.notes,
          session_type: s.session_type,
        })
        .select("id")
        .single();
      if (sError || !newSession) continue;

      // Copy exercises verbatim (shared with the duplicate endpoints)
      const exercises = (s.coach_saved_exercises ?? []) as CoachSavedExerciseRow[];
      if (exercises.length > 0) {
        await supabaseAdmin
          .from("coach_saved_exercises")
          .insert(copySavedExerciseRows(exercises, newSession.id));
      }
    }
  }

  return {};
}

// --- Query functions ---

export async function getSavedPlans(
  coachId: string,
  opts?: { includeDrafts?: boolean }
): Promise<SavedPlan[]> {
  // Default stays saved-only: the calendar library panel and legacy callers
  // must never see drafts. The Programs table opts in (?status=all) so
  // abandoned "New program" drafts stop being invisible orphans.
  const statuses = opts?.includeDrafts ? ["saved", "draft"] : ["saved"];
  const { data, error } = await supabaseAdmin
    .from("coach_saved_plans")
    .select("*, coach_saved_sessions(*, coach_saved_exercises(*))")
    .eq("coach_id", coachId)
    .in("status", statuses)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch saved plans: ${error.message}`);

  return (data ?? []).map((row) => {
    const sessions = ((row.coach_saved_sessions ?? []) as CoachSavedSessionRow[])
      .sort((a, b) => a.order_index - b.order_index)
      .map((s: CoachSavedSessionRow & { coach_saved_exercises?: CoachSavedExerciseRow[] }) => {
        const exercises = (s.coach_saved_exercises ?? [])
          .sort((a: CoachSavedExerciseRow, b: CoachSavedExerciseRow) => a.order_index - b.order_index)
          .map(mapSavedExerciseRow);
        return mapSavedSessionRow(s, exercises);
      });
    return mapSavedPlanRow(row as CoachSavedPlanRow, sessions);
  });
}

export async function getSavedPlanById(
  planId: string,
  coachId: string
): Promise<SavedPlan | null> {
  const { data, error } = await supabaseAdmin
    .from("coach_saved_plans")
    .select("*, coach_saved_sessions(*, coach_saved_exercises(*))")
    .eq("id", planId)
    .eq("coach_id", coachId)
    .single();

  if (error || !data) return null;

  const sessions = ((data.coach_saved_sessions ?? []) as CoachSavedSessionRow[])
    .sort((a, b) => a.order_index - b.order_index)
    .map((s: CoachSavedSessionRow & { coach_saved_exercises?: CoachSavedExerciseRow[] }) => {
      const exercises = (s.coach_saved_exercises ?? [])
        .sort((a: CoachSavedExerciseRow, b: CoachSavedExerciseRow) => a.order_index - b.order_index)
        .map(mapSavedExerciseRow);
      return mapSavedSessionRow(s, exercises);
    });
  return mapSavedPlanRow(data as CoachSavedPlanRow, sessions);
}

// --- Update / Delete ---

export async function updateSavedPlan(
  planId: string,
  coachId: string,
  updates: {
    name?: string;
    description?: string | null;
    splitType?: string | null;
    frequencyPerWeek?: number | null;
    cycleLength?: number | null;
    restPattern?: number[];
    defaultSurplusPercentage?: number | null;
    programDurationWeeks?: number | null;
  }
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("coach_saved_plans")
    .update({
      ...(updates.name !== undefined && { name: updates.name }),
      ...(updates.description !== undefined && { description: updates.description }),
      ...(updates.splitType !== undefined && { split_type: updates.splitType }),
      ...(updates.frequencyPerWeek !== undefined && { frequency_per_week: updates.frequencyPerWeek }),
      ...(updates.cycleLength !== undefined && { cycle_length: updates.cycleLength }),
      ...(updates.restPattern !== undefined && { rest_pattern: updates.restPattern }),
      ...(updates.defaultSurplusPercentage !== undefined && { default_surplus_percentage: updates.defaultSurplusPercentage }),
      ...(updates.programDurationWeeks !== undefined && { program_duration_weeks: updates.programDurationWeeks }),
    })
    .eq("id", planId)
    .eq("coach_id", coachId);
  if (error) throw new Error(`Failed to update saved plan: ${error.message}`);
}

/**
 * Input shape for overwriteSavedPlan — a working-copy of the plan's editable
 * state. Sessions must already have `orderIndex` reflecting their desired new
 * order. Rest sessions should have `isRest: true` and no exercises.
 */
export type OverwriteSavedPlanInput = {
  name?: string;
  description?: string | null;
  splitType?: string | null;
  defaultSurplusPercentage?: number | null;
  sessions: Array<{
    name: string;
    focus?: string | null;
    orderIndex: number;
    weekIndex?: number;
    isRest: boolean;
    estimatedDurationMinutes?: number | null;
    calorieSurplusPercentage?: number | null;
    notes?: string | null;
    sessionType?: string | null;
    exercises: Array<{
      name: string;
      exerciseId?: string | null;
      orderIndex: number;
      sets: number;
      repsMin?: number | null;
      repsMax?: number | null;
      repsTarget?: string | null;
      rpeTarget?: number | null;
      percentage1rm?: number | null;
      tempo?: string | null;
      restSeconds?: number | null;
      notes?: string | null;
      supersetGroup?: string | null;
      isWarmup?: boolean;
      setSpecs?: SetSpec[] | null;
      videoUrl?: string | null;
    }>;
  }>;
};

/**
 * Replace a saved plan's sessions + exercises with a new working-copy structure.
 * Used by "Save and Update Plan" — the coach has been editing an in-memory
 * working copy and is now committing those changes to the library template.
 *
 * Strategy: delete all existing sessions under the plan (cascade-deletes
 * exercises), then insert the new structure. Plan metadata (name, etc.) is
 * patched via updateSavedPlan separately; only sessions/exercises + derived
 * cycle info are handled here.
 *
 * Does NOT touch any client-side training_plans / training_events — those
 * reference training_sessions in the applied-calendar tables, which are
 * independent of coach_saved_sessions.
 */
export async function overwriteSavedPlan(
  planId: string,
  coachId: string,
  input: OverwriteSavedPlanInput,
): Promise<void> {
  // Ownership check.
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from("coach_saved_plans")
    .select("id")
    .eq("id", planId)
    .eq("coach_id", coachId)
    .single();
  if (fetchError || !existing) throw new Error("Plan not found or access denied");

  // Patch plan-level metadata (if provided) and derived cycle info. Shared helper
  // sorts by (weekIndex, orderIndex) across all weeks before deriving rest
  // positions, so a multi-week program derives correctly and identically to the
  // inline placement path and recomputePlanCycleInfo. Legacy single-week
  // (weekIndex 0) derives byte-identically to before.
  const { cycleLength, restPattern, frequencyPerWeek } =
    deriveCycleInfoFromSessions(input.sessions);

  // Collect all exercise names for catalog resolution before touching any rows
  // — we want to preserve exercise_id where the catalog already has them.
  const allNames: string[] = [];
  for (const s of input.sessions) {
    if (s.isRest) continue;
    for (const e of s.exercises) {
      // Only resolve names that don't already carry an exerciseId.
      if (!e.exerciseId) allNames.push(e.name);
    }
  }
  const exerciseIdMap = await resolveExercises(allNames, coachId);

  // H3 recoverability: insert the NEW tree first, then delete only the OLD
  // sessions once every insert succeeded, then write metadata last. The old
  // library template is never deleted until the replacement is fully in place,
  // so a mid-loop failure — or a hard timeout that never runs the catch —
  // leaves the original program intact. Worst case is duplicate sessions, which
  // a re-save cleans up; there is no unrecoverable wipe. (Delete-then-insert
  // did the opposite: a 5xx at session 100 permanently destroyed the template.)
  const { data: oldRows, error: oldErr } = await supabaseAdmin
    .from("coach_saved_sessions")
    .select("id")
    .eq("saved_plan_id", planId);
  if (oldErr) {
    throw new Error(`Failed to read existing sessions: ${oldErr.message}`);
  }
  const oldSessionIds = (oldRows ?? []).map((r) => r.id);

  // Insert the new structure, tracking new ids so a mid-loop failure can be
  // rolled back without touching the old sessions.
  const newSessionIds: string[] = [];
  try {
    for (const s of input.sessions) {
      const sessionRow: CoachSavedSessionInsert = {
        coach_id: coachId,
        saved_plan_id: planId,
        name: s.isRest ? "Rest" : s.name,
        focus: s.isRest ? null : (s.focus ?? null),
        order_index: s.orderIndex,
        week_index: s.weekIndex ?? 0,
        is_rest: s.isRest,
        estimated_duration_minutes: s.estimatedDurationMinutes ?? null,
        calorie_surplus_percentage: s.calorieSurplusPercentage ?? null,
        notes: s.notes ?? null,
        session_type: s.sessionType ?? "training",
      };

      const { data: newSession, error: sessionError } = await supabaseAdmin
        .from("coach_saved_sessions")
        .insert(sessionRow)
        .select("id")
        .single();
      if (sessionError || !newSession) {
        throw new Error(`Failed to insert session "${s.name}": ${sessionError?.message}`);
      }
      newSessionIds.push(newSession.id);

      if (s.isRest || s.exercises.length === 0) continue;

      // coach_saved_exercises has no coach_id column — ownership is inferred
      // via saved_session_id → coach_saved_sessions → coach_id.
      const exerciseRows = s.exercises.map((e) => {
        const w = projectExerciseCompact(e);
        return {
          saved_session_id: newSession.id,
          exercise_id: e.exerciseId ?? exerciseIdMap.get(e.name) ?? null,
          name: e.name,
          order_index: e.orderIndex,
          sets: w.sets,
          reps_min: w.reps_min,
          reps_max: w.reps_max,
          reps_target: e.repsTarget ?? null,
          rpe_target: e.rpeTarget ?? null,
          percentage_1rm: e.percentage1rm ?? null,
          tempo: e.tempo ?? null,
          rest_seconds: e.restSeconds ?? null,
          superset_group: e.supersetGroup ?? null,
          is_warmup: e.isWarmup ?? false,
          notes: e.notes ?? null,
          set_specs: w.set_specs,
          video_url: w.video_url,
        };
      });

      const { error: exError } = await supabaseAdmin
        .from("coach_saved_exercises")
        .insert(exerciseRows);
      if (exError) {
        throw new Error(`Failed to insert exercises for "${s.name}": ${exError.message}`);
      }
    }
  } catch (err) {
    // Roll back the partially-inserted NEW sessions (cascades their exercises)
    // so the original program survives. Never shadow the root cause.
    if (newSessionIds.length > 0) {
      const { error: rbErr } = await supabaseAdmin
        .from("coach_saved_sessions")
        .delete()
        .in("id", newSessionIds);
      if (rbErr) {
        const rootMsg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `${rootMsg}; rollback of partial insert also failed: ${rbErr.message}`,
        );
      }
    }
    throw err;
  }

  // New tree committed — now remove the old sessions (cascade-deletes their
  // exercises). A failure here leaves duplicates, which a re-save resolves.
  if (oldSessionIds.length > 0) {
    const { error: deleteError } = await supabaseAdmin
      .from("coach_saved_sessions")
      .delete()
      .in("id", oldSessionIds);
    if (deleteError) {
      throw new Error(`Failed to clear previous sessions: ${deleteError.message}`);
    }
  }

  // Metadata + derived cycle info LAST: if the structural swap failed above, the
  // plan header is never left describing content that isn't there.
  const { error: planUpdateError } = await supabaseAdmin
    .from("coach_saved_plans")
    .update({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.splitType !== undefined && { split_type: input.splitType }),
      ...(input.defaultSurplusPercentage !== undefined && {
        default_surplus_percentage: input.defaultSurplusPercentage,
      }),
      cycle_length: cycleLength,
      rest_pattern: restPattern,
      frequency_per_week: frequencyPerWeek,
    })
    .eq("id", planId)
    .eq("coach_id", coachId);
  if (planUpdateError) {
    throw new Error(`Failed to update plan metadata: ${planUpdateError.message}`);
  }
}

export async function deleteSavedPlan(planId: string, coachId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("coach_saved_plans")
    .delete()
    .eq("id", planId)
    .eq("coach_id", coachId);
  if (error) throw new Error(`Failed to delete saved plan: ${error.message}`);
}

/**
 * Deep-copy a saved plan (plan row + sessions + exercises) as a verbatim
 * server-side copy — set_specs, video_url, and resolved exercise_ids carry
 * as-is; nothing is re-resolved by name. Returns the new plan id.
 *
 * The name is deduped in TS against ALL of the coach's plan names (fetched
 * once — plan lists are small and ilike patterns would need %-escaping).
 * The base is capped so "name (copy N)" stays inside the overwrite schema's
 * 100-char name cap, or the first builder save of the copy would truncate it.
 */
export async function duplicateSavedPlan(
  planId: string,
  coachId: string
): Promise<string> {
  const { data: plan, error } = await supabaseAdmin
    .from("coach_saved_plans")
    .select("*, coach_saved_sessions(*, coach_saved_exercises(*))")
    .eq("id", planId)
    .eq("coach_id", coachId)
    .single();
  if (error || !plan) throw new Error("Plan not found");

  const { data: nameRows, error: namesError } = await supabaseAdmin
    .from("coach_saved_plans")
    .select("name")
    .eq("coach_id", coachId);
  if (namesError) {
    throw new Error(`Failed to check plan names: ${namesError.message}`);
  }
  const taken = new Set(
    (nameRows ?? []).map((r) => r.name.trim().toLowerCase())
  );
  const name = dedupeCopyName(plan.name, taken);

  const planInsert: CoachSavedPlanInsert = {
    coach_id: coachId,
    name,
    description: plan.description,
    split_type: plan.split_type,
    frequency_per_week: plan.frequency_per_week,
    status: plan.status, // duplicating a draft yields a draft
    cycle_length: plan.cycle_length,
    rest_pattern: plan.rest_pattern,
    default_surplus_percentage: plan.default_surplus_percentage,
    source: plan.source,
    coach_prompt: plan.coach_prompt,
    program_duration_weeks: plan.program_duration_weeks,
  };
  const { data: newPlan, error: planError } = await supabaseAdmin
    .from("coach_saved_plans")
    .insert(planInsert)
    .select("id")
    .single();
  if (planError || !newPlan) {
    throw new Error(`Failed to duplicate plan: ${planError?.message ?? "no row"}`);
  }

  try {
    const sessions = (
      (plan.coach_saved_sessions ?? []) as Array<
        CoachSavedSessionRow & { coach_saved_exercises?: CoachSavedExerciseRow[] }
      >
    ).sort(
      (a, b) => (a.week_index ?? 0) - (b.week_index ?? 0) || a.order_index - b.order_index
    );

    const exerciseRows: CoachSavedExerciseInsert[] = [];
    for (const s of sessions) {
      const sessionInsert: CoachSavedSessionInsert = {
        coach_id: coachId,
        saved_plan_id: newPlan.id,
        name: s.name,
        focus: s.focus,
        order_index: s.order_index,
        week_index: s.week_index ?? 0,
        is_rest: s.is_rest ?? false,
        estimated_duration_minutes: s.estimated_duration_minutes,
        calorie_surplus_percentage: s.calorie_surplus_percentage,
        notes: s.notes,
        session_type: s.session_type,
      };
      const { data: newSession, error: sessionError } = await supabaseAdmin
        .from("coach_saved_sessions")
        .insert(sessionInsert)
        .select("id")
        .single();
      if (sessionError || !newSession) {
        throw new Error(
          `Failed to copy session "${s.name}": ${sessionError?.message ?? "no row"}`
        );
      }
      exerciseRows.push(
        ...copySavedExerciseRows(s.coach_saved_exercises ?? [], newSession.id)
      );
    }

    if (exerciseRows.length > 0) {
      const { error: exError } = await supabaseAdmin
        .from("coach_saved_exercises")
        .insert(exerciseRows);
      if (exError) {
        throw new Error(`Failed to copy exercises: ${exError.message}`);
      }
    }
  } catch (copyError) {
    // Child copy failed part-way: remove the new plan (children cascade) so
    // the library never shows a half-duplicated program.
    await supabaseAdmin
      .from("coach_saved_plans")
      .delete()
      .eq("id", newPlan.id)
      .eq("coach_id", coachId);
    throw copyError;
  }

  return newPlan.id;
}

/**
 * Count live client assignments per saved plan (training_plans provenance).
 * "Live" = not soft-deleted and status active|planned — a scheduled future
 * placement is still an assignment (matches getClientTrainingPlan + the
 * mig-114 planned status). Aggregated in TS; pages through PostgREST's row
 * cap defensively.
 */
export async function getSavedPlanAssignments(coachId: string): Promise<{
  perPlan: Array<{ savedPlanId: string; count: number }>;
  totalAssignments: number;
  distinctClients: number;
}> {
  const PAGE = 1000;
  const rows: Array<{ saved_plan_id: string | null; client_id: string }> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("training_plans")
      .select("saved_plan_id, client_id")
      .eq("coach_id", coachId)
      .not("saved_plan_id", "is", null)
      .is("deleted_at", null)
      .in("status", ["active", "planned"])
      .range(from, from + PAGE - 1);
    if (error) {
      throw new Error(`Failed to fetch plan assignments: ${error.message}`);
    }
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  const counts = new Map<string, number>();
  const clients = new Set<string>();
  for (const row of rows) {
    if (!row.saved_plan_id) continue;
    counts.set(row.saved_plan_id, (counts.get(row.saved_plan_id) ?? 0) + 1);
    clients.add(row.client_id);
  }

  return {
    perPlan: [...counts.entries()].map(([savedPlanId, count]) => ({
      savedPlanId,
      count,
    })),
    totalAssignments: rows.length,
    distinctClients: clients.size,
  };
}

// =============================================================================
// Paginated / summary reads for the Programs library (offset pagination, lean).
// The list never renders sessions/exercises, and every column + stat-band KPI
// derives from stored plan scalars (cycle_length / rest_pattern / …), so these
// skip the nested-tree fetch getSavedPlans does. See the saved-plans route
// (opt-in ?limit/?offset) + /summary route.
// =============================================================================

const SLOTS_PER_WEEK = 7; // every authored week is exactly 7 positional day-slots

type SavedPlanListRow = {
  id: string;
  name: string;
  description: string | null;
  split_type: string | null;
  source: string | null;
  status: string | null;
  updated_at: string;
  created_at: string;
  cycle_length: number | null;
  rest_pattern: number[] | null;
  frequency_per_week: number | null;
};

function mapSavedPlanListRow(row: SavedPlanListRow): SavedPlanListItem {
  const totalSlots = row.cycle_length ?? 0;
  const restCount = (row.rest_pattern ?? []).length;
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    splitType: row.split_type ?? null,
    source: (row.source ?? "manual") as SavedPlanSource,
    status: (row.status ?? "draft") as SavedPlanStatus,
    frequencyPerWeek: row.frequency_per_week ?? null,
    // cycle_length = 7 × weeks (every week is a full 7-slot row set), so weeks =
    // slots / 7. round() keeps legacy non-7-multiple plans sensible.
    weekCount: Math.max(1, Math.round(totalSlots / SLOTS_PER_WEEK)),
    totalSlots,
    restCount,
    trainingCount: totalSlots - restCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Strip the characters PostgREST parses inside .or() so a free-text search term
// can't inject extra filters (defense-in-depth, like lib/cursor's validation).
function sanitizePlanSearch(raw: string | undefined): string {
  if (!raw) return "";
  return raw.replace(/[,()\\]/g, "").trim().slice(0, 100);
}

export async function getSavedPlansPage(
  coachId: string,
  opts: {
    includeDrafts?: boolean;
    limit: number;
    offset: number;
    search?: string;
    source?: "custom" | "ai";
    sort?: "updated" | "name" | "longest";
  },
): Promise<{ plans: SavedPlanListItem[]; total: number }> {
  const statuses = opts.includeDrafts ? ["saved", "draft"] : ["saved"];

  let filter = supabaseAdmin
    .from("coach_saved_plans")
    .select(
      "id, name, description, split_type, source, status, updated_at, created_at, cycle_length, rest_pattern, frequency_per_week",
      { count: "exact" },
    )
    .eq("coach_id", coachId)
    .in("status", statuses);

  // Segment: 'ai' = AI-generated; 'custom' = everything else.
  if (opts.source === "ai") filter = filter.eq("source", "ai");
  else if (opts.source === "custom") filter = filter.neq("source", "ai");

  const term = sanitizePlanSearch(opts.search);
  if (term) {
    filter = filter.or(`name.ilike.%${term}%,description.ilike.%${term}%`);
  }

  // 'longest' orders by cycle_length (∝ week count, 7 slots/week).
  const orderCol =
    opts.sort === "name" ? "name" : opts.sort === "longest" ? "cycle_length" : "updated_at";
  const orderAsc = opts.sort === "name";

  const { data, error, count } = await filter
    .order(orderCol, { ascending: orderAsc, nullsFirst: false })
    .order("id", { ascending: false }) // deterministic tiebreak for stable paging
    .range(opts.offset, opts.offset + opts.limit - 1);

  if (error) {
    throw new Error(`Failed to fetch saved plans page: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as SavedPlanListRow[];
  return { plans: rows.map(mapSavedPlanListRow), total: count ?? 0 };
}

export async function getSavedPlansSummary(
  coachId: string,
  opts?: { includeDrafts?: boolean },
): Promise<SavedPlansSummary> {
  const statuses = opts?.includeDrafts ? ["saved", "draft"] : ["saved"];

  // Lean scan (2 columns), paged past PostgREST's ~1000-row cap so counts stay
  // correct at scale (mirrors getSavedPlanAssignments).
  const rows: Array<{ source: string | null; cycle_length: number | null }> = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("coach_saved_plans")
      .select("source, cycle_length")
      .eq("coach_id", coachId)
      .in("status", statuses)
      .range(from, from + PAGE - 1);
    if (error) {
      throw new Error(`Failed to fetch saved plans summary: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    rows.push(
      ...(data as unknown as Array<{ source: string | null; cycle_length: number | null }>),
    );
    if (data.length < PAGE) break;
  }

  const total = rows.length;
  const aiCount = rows.filter((r) => r.source === "ai").length;
  const weekCounts = rows.map((r) =>
    Math.max(1, Math.round((r.cycle_length ?? 0) / SLOTS_PER_WEEK)),
  );
  const avgWeeks =
    weekCounts.length > 0
      ? Math.round((weekCounts.reduce((a, b) => a + b, 0) / weekCounts.length) * 10) / 10
      : null;

  return {
    total,
    aiCount,
    customCount: total - aiCount,
    avgWeeks,
    minWeeks: weekCounts.length > 0 ? Math.min(...weekCounts) : 0,
    maxWeeks: weekCounts.length > 0 ? Math.max(...weekCounts) : 0,
  };
}
