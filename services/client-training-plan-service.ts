import { supabaseAdmin } from "./supabase-admin";
import type {
  ClientTrainingPlan,
  ClientTrainingSessionEntry,
  ClientTrainingExercise,
} from "@/types/client-training-plan";

type TrainingSessionRow = {
  id: string;
  name: string;
  focus: string | null;
  order_index: number;
  estimated_duration_minutes: number | null;
};

type TrainingExerciseRow = {
  id: string;
  session_id: string;
  name: string;
  order_index: number;
  sets: number;
  reps_min: number | null;
  reps_max: number | null;
  reps_target: string | null;
  rpe_target: number | null;
  tempo: string | null;
  rest_seconds: number | null;
  is_warmup: boolean | null;
  superset_group: string | null;
};

function mapExercise(row: TrainingExerciseRow): ClientTrainingExercise {
  return {
    id: row.id,
    name: row.name,
    orderIndex: row.order_index,
    sets: row.sets,
    repsMin: row.reps_min,
    repsMax: row.reps_max,
    repsTarget: row.reps_target,
    rpeTarget: row.rpe_target,
    tempo: row.tempo,
    restSeconds: row.rest_seconds,
    isWarmup: row.is_warmup ?? false,
    supersetGroup: row.superset_group,
  };
}

function mapSession(
  row: TrainingSessionRow,
  exercises: ClientTrainingExercise[]
): ClientTrainingSessionEntry {
  return {
    id: row.id,
    name: row.name,
    focus: row.focus,
    orderIndex: row.order_index,
    isRest: false,
    estimatedDurationMinutes: row.estimated_duration_minutes,
    exercises,
  };
}

function buildRestEntry(orderIndex: number): ClientTrainingSessionEntry {
  return {
    id: `rest-${orderIndex}`,
    name: "Rest",
    focus: null,
    orderIndex,
    isRest: true,
    estimatedDurationMinutes: null,
    exercises: [],
  };
}

/**
 * Client-facing read of the active training plan for a client.
 *
 * Resolution: the active `training_plans` row for the client (status='active',
 * not soft-deleted, not superseded). Phase linkage on the plan is NOT required —
 * `training_plans.phase_id` is nullable per ARCHITECTURE.md, and the placement
 * service caps the plan's calendar reach at the client's containing phase
 * end date regardless of the link. Pulling by `phase_id` would silently drop
 * any plan that was placed without explicit phase selection.
 *
 * For library-placed plans (`saved_plan_id` set, `coach_saved_plans.cycle_length`
 * and `rest_pattern` populated), splices synthetic rest entries into the cycle
 * sequence — rest sessions are filtered out of `training_sessions` at clone time
 * (`library-placement-service.ts:128`), so the saved-plan join is the authoritative
 * source for rest positions. AI plans or plans with null cycle metadata fall through
 * to a flat sessions list (cycleLength = sessions.length, restPattern = []).
 */
export async function getClientTrainingPlan(
  clientId: string
): Promise<ClientTrainingPlan | null> {
  const { data: planRow, error: planErr } = await supabaseAdmin
    .from("training_plans")
    .select("id, name, saved_plan_id")
    .eq("client_id", clientId)
    .eq("status", "active")
    .is("deleted_at", null)
    .is("effective_until", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (planErr) {
    throw new Error(`Failed to fetch training plan: ${planErr.message}`);
  }
  if (!planRow) return null;

  const { data: sessionRows, error: sessionErr } = await supabaseAdmin
    .from("training_sessions")
    .select("id, name, focus, order_index, estimated_duration_minutes")
    .eq("plan_id", planRow.id)
    .eq("is_active", true)
    .order("order_index", { ascending: true });

  if (sessionErr) {
    throw new Error(`Failed to fetch training sessions: ${sessionErr.message}`);
  }

  const sessions = (sessionRows ?? []) as TrainingSessionRow[];

  const exercisesBySession = new Map<string, ClientTrainingExercise[]>();
  if (sessions.length > 0) {
    const sessionIds = sessions.map((s) => s.id);
    const { data: exerciseRows, error: exerciseErr } = await supabaseAdmin
      .from("training_exercises")
      .select(
        "id, session_id, name, order_index, sets, reps_min, reps_max, reps_target, rpe_target, tempo, rest_seconds, is_warmup, superset_group"
      )
      .in("session_id", sessionIds)
      .eq("is_active", true)
      .order("order_index", { ascending: true });

    if (exerciseErr) {
      throw new Error(
        `Failed to fetch training exercises: ${exerciseErr.message}`
      );
    }

    for (const row of (exerciseRows ?? []) as TrainingExerciseRow[]) {
      const list = exercisesBySession.get(row.session_id) ?? [];
      list.push(mapExercise(row));
      exercisesBySession.set(row.session_id, list);
    }
  }

  const flatEntries: ClientTrainingSessionEntry[] = sessions.map((row) =>
    mapSession(row, exercisesBySession.get(row.id) ?? [])
  );

  if (planRow.saved_plan_id) {
    const { data: savedPlanRow, error: savedPlanErr } = await supabaseAdmin
      .from("coach_saved_plans")
      .select("cycle_length, rest_pattern")
      .eq("id", planRow.saved_plan_id)
      .maybeSingle();

    if (savedPlanErr) {
      throw new Error(
        `Failed to fetch coach saved plan: ${savedPlanErr.message}`
      );
    }

    if (
      savedPlanRow &&
      savedPlanRow.cycle_length != null &&
      savedPlanRow.rest_pattern != null
    ) {
      const cycleLength = savedPlanRow.cycle_length;
      const restPattern = savedPlanRow.rest_pattern;
      const restSet = new Set(restPattern);
      const sessionByOrderIndex = new Map<number, ClientTrainingSessionEntry>();
      for (const entry of flatEntries) {
        sessionByOrderIndex.set(entry.orderIndex, entry);
      }

      const spliced: ClientTrainingSessionEntry[] = [];
      for (let i = 0; i < cycleLength; i++) {
        if (restSet.has(i)) {
          spliced.push(buildRestEntry(i));
          continue;
        }
        const real = sessionByOrderIndex.get(i);
        if (real) spliced.push(real);
      }

      return {
        planId: planRow.id,
        planName: planRow.name,
        cycleLength,
        restPattern,
        sessions: spliced,
      };
    }
  }

  return {
    planId: planRow.id,
    planName: planRow.name,
    cycleLength: flatEntries.length,
    restPattern: [],
    sessions: flatEntries,
  };
}
