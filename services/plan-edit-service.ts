import { z } from "zod";
import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString } from "./today-service";
import { resolveEventDeletionFloor } from "./event-deletion-floor";
import { resolveWindowCap, type WindowCap } from "./program-event-walk";
import { deriveFrequencyPerWeek } from "./coach-library-helpers";
import { fetchVisibleExerciseIds } from "./library-placement-service";
import { sessionsByDay } from "./calendar-day-events";
import {
  EXERCISE_WITH_GROUP_COLUMNS,
  mapExerciseRowsToGroupsBySession,
  type TrainingExerciseWithGroupRow,
} from "./training-mappers";
import { isSessionUnchanged } from "./plan-edit-same-day";
import { fetchAllPages, fetchAllByChunkedIds } from "@/lib/paged-fetch";
import { addDaysToDateString } from "@/lib/date-helpers";
import { daysBetween } from "@/utils/metric-points";
import { toPrescribedFields } from "@/utils/prescribed-fields";
import { groupSettingsToRow, sessionExercises } from "@/utils/exercise-groups";
import { MAX_PLAN_EDIT_SESSIONS } from "@/lib/training-constants";
import type { PlanEditSessionInput } from "@/lib/validations/training";
import type { TrainingExerciseGroup } from "@/types/training";

// =============================================================================
// Edit plan: the plan editor opens a client's program as it is laid on the
// calendar, and whatever the coach leaves in it becomes the plan from the
// first day that can still change.
//
// The read lays the calendar out day by day from the plan's start (every
// session on the day as the calendar holds it, in the day's order, whatever the
// coach or the client moved or deleted; none is rest) and hands back a version:
// everything the editor was built from. The save sends the version back, and
// edit_training_plan_atomic (migration 179) refuses it in the same transaction
// as the write when any of it changed. Each session the editor opened carries
// the calendar entry it came from, so the save keeps that entry for it while it
// stays on its day, and the save lays the days it writes the same way as the
// read, so a session saved as it was laid keeps its edited mark and a session
// the coach changed loses it.
// =============================================================================

/** One session on a day of the plan as the editor opens it. */
export type PlanEditSession = {
  /** The calendar entry holding it: the save keeps that entry for the session while it stays on this day. */
  eventId: string;
  name: string;
  focus: string | null;
  estimatedDurationMinutes: number | null;
  notes: string | null;
  /** The entry carries the per-date value. */
  calorieSurplusPercentage: number | null;
  groups: TrainingExerciseGroup[];
};

/** One day of the plan as the editor opens it: its sessions in the day's order; none is a rest day. */
export type PlanEditDay = { date: string; sessions: PlanEditSession[] };

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

/** One day of the editor's save: its sessions in order; none is a rest day. */
type PlanEditDayInput = { sessions: PlanEditSessionInput[] };

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
  day_order: number;
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

// The version's own shape, in the columns migration 179 compares.
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
        day_order: z.number().int().min(0),
        training_session_id: z.string().uuid().nullable(),
        status: z.string().min(1).max(20),
        calorie_surplus_percentage: z.number().nullable(),
      }),
    )
    .max(MAX_PLAN_EDIT_SESSIONS),
  sessions: z
    .array(z.object({ id: z.string().uuid(), updated_at: z.string().min(1).max(64) }))
    .max(MAX_PLAN_EDIT_SESSIONS),
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
          "id, date, day_order, status, training_session_id, session_name, session_focus, calorie_surplus_percentage",
        )
        .eq("client_id", clientId)
        .gte("date", from)
        .lte("date", through)
        .order("date", { ascending: true })
        .order("day_order", { ascending: true })
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

/** The calendar from `from` to `through`, the rows its days point at and their groups. */
async function readLaidCalendar(clientId: string, from: string, through: string) {
  const events = await readCalendar(clientId, from, through);
  const sessionIds = [
    ...new Set(events.map((e) => e.training_session_id).filter((id): id is string => id != null)),
  ];
  const [rows, groups] = await Promise.all([
    readSessionRows(clientId, sessionIds),
    readGroups(sessionIds),
  ]);
  return { events, rows, groups };
}

