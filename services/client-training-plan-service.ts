import { supabaseAdmin } from "./supabase-admin";
import { toPrescribedFields } from "@/utils/prescribed-fields";
import type {
  ClientTrainingPlan,
  ClientTrainingPlanState,
  ClientTrainingSessionEntry,
  ClientTrainingExercise,
  ClientTrainingExerciseGroup,
} from "@/types/client-training-plan";
import type { SetSpec } from "@/utils/exercise-set-specs";
import {
  groupSettingsFromRow,
  nestRowsIntoGroups,
  type GroupSettingsRow,
} from "@/utils/exercise-groups";
import { fetchAllByChunkedIds, fetchAllPages } from "@/lib/paged-fetch";
import { expandDateRange } from "@/lib/date-helpers";
import { sessionsByDay } from "./calendar-day-events";
import { coversDate } from "./training-plan-window";
import { getNextFutureTrainingPlan, type NextFutureTrainingPlan } from "./training-service";
import { getClientTodayString } from "./today-service";

const DAYS_PER_WEEK = 7;

/** One of the client's events in the program's window — a session a day holds. */
type DayEventRow = {
  id: string;
  date: string;
  day_order: number;
  status: string;
  training_session_id: string | null;
  session_name: string;
  session_focus: string | null;
};

/** The session row an event points at. */
type DaySessionRow = {
  id: string;
  name: string;
  focus: string | null;
  estimated_duration_minutes: number | null;
};

/** One of the plan's own rest rows, placed on a day by its coordinates. */
type PlanSlotRow = {
  id: string;
  week_index: number;
  order_index: number;
};

/** The group an exercise sits in, as the client read selects it. */
type ExerciseGroupRow = GroupSettingsRow & { id: string; order_index: number };

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
  set_specs: SetSpec[] | null;
  video_url: string | null;
  prescribed_fields: string[];
  exercise_group: ExerciseGroupRow;
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
    setSpecs: row.set_specs ?? null,
    videoUrl: row.video_url ?? null,
    prescribedFields: toPrescribedFields(row.prescribed_fields),
  };
}

/** One session's exercise rows as its groups, in order. */
function mapGroups(rows: TrainingExerciseRow[]): ClientTrainingExerciseGroup[] {
  return nestRowsIntoGroups(rows.map((row) => ({ group: row.exercise_group, exercise: row }))).map(
    ({ group, exercises }) => ({
      id: group.id,
      orderIndex: group.order_index,
      ...groupSettingsFromRow(group),
      exercises: exercises.map(mapExercise),
    }),
  );
}

/**
 * The program day a plan row sits on, 0-based from `effective_from`. Placement
 * writes `order_index` as the authored week × 7 + day and offsets `week_index`
 * by the authored span on every repeated cycle; the plan editor's save writes
 * `week_index` = ⌊day / 7⌋ and `order_index` = day. Both land on this formula.
 */
function programDayOfRow(row: PlanSlotRow): number {
  return row.week_index * DAYS_PER_WEEK + (row.order_index % DAYS_PER_WEEK);
}

type ResolvedPlanRow = { id: string; name: string; effective_from: string; effective_until: string };

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
      .select("id, name, effective_from, effective_until")
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
 * client can hold several coexisting `status='active'` rows, and both ends are
 * on the row (migration 167): the program whose window covers the client's
 * today is the one they are on.
 *
 * The status filter stays `eq('active')` rather than the coach's
 * `neq('archived')`: `PATCH /api/clients/[id]/training/[planId]` can write any
 * of the four CHECK values, and 'draft' / 'planned' plans must not reach a
 * client.
 *
 * Returns the resolved program in the priority order active → upcoming → ended
 * (a queued program is live information; a finished one is history), each
 * labelled with `state` so the caller decides what to render. `null` means the
 * client has no active, non-deleted plan at all.
 *
 * The entries are the program as it is on the client's calendar — one per
 * session on each day of the window, in the day's order, rest days carried as
 * `isRest` entries — so a moved session shows on its new date
 * (`fetchPlanEntries`).
 * No library-template join is needed.
 */
export async function getClientTrainingPlan(
  clientId: string
): Promise<ClientTrainingPlan | null> {
  const today = await getClientTodayString(clientId);

  const startedPlan = await fetchStartedPlan(clientId, today);
  if (startedPlan) {
    // A started plan stays current only until its window runs out. The end is
    // on the row (migration 167) — the same fact the coach's hero, the Overview
    // and the plan editor read, so every surface agrees on the day a program
    // ends.
    const entries = await fetchPlanEntries(clientId, startedPlan);
    const endsOn = startedPlan.effective_until;
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
    effective_until: queued.effectiveUntil,
  };
  const entries = await fetchPlanEntries(clientId, plan);
  return buildPlan(plan, entries, "upcoming", plan.effective_until);
}

