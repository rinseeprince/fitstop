import { supabaseAdmin } from "./supabase-admin";
import { getClientHabit } from "./client-habits-service";
import { getDayEditState } from "./daily-log-permissions-service";
import { DayLockedError } from "@/lib/daily-log-permissions";
import { versionOn } from "@/lib/habits/habit-day";
import { answerMismatch } from "@/lib/habits/habit-entry";
import type { Database, Json } from "@/types/database";
import type { DayOfWeek } from "@/types/check-in";
import type { HabitAnswer, HabitDirection, HabitMeasure } from "@/types/habits";

/**
 * Every write of a habit (migration 203; docs/HABITS-REBUILD-PLAN.md §2.2
 * rule 8). The app holds SELECT on the four prescription tables and nothing
 * else: each prescription write here is ONE call of a database function, which
 * is one transaction that enforces the date rules against the client's today
 * and writes nothing when nothing changed. A refusal comes back as a
 * `HabitWriteError` carrying the function's code, which the routes turn into a
 * sentence (`lib/habits/habit-write-response.ts`).
 *
 * The entry is the client's own single upsert on (habit, date), like the food
 * and wellness logs, made once this service has proved the habit is the
 * client's, a version covers the day, the answer fits how the habit is
 * measured, and the day is open.
 */

type Functions = Database["public"]["Functions"];

export const HABIT_REFUSAL_CODES = [
  "invalid_args",
  "not_found",
  "starts_in_past",
  "stops_in_past",
  "day_in_past",
  "not_running",
  "weekly_version",
  "target_required",
  "target_not_allowed",
  "has_entries",
  "order_mismatch",
  "expects_tick",
  "expects_number",
] as const;

export type HabitRefusalCode = (typeof HABIT_REFUSAL_CODES)[number];

export class HabitWriteError extends Error {
  constructor(
    readonly code: HabitRefusalCode,
    message: string
  ) {
    super(message);
    this.name = "HabitWriteError";
  }
}

function isRefusalCode(value: string): value is HabitRefusalCode {
  return (HABIT_REFUSAL_CODES as readonly string[]).includes(value);
}

/** A function's "code: message" refusal as a typed error; anything else stays an Error. */
export function toHabitWriteError(error: { message: string }): Error {
  const match = /^([a-z_]+):\s*([\s\S]*)$/.exec(error.message);
  if (!match || !isRefusalCode(match[1])) return new Error(`Habit write failed: ${error.message}`);
  return new HabitWriteError(match[1], match[2]);
}

/** When a habit runs: chosen weekdays (every day is all seven), or N times a week on any days. */
type HabitSchedule = { weekdays: DayOfWeek[] } | { timesPerWeek: number };

/** A habit to add: what it is, its target and when it runs. */
type NewHabit = {
  name: string;
  howTo: string | null;
  measure: HabitMeasure;
  unit: string | null;
  direction: HabitDirection | null;
  target: number | null;
  schedule: HabitSchedule;
};

/** One or more habits from a start day, appended in order. Returns their ids, in order. */
export async function addHabits(input: {
  clientId: string;
  today: string;
  startsOn: string;
  createdBy: string;
  habits: NewHabit[];
}): Promise<string[]> {
  const habits: Json = input.habits.map((habit) => ({
    name: habit.name,
    how_to: habit.howTo,
    measure: habit.measure,
    unit: habit.unit,
    direction: habit.direction,
    target: habit.target,
    ...("weekdays" in habit.schedule
      ? { weekdays: habit.schedule.weekdays }
      : { times_per_week: habit.schedule.timesPerWeek }),
  }));
  const { data, error } = await supabaseAdmin.rpc("add_client_habits", {
    p_client_id: input.clientId,
    p_today: input.today,
    p_starts_on: input.startsOn,
    p_habits: habits,
    p_created_by: input.createdBy,
  });
  if (error) throw toHabitWriteError(error);
  return data;
}

/**
 * A habit's target and days from a day, today or later — which also starts a
 * stopped habit again. The optional parameters are omitted when empty; each
 * defaults to NULL in SQL. Returns whether anything changed.
 */
export async function changeHabit(input: {
  habitId: string;
  clientId: string;
  today: string;
  startsOn: string;
  createdBy: string;
  target: number | null;
  schedule: HabitSchedule;
}): Promise<boolean> {
  const args: Functions["change_client_habit"]["Args"] = {
    p_habit_id: input.habitId,
    p_client_id: input.clientId,
    p_today: input.today,
    p_starts_on: input.startsOn,
    p_created_by: input.createdBy,
  };
  if (input.target != null) args.p_target = input.target;
  if ("weekdays" in input.schedule) args.p_weekdays = input.schedule.weekdays;
  else args.p_times_per_week = input.schedule.timesPerWeek;

  const { data, error } = await supabaseAdmin.rpc("change_client_habit", args);
  if (error) throw toHabitWriteError(error);
  return data;
}

/** A habit stopped from a day, today or later; its past stays. Returns whether anything changed. */
export async function stopHabit(input: {
  habitId: string;
  clientId: string;
  today: string;
  stopsOn: string;
}): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("stop_client_habit", {
    p_habit_id: input.habitId,
    p_client_id: input.clientId,
    p_today: input.today,
    p_stops_on: input.stopsOn,
  });
  if (error) throw toHabitWriteError(error);
  return data;
}