// Each session's groups, read through its live exercises. Paged on
// (session_id, id) for a stable page walk; the nesting puts groups and
// exercises in their order.
async function readGroups(sessionIds: string[]): Promise<Map<string, TrainingExerciseGroup[]>> {
  const rows = await fetchAllByChunkedIds<TrainingExerciseWithGroupRow, string>(
    sessionIds,
    (chunk, from, to) =>
      supabaseAdmin
        .from("training_exercises")
        .select(EXERCISE_WITH_GROUP_COLUMNS)
        .in("session_id", chunk)
        .eq("is_active", true)
        .order("session_id", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    { errorLabel: "the plan's exercises" },
  );
  return mapExerciseRowsToGroupsBySession(rows);
}

/**
 * One day per date from `from` to `gridEnd`. Up to `layThrough` a day holds
 * every session on its date, in the day's order, each read through the row its
 * entry points at (an entry whose row cannot be read is laid from its own
 * snapshot, with no groups); a day holding none is rest. Past `layThrough` a
 * day holds nothing: the plan can't reach it.
 */
function layDays(input: {
  from: string;
  gridEnd: string;
  layThrough: string;
  events: CalendarEventRow[];
  rows: Map<string, SessionRow>;
  groups: Map<string, TrainingExerciseGroup[]>;
}): PlanEditDay[] {
  const byDay = sessionsByDay(input.events);
  const total = daysBetween(input.from, input.gridEnd) + 1;
  const days: PlanEditDay[] = [];
  for (let offset = 0; offset < total; offset++) {
    const date = addDaysToDateString(input.from, offset);
    const events = date <= input.layThrough ? (byDay.get(date) ?? []) : [];
    days.push({
      date,
      sessions: events.map((event) => {
        const row = event.training_session_id
          ? input.rows.get(event.training_session_id)
          : undefined;
        return {
          eventId: event.id,
          name: row?.name ?? event.session_name,
          focus: row ? row.focus : event.session_focus,
          estimatedDurationMinutes: row?.estimated_duration_minutes ?? null,
          notes: row?.notes ?? null,
          calorieSurplusPercentage: event.calorie_surplus_percentage,
          groups: row ? (input.groups.get(row.id) ?? []) : [],
        };
      }),
    });
  }
  return days;
}

/** The days from `from` to `through` as the editor lays them; none when the range is empty. */
async function readLaidDays(
  clientId: string,
  from: string,
  through: string,
): Promise<PlanEditDay[]> {
  if (through < from) return [];
  const { events, rows, groups } = await readLaidCalendar(clientId, from, through);
  return layDays({
    from,
    gridEnd: through,
    layThrough: through,
    events,
    rows: new Map(rows.map((row) => [row.id, row])),
    groups,
  });
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

  const { events, rows, groups } = await readLaidCalendar(
    clientId,
    plan.effective_from,
    through,
  );
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
      groups,
    }),
    version: encodeVersion({
      plan_updated_at: plan.updated_at,
      from: firstEditableDate,
      through,
      limit: limit?.endsOn ?? null,
      events: seen.map((e) => ({
        id: e.id,
        date: e.date,
        day_order: e.day_order,
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

// One day of the save, in migration 179's columns: the day's sessions in order,
// each with its groups in order and their exercises in order. Exercises splat
// verbatim — the builder keeps each exercise's compact columns the projection
// of its set specs, as placement does — with a catalog id the coach can't see
// nulled. `event_id` is the entry the editor opened the session from; the
// function keeps it for the session only while it is still on this day.
// `unchanged` says the session as written is that entry's session as laid, so
// the entry keeps its edited mark.
function toSaveDay(
  date: string,
  input: PlanEditDayInput,
  visible: Set<string>,
  laid: PlanEditDay | undefined,
) {
  return {
    date,
    sessions: input.sessions.map((session) => {
      const groups = session.groups.map((group) => ({
        ...group,
        exercises: group.exercises.map((ex) => ({
          ...ex,
          exerciseId: ex.exerciseId && visible.has(ex.exerciseId) ? ex.exerciseId : null,
        })),
      }));
      const laidSession = session.eventId
        ? laid?.sessions.find((candidate) => candidate.eventId === session.eventId)
        : undefined;
      return {
        event_id: session.eventId ?? null,
        name: session.name,
        focus: session.focus ?? null,
        notes: session.notes ?? null,
        estimated_duration_minutes: session.estimatedDurationMinutes ?? null,
        calorie_surplus_percentage: session.calorieSurplusPercentage ?? null,
        unchanged: isSessionUnchanged(laidSession, { ...session, groups }),
        groups: groups.map((group) => ({
          ...groupSettingsToRow(group),
          exercises: group.exercises.map((ex) => ({
            name: ex.name,
            exercise_id: ex.exerciseId,
            sets: ex.sets,
            reps_min: ex.repsMin ?? null,
            reps_max: ex.repsMax ?? null,
            reps_target: ex.repsTarget ?? null,
            rpe_target: ex.rpeTarget ?? null,
            percentage_1rm: ex.percentage1rm ?? null,
            tempo: ex.tempo ?? null,
            rest_seconds: ex.restSeconds ?? null,
            notes: ex.notes ?? null,
            is_warmup: ex.isWarmup ?? false,
            set_specs: ex.setSpecs ?? null,
            video_url: ex.videoUrl ?? null,
            prescribed_fields: toPrescribedFields(ex.prescribedFields),
          })),
        })),
      };
    }),
  };
}

function translateSaveError(error: { code?: string; message: string }): Error {
  // A plan placed into the reach of this save between the read and the write
  // (the live-window exclusion) is the calendar changing under the editor.
  if (error.code === "23P01") return new PlanEditStaleError();
  if (error.message.startsWith("stale:")) return new PlanEditStaleError();
  if (error.message.startsWith("not_found:")) return new PlanEditNotFoundError();
  return new Error(`Failed to save the plan: ${error.message}`);
}

/**
 * Save the editor. `days` is the whole grid — day i is the plan's day
 * `effective_from + i`, holding its sessions in order — and only its days from
 * the first editable day to the plan's new last day are written: the grid's
 * end, capped at the plan's limit, never before the day before the first
 * editable day.
 */
export async function savePlanEdit(params: {
  clientId: string;
  coachId: string;
  planId: string;
  days: PlanEditDayInput[];
  name: string;
  splitType: string | null;
  version: string;
}): Promise<PlanEditResult> {
  const { clientId, coachId, planId, days } = params;
  const version = decodeVersion(params.version);

  if (days.length === 0 || days.length % DAYS_PER_WEEK !== 0) {
    throw new PlanEditInvalidError("The plan must be whole weeks");
  }

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

  const gridEnd = addDaysToDateString(plan.effective_from, days.length - 1);
  const capped = limit ? earlier(limit.endsOn, gridEnd) : gridEnd;
  const lastDay = later(capped, addDaysToDateString(firstEditableDate, -1));
  const firstPosition = daysBetween(plan.effective_from, firstEditableDate);
  const lastPosition = daysBetween(plan.effective_from, lastDay);

  const written = days.slice(firstPosition, lastPosition + 1);
  // The days as laid are read now, outside the transaction; the function's
  // stale check refuses the save unless they are still the calendar the
  // editor opened, so "unchanged" is judged against what the editor showed.
  const [visible, laid] = await Promise.all([
    fetchVisibleExerciseIds(
      coachId,
      written.flatMap((day) =>
        day.sessions.flatMap((session) =>
          sessionExercises(session)
            .map((e) => e.exerciseId)
            .filter((id): id is string => Boolean(id)),
        ),
      ),
    ),
    readLaidDays(clientId, firstEditableDate, lastDay),
  ]);
  const window = days.slice(0, lastPosition + 1);

  const { error } = await supabaseAdmin.rpc("edit_training_plan_atomic", {
    p_client_id: clientId,
    p_plan_id: planId,
    p_first_day: firstEditableDate,
    p_last_day: lastDay,
    p_name: params.name,
    p_split_type: params.splitType ?? "custom",
    p_program_duration_weeks: Math.ceil(window.length / DAYS_PER_WEEK),
    p_frequency_per_week: deriveFrequencyPerWeek(
      window.flatMap((day, i): Array<{ weekIndex: number; isRest: boolean }> => {
        const weekIndex = Math.floor(i / DAYS_PER_WEEK);
        return day.sessions.length === 0
          ? [{ weekIndex, isRest: true }]
          : day.sessions.map(() => ({ weekIndex, isRest: false }));
      }),
    ),
    p_days: written.map((day, i) =>
      toSaveDay(addDaysToDateString(firstEditableDate, i), day, visible, laid[i]),
    ),
    p_version: version,
  });
  if (error) throw translateSaveError(error);

  return {
    firstDay: firstEditableDate,
    lastDay,
    sessionsWritten: written.reduce((sum, day) => sum + day.sessions.length, 0),
  };
}
