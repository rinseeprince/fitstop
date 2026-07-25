import { supabaseAdmin } from "./supabase-admin";
import type {
  ClientTrainingPlan,
  ClientTrainingSessionEntry,
  ClientTrainingExercise,
} from "@/types/client-training-plan";
import type { SetSpec } from "@/utils/exercise-set-specs";
import { fetchAllByChunkedIds } from "@/lib/paged-fetch";

type TrainingSessionRow = {
  id: string;
  name: string;
  focus: string | null;
  order_index: number;
  week_index: number;
  is_rest: boolean;
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
  set_specs: SetSpec[] | null;
  video_url: string | null;
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
    setSpecs: row.set_specs ?? null,
    videoUrl: row.video_url ?? null,
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
    weekIndex: row.week_index ?? 0,
    isRest: row.is_rest ?? false,
    estimatedDurationMinutes: row.estimated_duration_minutes,
    exercises,
  };
}

/**
 * Client-facing read of the active training plan for a client.
 *
 * Resolution: the active `training_plans` row for the client (status='active',
 * not soft-deleted, not superseded).
 *
 * The plan describes itself: placement clones every authored slot — training and
 * rest alike — as real rows, so the returned entries are the whole program in
 * `(week_index, order_index)` order with rest days carried as `isRest` rows. No
 * library-template join is needed.
 */
export async function getClientTrainingPlan(
  clientId: string
): Promise<ClientTrainingPlan | null> {
  const { data: planRow, error: planErr } = await supabaseAdmin
    .from("training_plans")
    .select("id, name")
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
    .select(
      "id, name, focus, order_index, week_index, is_rest, estimated_duration_minutes"
    )
    .eq("plan_id", planRow.id)
    .eq("is_active", true)
    .order("week_index", { ascending: true })
    .order("order_index", { ascending: true });

  if (sessionErr) {
    throw new Error(`Failed to fetch training sessions: ${sessionErr.message}`);
  }

  const sessions = (sessionRows ?? []) as TrainingSessionRow[];

  const exercisesBySession = new Map<string, ClientTrainingExercise[]>();
  if (sessions.length > 0) {
    const sessionIds = sessions.map((s) => s.id);
    // Chunked AND paged -- same silent truncation as training-service.ts, and
    // worse here because this read has no is_rest filter, so it carries more
    // sessions. Unpaged, a long program lost a horizontal slice of exercises
    // across every session with no error.
    const exerciseRows = await fetchAllByChunkedIds(sessionIds, (chunk, from, to) =>
      supabaseAdmin
        .from("training_exercises")
        .select(
          "id, session_id, name, order_index, sets, reps_min, reps_max, reps_target, rpe_target, tempo, rest_seconds, is_warmup, superset_group, set_specs, video_url"
        )
        .in("session_id", chunk)
        .eq("is_active", true)
        .order("session_id", { ascending: true })
        .order("order_index", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
      { errorLabel: "training exercises" },
    );

    for (const row of (exerciseRows ?? []) as TrainingExerciseRow[]) {
      const list = exercisesBySession.get(row.session_id) ?? [];
      list.push(mapExercise(row));
      exercisesBySession.set(row.session_id, list);
    }
  }

  const flatEntries: ClientTrainingSessionEntry[] = sessions.map((row) =>
    mapSession(row, exercisesBySession.get(row.id) ?? [])
  );

  return {
    planId: planRow.id,
    planName: planRow.name,
    sessions: flatEntries,
  };
}