/** A habit the client never made an entry for, deleted; one with entries is refused. */
export async function deleteHabit(input: { habitId: string; clientId: string }): Promise<void> {
  const { error } = await supabaseAdmin.rpc("delete_client_habit", {
    p_habit_id: input.habitId,
    p_client_id: input.clientId,
  });
  if (error) throw toHabitWriteError(error);
}

/** A habit's labels, its name and how-to. Returns whether anything changed. */
export async function renameHabit(input: {
  habitId: string;
  clientId: string;
  name: string;
  howTo: string | null;
}): Promise<boolean> {
  const args: Functions["rename_client_habit"]["Args"] = {
    p_habit_id: input.habitId,
    p_client_id: input.clientId,
    p_name: input.name,
  };
  if (input.howTo != null) args.p_how_to = input.howTo;

  const { data, error } = await supabaseAdmin.rpc("rename_client_habit", args);
  if (error) throw toHabitWriteError(error);
  return data;
}

/** The client's habits in a new order, every one of them named once. Returns whether the order changed. */
export async function orderHabits(input: { clientId: string; habitIds: string[] }): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("order_client_habits", {
    p_client_id: input.clientId,
    p_habit_ids: input.habitIds,
  });
  if (error) throw toHabitWriteError(error);
  return data;
}

/**
 * One date of a set-days habit, today or later: planned or not, and — a
 * number habit, planned — that day's target (null: the version's). Returns
 * whether anything changed.
 */
export async function setHabitDay(input: {
  habitId: string;
  clientId: string;
  today: string;
  date: string;
  planned: boolean;
  target: number | null;
  coachId: string;
}): Promise<boolean> {
  const args: Functions["set_client_habit_day"]["Args"] = {
    p_habit_id: input.habitId,
    p_client_id: input.clientId,
    p_today: input.today,
    p_date: input.date,
    p_planned: input.planned,
    p_coach_id: input.coachId,
  };
  if (input.target != null) args.p_target = input.target;

  const { data, error } = await supabaseAdmin.rpc("set_client_habit_day", args);
  if (error) throw toHabitWriteError(error);
  return data;
}

/** A one-date edit removed, today or later. Returns whether there was one. */
export async function resetHabitDay(input: {
  habitId: string;
  clientId: string;
  today: string;
  date: string;
}): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("reset_client_habit_day", {
    p_habit_id: input.habitId,
    p_client_id: input.clientId,
    p_today: input.today,
    p_date: input.date,
  });
  if (error) throw toHabitWriteError(error);
  return data;
}

/** Postgres's foreign-key violation: the habit went while the entry was being written. */
const FOREIGN_KEY_VIOLATION = "23503";

/**
 * The habit and the day's lock, read together; refused when the habit is not
 * the client's. The one-date edits are not needed to judge coverage.
 */
async function habitAndLock(clientId: string, habitId: string, date: string) {
  const [habit, editState] = await Promise.all([
    getClientHabit(clientId, habitId, { from: date, to: date }),
    getDayEditState(clientId, date),
  ]);
  if (!habit) throw new HabitWriteError("not_found", "the habit is not this client's");
  return { habit, editable: editState.editable };
}

/**
 * The client's entry for a habit on a day, one per habit per day: a tick
 * habit's done or not, a number habit's number, and — when given — the note
 * (null clears it; absent keeps it). Refused, in order, for a habit that is
 * not the client's, a day no version covers, an answer that does not fit the
 * habit, and a locked day (`DayLockedError`).
 */
export async function saveHabitEntry(input: {
  clientId: string;
  habitId: string;
  date: string;
  answer: HabitAnswer;
  note?: string | null;
}): Promise<void> {
  const { habit, editable } = await habitAndLock(input.clientId, input.habitId, input.date);
  if (!versionOn(habit, input.date)) {
    throw new HabitWriteError("not_running", "no version covers the day");
  }
  const mismatch = answerMismatch(habit.measure, input.answer);
  if (mismatch) throw new HabitWriteError(mismatch, "the answer does not fit the habit");
  if (!editable) throw new DayLockedError(input.date, "habit");

  const { error } = await supabaseAdmin.from("client_habit_logs").upsert(
    {
      client_habit_id: habit.id,
      client_id: input.clientId,
      date: input.date,
      done: "done" in input.answer ? input.answer.done : null,
      value: "value" in input.answer ? input.answer.value : null,
      ...(input.note === undefined ? {} : { note: input.note }),
    },
    { onConflict: "client_habit_id,date" }
  );
  if (error?.code === FOREIGN_KEY_VIOLATION) throw new HabitWriteError("not_found", "the habit was deleted");
  if (error) throw new Error(`Failed to save the habit entry: ${error.message}`);
}

/** The client's entry for a habit on a day, cleared. Refused for a habit not theirs and a locked day. */
export async function clearHabitEntry(input: { clientId: string; habitId: string; date: string }): Promise<void> {
  const { editable } = await habitAndLock(input.clientId, input.habitId, input.date);
  if (!editable) throw new DayLockedError(input.date, "habit");

  const { error } = await supabaseAdmin
    .from("client_habit_logs")
    .delete()
    .eq("client_habit_id", input.habitId)
    .eq("client_id", input.clientId)
    .eq("date", input.date);
  if (error) throw new Error(`Failed to clear the habit entry: ${error.message}`);
}
