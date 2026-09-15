import { z } from "zod";
import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString } from "./today-service";
import { resolveEventDeletionFloor } from "./event-deletion-floor";
import { resolveWindowCap, type WindowCap } from "./program-event-walk";
import { deriveFrequencyPerWeek } from "./coach-library-helpers";
import { fetchVisibleExerciseIds } from "./library-placement-service";
import { eventByDay } from "./calendar-day-events";
import { mapExerciseRow } from "./training-mappers";
import { fetchAllPages, fetchAllByChunkedIds } from "@/lib/paged-fetch";
import { addDaysToDateString } from "@/lib/date-helpers";
import { daysBetween } from "@/utils/metric-points";
import { toPrescribedFields } from "@/utils/prescribed-fields";
import type { savedSessionInputSchema } from "@/lib/validations/training";
import type { TrainingExercise } from "@/types/training";
import type { TrainingExerciseRow } from "@/lib/database-helpers";

// =============================================================================
// Edit plan: the plan editor opens a client's program as it is laid on the
// calendar, and whatever the coach leaves in it becomes the plan from the
// first day that can still change.
//
// The read lays the calendar out day by day from the plan's start (the day's
// session, whatever the coach moved, deleted or edited "just this day", else
// rest) and hands back a version: everything the editor was built from. The
// save sends the version back, and edit_training_plan_atomic (migration 175)
// refuses it in the same transaction as the write when any of it changed.
// =============================================================================

type PlanEditSessionInput = z.infer<typeof savedSessionInputSchema>;

/** One day of the plan as the editor opens it. */
export type PlanEditDay =
  | { date: string; isRest: true }
  | {
      date: string;
      isRest: false;
      name: string;
      focus: string | null;
      estimatedDurationMinutes: number | null;
      notes: string | null;
      /** The day's event carries the per-date value. */
      calorieSurplusPercentage: number | null;
      exercises: TrainingExercise[];
    };

export type PlanForEditing = {
  plan: {
    id: string;
    name: string;
    splitType: string | null;
    effectiveFrom: string;
    effectiveUntil: string;
  };
  clientToday: string;
  /** The first day that can change: the deletion floor, never before the start. */
  firstEditableDate: string;
  /** The last day the plan may reach and what sets it; null when nothing does. */
  limit: WindowCap | null;
  /** One day per date from the plan's start to the end of its last week. */
  days: PlanEditDay[];
  /** Opaque: the save sends it back unchanged. */
  version: string;
};

type PlanEditResult = {
  firstDay: string;
  lastDay: string;
  sessionsWritten: number;
};

/** The plan is not this client's, or not live. Route: 404. */
export class PlanEditNotFoundError extends Error {
  constructor() {
    super("Plan not found");
  }
}

/** An ended plan is not opened or saved. Route: 404 with this sentence. */
export class PlanEndedError extends Error {
  constructor() {
    super("This plan has ended and can't be edited.");
  }
}

/** Something the editor was built from changed. Route: 409. */
export class PlanEditStaleError extends Error {
  constructor() {
    super("This plan changed while you were editing");
  }
}

/** A malformed save (not a whole-week grid, or a tampered version). Route: 400. */
export class PlanEditInvalidError extends Error {}

const DAYS_PER_WEEK = 7;

type PlanRow = {
  id: string;
  name: string;
  split_type: string | null;
  effective_from: string;
  effective_until: string;
  updated_at: string;
};

type CalendarEventRow = {
  id: string;
  date: string;
  status: string;
  training_session_id: string | null;
  session_name: string;
  session_focus: string | null;
  calorie_surplus_percentage: number | null;
};

type SessionRow = {
  id: string;
  name: string;
  focus: string | null;
  estimated_duration_minutes: number | null;
  notes: string | null;
  updated_at: string;
};

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// The version's own shape, in the columns migration 175 compares.
const versionSchema = z.object({
  plan_updated_at: z.string().min(1).max(64),
  from: dateString,
  through: dateString,
  limit: dateString.nullable(),
  events: z
    .array(
      z.object({
        id: z.string().uuid(),
        date: dateString,
        training_session_id: z.string().uuid().nullable(),
        status: z.string().min(1).max(20),
        calorie_surplus_percentage: z.number().nullable(),
      }),
    )
    .max(2000),
  sessions: z
    .array(z.object({ id: z.string().uuid(), updated_at: z.string().min(1).max(64) }))
    .max(2000),
});
type PlanEditVersion = z.infer<typeof versionSchema>;