/**
 * The program as it is on the client's calendar: one entry per session on each
 * day of the window `[effective_from, effective_until]`, in date order and each
 * day's sessions in the day's order — `orderIndex` is the day's position (a day
 * holding several sessions gives each the same one), `weekIndex` the week
 * holding it.
 *
 * A day is what the calendar holds on its date, whichever plan wrote it: a
 * program's days are dates, never plan ids. Each session on the day
 * (`sessionsByDay`) names the session row it shows, read by id with no
 * `is_active` filter — whatever row an event points at is what that session
 * holds — and scoped to the client through the row's plan. When that row cannot
 * be read, the entry lays from the event's own snapshot. A day the calendar
 * holds nothing on is a rest day, identified by the plan's own rest row at that
 * day, or by the plan and the position when there is none (a day whose sessions
 * were moved away or removed) — so no rest day borrows the id of a session
 * showing elsewhere.
 *
 * So a moved session shows on its new date only, and each session shows the
 * row its event points at, whatever other row sits at the same coordinates.
 *
 * Four reads, two at a time: the window's events beside the plan's own rows,
 * then the days' rows beside their exercises.
 */
async function fetchPlanEntries(
  clientId: string,
  plan: ResolvedPlanRow
): Promise<ClientTrainingSessionEntry[]> {
  const [eventRows, planRows] = await Promise.all([
    fetchAllPages<DayEventRow>(
      (from, to) =>
        supabaseAdmin
          .from("training_events")
          .select("id, date, day_order, status, training_session_id, session_name, session_focus")
          .eq("client_id", clientId)
          .gte("date", plan.effective_from)
          .lte("date", plan.effective_until)
          .order("date", { ascending: true })
          .order("day_order", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      { errorLabel: "training events" }
    ),
    fetchAllPages<PlanSlotRow>(
      (from, to) =>
        supabaseAdmin
          .from("training_sessions")
          .select("id, week_index, order_index")
          .eq("plan_id", plan.id)
          .eq("is_active", true)
          .eq("is_rest", true)
          // Earliest first: the day keeps the row written first.
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      { errorLabel: "the plan's training sessions" }
    ),
  ]);

  const eventsByDay = sessionsByDay(eventRows);
  const sessionIds = [
    ...new Set(
      eventRows
        .map((event) => event.training_session_id)
        .filter((id): id is string => id !== null)
    ),
  ];

  // Both reads key on the ids the days' events point at, so they run together;
  // an exercise reaches a day only through a row the client-scoped read
  // returned. Chunked AND paged: a long program's exercises pass the ~1000-row
  // cap, which PostgREST truncates without an error.
  const [sessionRows, exerciseRows] = await Promise.all([
    fetchAllByChunkedIds<DaySessionRow, string>(
      sessionIds,
      (chunk, from, to) =>
        supabaseAdmin
          .from("training_sessions")
          .select("id, name, focus, estimated_duration_minutes, training_plans!inner(client_id)")
          .in("id", chunk)
          .eq("training_plans.client_id", clientId)
          .order("id", { ascending: true })
          .range(from, to),
      { errorLabel: "training sessions" }
    ),
    fetchAllByChunkedIds(sessionIds, (chunk, from, to) =>
      supabaseAdmin
        .from("training_exercises")
        .select(
          "id, session_id, name, order_index, sets, reps_min, reps_max, reps_target, rpe_target, tempo, rest_seconds, is_warmup, set_specs, video_url, prescribed_fields, exercise_group:training_exercise_groups!training_exercises_group_fkey(id, order_index, format, rounds, time_cap_seconds, interval_seconds, rest_between_exercises_seconds, rest_between_rounds_seconds, notes)"
        )
        .in("session_id", chunk)
        .eq("is_active", true)
        .order("session_id", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
      { errorLabel: "training exercises" },
    ),
  ]);

  const rowsById = new Map(sessionRows.map((row) => [row.id, row]));

  // Each session's exercises in their groups, in order.
  const exerciseRowsBySession = new Map<string, TrainingExerciseRow[]>();
  for (const row of exerciseRows as unknown as TrainingExerciseRow[]) {
    const list = exerciseRowsBySession.get(row.session_id) ?? [];
    list.push(row);
    exerciseRowsBySession.set(row.session_id, list);
  }
  const groupsBySession = new Map(
    [...exerciseRowsBySession].map(([sessionId, rows]) => [sessionId, mapGroups(rows)]),
  );

  const planRowIdByDay = new Map<number, string>();
  for (const row of planRows) {
    const day = programDayOfRow(row);
    if (!planRowIdByDay.has(day)) planRowIdByDay.set(day, row.id);
  }

  return expandDateRange(plan.effective_from, plan.effective_until).flatMap(
    (date, position): ClientTrainingSessionEntry[] => {
      const orderIndex = position;
      const weekIndex = Math.floor(position / DAYS_PER_WEEK);
      const events = eventsByDay.get(date) ?? [];

      if (events.length === 0) {
        return [
          {
            id: planRowIdByDay.get(position) ?? `${plan.id}:${position}`,
            name: "Rest",
            focus: null,
            orderIndex,
            weekIndex,
            isRest: true,
            estimatedDurationMinutes: null,
            groups: [],
          },
        ];
      }

      return events.map((event): ClientTrainingSessionEntry => {
        const row = event.training_session_id
          ? rowsById.get(event.training_session_id)
          : undefined;
        if (!row) {
          return {
            id: event.id,
            name: event.session_name,
            focus: event.session_focus,
            orderIndex,
            weekIndex,
            isRest: false,
            estimatedDurationMinutes: null,
            groups: [],
          };
        }

        return {
          id: row.id,
          name: row.name,
          focus: row.focus,
          orderIndex,
          weekIndex,
          isRest: false,
          estimatedDurationMinutes: row.estimated_duration_minutes,
          groups: groupsBySession.get(row.id) ?? [],
        };
      });
    }
  );
}
