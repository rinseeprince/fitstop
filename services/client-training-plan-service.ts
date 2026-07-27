import { supabaseAdmin } from "./supabase-admin";
import type {
  ClientTrainingPlan,
  ClientTrainingPlanState,
  ClientTrainingSessionEntry,
  ClientTrainingExercise,
} from "@/types/client-training-plan";
import type { SetSpec } from "@/utils/exercise-set-specs";
import { fetchAllByChunkedIds } from "@/lib/paged-fetch";
import { coversDate } from "./training-plan-window";
import { calculatePlacementEndDate } from "./program-event-walk";
import { getNextFutureTrainingPlan, type NextFutureTrainingPlan } from "./training-service";
import { getClientTodayString } from "./today-service";

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

type ResolvedPlanRow = { id: string; name: string; effective_from: string };

/**
 * The program whose window has already opened — newest start wins, `created_at`
 * breaking ties. Identical ordering to the coach's `getTrainingPlanForDate`, so
 * the two audiences pick the same row; only the STATUS half differs, and
 * deliberately (see `training-plan-window.ts`).
 */
async function fetchStartedPlan(
  clientId: string,
  today: string
): Promise<ResolvedPlanRow | null> {
  const { data, error } = await coversDate(
    supabaseAdmin
      .from("training_plans")
      .select("id, name, effective_from")
      .eq("client_id", clientId)
      .eq("status", "active")
      .is("deleted_at", null),
    today
  )
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch training plan: ${error.message}`);
  return data;
}

/**
 * Client-facing read of the training plan a client is on.
 *
 * **Resolution is by DATE, not by creation order.** Placement is additive, so a
 * client can hold several coexisting `status='active'` rows, and nothing ever
 * writes `effective_until` — the old "newest created, no end date" predicate
 * therefore answered a different question from the coach side and got both ends
 * wrong: a program placed to start next month became the client's current one
 * the moment it was created, and a finished program stayed current forever.
 *
 * That divergence was reachable, not theoretical. `SessionPicker` lists from
 * this endpoint while `GET /api/client/training/sessions/[sessionId]` validates
 * the pick against `getActiveTrainingPlanId` (date-driven) — so whenever the two
 * resolvers disagreed, every session the client picked 404'd.
 *
 * The status filter stays `eq('active')` rather than the coach's
 * `neq('archived')`: `PATCH /api/clients/[id]/training/[planId]` can write any
 * of the four CHECK values, and 'draft' / 'planned' plans must not reach a
 * client.
 *
 * Returns the resolved program in the priority order active → upcoming → ended
 * (a queued program is live information; a finished one is history), each
 * labelled with `state` so the caller decides what to render. `null` means the
 * client has no active, non-deleted plan at all — unchanged from before.
 *
 * The plan describes itself: placement clones every authored slot — training and
 * rest alike — as real rows, so the returned entries are the whole program in
 * `(week_index, order_index)` order with rest days carried as `isRest` rows. No
 * library-template join is needed.
 */
export async function getClientTrainingPlan(
  clientId: string
): Promise<ClientTrainingPlan | null> {
  const today = await getClientTodayString(clientId);

  const startedPlan = await fetchStartedPlan(clientId, today);
  if (startedPlan) {
    // A started plan stays current only until its date-walk runs out. The window
    // comes from the slot count via the SAME helper the amendment surface uses
    // for `isFullyPast`, so the coach's editor and the client's app agree on the
    // day a program ends. (The Overview's "Ended" chip derives its own from
    // authored duration — see docs/ARCHITECTURE.md.)
    const entries = await fetchPlanEntries(startedPlan.id);
    const endsOn = await calculatePlacementEndDate({
      clientId,
      slotCount: entries.length,
      startDate: startedPlan.effective_from,
    });
    if (today <= endsOn) {
      return buildPlan(startedPlan, entries, "active", endsOn);
    }

    // Ended. A queued program still outranks it — that is live information,
    // where a finished program is history.
    const queued = await getNextFutureTrainingPlan(clientId, today);
    if (queued) return buildQueuedPlan(clientId, queued);
    return buildPlan(startedPlan, entries, "ended", endsOn);
  }

  const queued = await getNextFutureTrainingPlan(clientId, today);
  if (queued) return buildQueuedPlan(clientId, queued);
  return null;
}

function buildPlan(
  plan: ResolvedPlanRow,
  sessions: ClientTrainingSessionEntry[],
  state: ClientTrainingPlanState,
  endsOn: string
): ClientTrainingPlan {
  return {
    planId: plan.id,
    planName: plan.name,
    sessions,
    state,
    startsOn: plan.effective_from,
    endsOn,
  };
}

async function buildQueuedPlan(
  clientId: string,
  queued: NextFutureTrainingPlan
): Promise<ClientTrainingPlan> {
  const plan: ResolvedPlanRow = {
    id: queued.id,
    name: queued.name,
    effective_from: queued.effectiveFrom,
  };
  const entries = await fetchPlanEntries(plan.id);
  const endsOn = await calculatePlacementEndDate({
    clientId,
    slotCount: entries.length,
    startDate: plan.effective_from,
  });
  return buildPlan(plan, entries, "upcoming", endsOn);
}

/**
 * Every authored slot of a placed plan, rest rows included, in date-walk order.
 * Deliberately unlike the coach-side `fetchSessionsWithExercises`, which filters
 * `is_rest = false` to keep its counts workout-only.
 */
async function fetchPlanEntries(planId: string): Promise<ClientTrainingSessionEntry[]> {
  const { data: sessionRows, error: sessionErr } = await supabaseAdmin
    .from("training_sessions")
    .select(
      "id, name, focus, order_index, week_index, is_rest, estimated_duration_minutes"
    )
    .eq("plan_id", planId)
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

  return sessions.map((row) => mapSession(row, exercisesBySession.get(row.id) ?? []));
}