function encodeVersion(version: PlanEditVersion): string {
  return Buffer.from(JSON.stringify(version), "utf8").toString("base64url");
}

function decodeVersion(encoded: string): PlanEditVersion {
  try {
    const parsed = versionSchema.safeParse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
    if (parsed.success) return parsed.data;
  } catch {
    // Not base64url JSON — refused below like any other malformed version.
  }
  throw new PlanEditInvalidError("The editor's version is malformed");
}

/** The last day of the whole weeks that cover a plan's window. */
function lastDayOfWeeks(effectiveFrom: string, effectiveUntil: string): string {
  const days = daysBetween(effectiveFrom, effectiveUntil) + 1;
  return addDaysToDateString(
    effectiveFrom,
    Math.ceil(days / DAYS_PER_WEEK) * DAYS_PER_WEEK - 1,
  );
}

const later = (a: string, b: string) => (a > b ? a : b);
const earlier = (a: string, b: string) => (a < b ? a : b);

async function readPlan(clientId: string, planId: string): Promise<PlanRow | null> {
  const { data, error } = await supabaseAdmin
    .from("training_plans")
    .select("id, name, split_type, effective_from, effective_until, updated_at")
    .eq("id", planId)
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .neq("status", "archived")
    .maybeSingle();
  if (error) throw new Error(`Failed to read the plan: ${error.message}`);
  return data;
}

/** The first editable day and the plan's limit, as of now. */
async function resolveEditableDays(clientId: string, plan: PlanRow, clientToday: string) {
  const [floor, { cap }] = await Promise.all([
    resolveEventDeletionFloor(clientId, clientToday),
    resolveWindowCap(clientId, plan.effective_from),
  ]);
  return { firstEditableDate: later(floor, plan.effective_from), limit: cap };
}

async function readCalendar(
  clientId: string,
  from: string,
  through: string,
): Promise<CalendarEventRow[]> {
  return fetchAllPages<CalendarEventRow>(
    (rangeFrom, rangeTo) =>
      supabaseAdmin
        .from("training_events")
        .select(
          "id, date, status, training_session_id, session_name, session_focus, calorie_surplus_percentage",
        )
        .eq("client_id", clientId)
        .gte("date", from)
        .lte("date", through)
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(rangeFrom, rangeTo),
    { errorLabel: "the plan's calendar" },
  );
}

// By the days' session ids, scoped to the client through the plan, with NO
// is_active filter: whatever row a day points at is what that day holds.
async function readSessionRows(clientId: string, ids: string[]): Promise<SessionRow[]> {
  return fetchAllByChunkedIds<SessionRow, string>(
    ids,
    (chunk, from, to) =>
      supabaseAdmin
        .from("training_sessions")
        .select(
          "id, name, focus, estimated_duration_minutes, notes, updated_at, training_plans!inner(client_id)",
        )
        .in("id", chunk)
        .eq("training_plans.client_id", clientId)
        .order("id", { ascending: true })
        .range(from, to),
    { errorLabel: "the plan's sessions" },
  );
}

