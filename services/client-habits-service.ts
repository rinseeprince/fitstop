import { supabaseAdmin } from "./supabase-admin";
import { fetchAllPages } from "@/lib/paged-fetch";
import { isHabitDirection, isHabitMeasure } from "@/lib/habits/habit-entry";
import { habitWords } from "@/lib/habits/habit-words";
import { DAYS_OF_WEEK } from "@/utils/nutrition-helpers";
import type { Database } from "@/types/database";
import type { DayOfWeek } from "@/types/check-in";
import type { ClientHabit, HabitChoice, HabitDirection, HabitEntry } from "@/types/habits";

/**
 * A client's habits, read (migration 203; docs/HABITS-REBUILD-PLAN.md §2.3).
 * The app reads the four prescription tables and never writes them — every
 * write is one of the habit functions, driven by
 * `services/client-habit-writes-service.ts` — and reads the client's entries
 * by `(client_id, date)`. Every read is scoped to the route-verified client.
 * What a day or a week holds is the kernel's to decide (`lib/habits/`).
 */

type Tables = Database["public"]["Tables"];
type HabitRow = Pick<
  Tables["client_habits"]["Row"],
  "id" | "name" | "how_to" | "measure" | "unit" | "direction" | "position"
> & {
  client_habit_versions:
    | (Pick<Tables["client_habit_versions"]["Row"], "id" | "starts_on" | "ends_on" | "target" | "times_per_week"> & {
        client_habit_version_days: Pick<Tables["client_habit_version_days"]["Row"], "weekday">[] | null;
      })[]
    | null;
  client_habit_day_edits: Pick<Tables["client_habit_day_edits"]["Row"], "date" | "planned" | "target">[] | null;
};

const HABIT_SELECT =
  "id, name, how_to, measure, unit, direction, position, client_habit_versions(id, starts_on, ends_on, target, times_per_week, client_habit_version_days(weekday)), client_habit_day_edits(date, planned, target)";

const isWeekday = (value: string): value is DayOfWeek => (DAYS_OF_WEEK as readonly string[]).includes(value);
const weekdayOrder = (day: DayOfWeek) => DAYS_OF_WEEK.indexOf(day);
const amount = (value: number | null) => (value === null ? null : Number(value));

/** A stored direction: null on a tick habit, else one of the two. */
function readDirection(habitId: string, value: string | null): HabitDirection | null {
  if (value === null) return null;
  if (!isHabitDirection(value)) throw new Error(`Habit ${habitId} has an unknown direction: ${value}`);
  return value;
}

function mapHabit(row: HabitRow): ClientHabit {
  if (!isHabitMeasure(row.measure)) {
    throw new Error(`Habit ${row.id} has an unknown measure: ${row.measure}`);
  }
  return {
    id: row.id,
    name: row.name,
    howTo: row.how_to,
    measure: row.measure,
    unit: row.unit,
    direction: readDirection(row.id, row.direction),
    position: row.position,
    versions: (row.client_habit_versions ?? [])
      .map((version) => ({
        id: version.id,
        startsOn: version.starts_on,
        endsOn: version.ends_on,
        target: amount(version.target),
        timesPerWeek: version.times_per_week,
        weekdays: (version.client_habit_version_days ?? [])
          .map((day) => day.weekday)
          .filter(isWeekday)
          .sort((a, b) => weekdayOrder(a) - weekdayOrder(b)),
      }))
      .sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1)),
    dayEdits: (row.client_habit_day_edits ?? [])
      .map((edit) => ({ date: edit.date, planned: edit.planned, target: amount(edit.target) }))
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
  };
}

/** The one-date edits a read carries: those on the days from..to. */
type EditRange = { from: string; to: string };

/**
 * Every habit the client has — running, planned and stopped — in their order,
 * each with every version and the one-date edits over `edits`. A client's
 * habits are a coaching record, tens of rows over years, so one unpaged read
 * is the whole of it.
 */
export async function listClientHabits(clientId: string, edits: EditRange): Promise<ClientHabit[]> {
  const { data, error } = await supabaseAdmin
    .from("client_habits")
    .select(HABIT_SELECT)
    .eq("client_id", clientId)
    .gte("client_habit_day_edits.date", edits.from)
    .lte("client_habit_day_edits.date", edits.to)
    .order("position")
    .order("created_at")
    .order("id");

  if (error) throw new Error(`Failed to read habits: ${error.message}`);
  return (data ?? []).map(mapHabit);
}

/** One of the client's habits, as `listClientHabits` reads it; null when it is not theirs. */
export async function getClientHabit(
  clientId: string,
  habitId: string,
  edits: EditRange
): Promise<ClientHabit | null> {
  const { data, error } = await supabaseAdmin
    .from("client_habits")
    .select(HABIT_SELECT)
    .eq("id", habitId)
    .eq("client_id", clientId)
    .gte("client_habit_day_edits.date", edits.from)
    .lte("client_habit_day_edits.date", edits.to)
    .maybeSingle();

  if (error) throw new Error(`Failed to read the habit: ${error.message}`);
  return data ? mapHabit(data) : null;
}

/**
 * The client's entries on the days from..to — every habit's, or one habit's —
 * complete however many there are (paged; ordered on the unique pair).
 */
export async function listHabitEntries(
  clientId: string,
  range: EditRange,
  habitId?: string
): Promise<HabitEntry[]> {
  const rows = await fetchAllPages(
    (from, to) => {
      let query = supabaseAdmin
        .from("client_habit_logs")
        .select("client_habit_id, date, done, value, note")
        .eq("client_id", clientId)
        .gte("date", range.from)
        .lte("date", range.to);
      if (habitId) query = query.eq("client_habit_id", habitId);
      return query.order("date").order("client_habit_id").range(from, to);
    },
    { errorLabel: "habit entries" }
  );
  return rows.map((row) => ({
    habitId: row.client_habit_id,
    date: row.date,
    done: row.done,
    value: amount(row.value),
    note: row.note,
  }));
}

/**
 * The habits the coach has given any of their clients, one per name and way
 * of measuring with its newest version's how-to, target and days, less those
 * this client has running or planned from `today` — the client's
 * (`coach_habit_choices`).
 */
export async function listHabitChoices(coachId: string, clientId: string, today: string): Promise<HabitChoice[]> {
  const { data, error } = await supabaseAdmin.rpc("coach_habit_choices", {
    p_coach_id: coachId,
    p_client_id: clientId,
    p_today: today,
  });
  if (error) throw new Error(`Failed to read the habit choices: ${error.message}`);

  return (data ?? []).map((row) => {
    if (!isHabitMeasure(row.measure)) throw new Error(`A habit choice has an unknown measure: ${row.measure}`);
    const choice = {
      name: row.name,
      howTo: row.how_to,
      measure: row.measure,
      unit: row.unit,
      direction: readDirection(row.name, row.direction),
      target: amount(row.target),
      timesPerWeek: row.times_per_week,
      weekdays: (row.weekdays ?? []).filter(isWeekday),
    };
    return { ...choice, words: habitWords(choice, choice) };
  });
}