async function readExercises(sessionIds: string[]): Promise<Map<string, TrainingExercise[]>> {
  const rows = await fetchAllByChunkedIds<TrainingExerciseRow, string>(
    sessionIds,
    (chunk, from, to) =>
      supabaseAdmin
        .from("training_exercises")
        .select("*")
        .in("session_id", chunk)
        .eq("is_active", true)
        .order("session_id", { ascending: true })
        .order("order_index", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    { errorLabel: "the plan's exercises" },
  );
  const bySession = new Map<string, TrainingExercise[]>();
  for (const row of rows) {
    const list = bySession.get(row.session_id) ?? [];
    list.push(mapExerciseRow(row));
    bySession.set(row.session_id, list);
  }
  return bySession;
}

/**
 * One day per date from `from` to `gridEnd`. Up to `layThrough` a day holds
 * its event's session, read through the row it points at (an event whose row
 * cannot be read is laid from its own snapshot, with no exercises), else rest.
 * Past `layThrough` a day holds nothing: the plan can't reach it.
 */
function layDays(input: {
  from: string;
  gridEnd: string;
  layThrough: string;
  events: CalendarEventRow[];
  rows: Map<string, SessionRow>;
  exercises: Map<string, TrainingExercise[]>;
}): PlanEditDay[] {
  const byDay = eventByDay(input.events);
  const total = daysBetween(input.from, input.gridEnd) + 1;
  const days: PlanEditDay[] = [];
  for (let offset = 0; offset < total; offset++) {
    const date = addDaysToDateString(input.from, offset);
    const event = date <= input.layThrough ? byDay.get(date) : undefined;
    if (!event) {
      days.push({ date, isRest: true });
      continue;
    }
    const row = event.training_session_id ? input.rows.get(event.training_session_id) : undefined;
    days.push({
      date,
      isRest: false,
      name: row?.name ?? event.session_name,
      focus: row ? row.focus : event.session_focus,
      estimatedDurationMinutes: row?.estimated_duration_minutes ?? null,
      notes: row?.notes ?? null,
      calorieSurplusPercentage: event.calorie_surplus_percentage,
      exercises: row ? (input.exercises.get(row.id) ?? []) : [],
    });
  }
  return days;
}

/**
 * The plan as the editor opens it. Null = no live plan by that id for this
 * client; an ended plan throws PlanEndedError.
 */
export async function getPlanForEditing(
  clientId: string,
  planId: string,
): Promise<PlanForEditing | null> {
  const [plan, clientToday] = await Promise.all([
    readPlan(clientId, planId),
    getClientTodayString(clientId),
  ]);
  if (!plan) return null;
  if (plan.effective_until < clientToday) throw new PlanEndedError();

  const { firstEditableDate, limit } = await resolveEditableDays(clientId, plan, clientToday);
  const gridEnd = lastDayOfWeeks(plan.effective_from, plan.effective_until);
  const layThrough = limit ? earlier(limit.endsOn, gridEnd) : gridEnd;
  // Every day the save may write or clear: the days the editor lays, and the
  // plan's own days past its limit, which a save clears.
  const through = later(layThrough, plan.effective_until);

  const events = await readCalendar(clientId, plan.effective_from, through);
  const sessionIds = [
    ...new Set(events.map((e) => e.training_session_id).filter((id): id is string => id != null)),
  ];
  const [rows, exercises] = await Promise.all([
    readSessionRows(clientId, sessionIds),
    readExercises(sessionIds),
  ]);
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  const seen = events.filter((e) => e.date >= firstEditableDate);
  const seenRowIds = new Set(
    seen.map((e) => e.training_session_id).filter((id): id is string => id != null),
  );

  return {
    plan: {
      id: plan.id,
      name: plan.name,
      splitType: plan.split_type,
      effectiveFrom: plan.effective_from,
      effectiveUntil: plan.effective_until,
    },
    clientToday,
    firstEditableDate,
    limit,
    days: layDays({
      from: plan.effective_from,
      gridEnd,
      layThrough,
      events,
      rows: rowsById,
      exercises,
    }),
    version: encodeVersion({
      plan_updated_at: plan.updated_at,
      from: firstEditableDate,
      through,
      limit: limit?.endsOn ?? null,
      events: seen.map((e) => ({
        id: e.id,
        date: e.date,
        training_session_id: e.training_session_id,
        status: e.status,
        calorie_surplus_percentage: e.calorie_surplus_percentage,
      })),
      sessions: rows
        .filter((row) => seenRowIds.has(row.id))
        .map((row) => ({ id: row.id, updated_at: row.updated_at })),
    }),
  };
}

// One day of the save, in migration 175's columns. Exercises splat verbatim —
// the builder keeps each exercise's compact columns the projection of its
// set specs, as placement does — with a catalog id the coach can't see nulled.
function toSaveDay(date: string, input: PlanEditSessionInput, visible: Set<string>) {
  if (input.isRest) return { date, is_rest: true };
  return {
    date,
    is_rest: false,
    name: input.name,
    focus: input.focus ?? null,
    notes: input.notes ?? null,
    estimated_duration_minutes: input.estimatedDurationMinutes ?? null,
    calorie_surplus_percentage: input.calorieSurplusPercentage ?? null,
    exercises: [...input.exercises]
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((ex) => ({
        name: ex.name,
        exercise_id: ex.exerciseId && visible.has(ex.exerciseId) ? ex.exerciseId : null,
        order_index: ex.orderIndex,
        sets: ex.sets,
        reps_min: ex.repsMin ?? null,
        reps_max: ex.repsMax ?? null,
        reps_target: ex.repsTarget ?? null,
        rpe_target: ex.rpeTarget ?? null,
        percentage_1rm: ex.percentage1rm ?? null,
        tempo: ex.tempo ?? null,
        rest_seconds: ex.restSeconds ?? null,
        notes: ex.notes ?? null,
        superset_group: ex.supersetGroup ?? null,
        is_warmup: ex.isWarmup ?? false,
        set_specs: ex.setSpecs ?? null,
        video_url: ex.videoUrl ?? null,
        prescribed_fields: toPrescribedFields(ex.prescribedFields),
      })),
  };
}

function translateSaveError(error: { code?: string; message: string }): Error {
  // A plan placed into the reach of this save (the live-window exclusion) or a
  // session landing on one of its days (the one-scheduled-per-day index)
  // between the read and the write is the calendar changing under the editor.
  if (error.code === "23P01" || error.code === "23505") return new PlanEditStaleError();
  if (error.message.startsWith("stale:")) return new PlanEditStaleError();
  if (error.message.startsWith("not_found:")) return new PlanEditNotFoundError();
  return new Error(`Failed to save the plan: ${error.message}`);
}

/**
 * Save the editor. `sessions` is the whole grid — slot i is the plan's day
 * `effective_from + i` — and only its days from the first editable day to the
 * plan's new last day are written: the grid's end, capped at the plan's limit,
 * never before the day before the first editable day.
 */
export async function savePlanEdit(params: {
  clientId: string;
  coachId: string;
  planId: string;
  sessions: PlanEditSessionInput[];
  name: string;
  splitType: string | null;
  version: string;
}): Promise<PlanEditResult> {
  const { clientId, coachId, planId, sessions } = params;
  const version = decodeVersion(params.version);

  if (sessions.length === 0 || sessions.length % DAYS_PER_WEEK !== 0) {
    throw new PlanEditInvalidError("The plan must be whole weeks");
  }
  sessions.forEach((slot, i) => {
    if (slot.orderIndex !== i || (slot.weekIndex ?? 0) !== Math.floor(i / DAYS_PER_WEEK)) {
      throw new PlanEditInvalidError("The plan's days must be in order");
    }
  });

  const [plan, clientToday] = await Promise.all([
    readPlan(clientId, planId),
    getClientTodayString(clientId),
  ]);
  if (!plan) throw new PlanEditNotFoundError();
  // An editor opened on a plan that has since ended, or whose first editable
  // day or limit has moved (a log today, midnight, a new block or plan),
  // was built from a calendar that is not there any more.
  if (plan.effective_until < clientToday) throw new PlanEditStaleError();
  const { firstEditableDate, limit } = await resolveEditableDays(clientId, plan, clientToday);
  if (firstEditableDate !== version.from || (limit?.endsOn ?? null) !== version.limit) {
    throw new PlanEditStaleError();
  }

  const gridEnd = addDaysToDateString(plan.effective_from, sessions.length - 1);
  const capped = limit ? earlier(limit.endsOn, gridEnd) : gridEnd;
  const lastDay = later(capped, addDaysToDateString(firstEditableDate, -1));
  const firstPosition = daysBetween(plan.effective_from, firstEditableDate);
  const lastPosition = daysBetween(plan.effective_from, lastDay);

  const written = sessions.slice(firstPosition, lastPosition + 1);
  const visible = await fetchVisibleExerciseIds(
    coachId,
    written.flatMap((s) =>
      s.exercises.map((e) => e.exerciseId).filter((id): id is string => Boolean(id)),
    ),
  );
  const window = sessions.slice(0, lastPosition + 1);

  const { error } = await supabaseAdmin.rpc("edit_training_plan_atomic", {
    p_client_id: clientId,
    p_plan_id: planId,
    p_first_day: firstEditableDate,
    p_last_day: lastDay,
    p_name: params.name,
    p_split_type: params.splitType ?? "custom",
    p_program_duration_weeks: Math.ceil(window.length / DAYS_PER_WEEK),
    p_frequency_per_week: deriveFrequencyPerWeek(window),
    p_days: written.map((slot, i) =>
      toSaveDay(addDaysToDateString(firstEditableDate, i), slot, visible),
    ),
    p_version: version,
  });
  if (error) throw translateSaveError(error);

  return {
    firstDay: firstEditableDate,
    lastDay,
    sessionsWritten: written.filter((s) => !s.isRest).length,
  };
}
