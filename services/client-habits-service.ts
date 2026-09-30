import { supabaseAdmin } from "./supabase-admin";
import { fetchAllByChunkedIds, fetchAllPages } from "@/lib/paged-fetch";
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
 * by `(client_id, date)`. Every read is scoped to the route-verified client,
 * or, for the attention feed, to the coach's roster. What a day or a week
 * holds is the kernel's to decide (`lib/habits/`).
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

/**
 * The one-date edits a read carries: those on the days from..to, either end
 * open when left out — every edit the habit has when both are.
 */
type EditRange = { from?: string; to?: string };

/** A range of days, both ends included. */
type DayRange = { from: string; to: string };

/**
 * The one query both list reads make: every habit the client has, in their
 * order, with the one-date edits over `edits`, selecting `select` —
 * `HABIT_SELECT`, or that with the entry check.
 */
function clientHabitsQuery<Select extends string>(clientId: string, edits: EditRange, select: Select) {
  let query = supabaseAdmin.from("client_habits").select(select).eq("client_id", clientId);
  if (edits.from !== undefined) query = query.gte("client_habit_day_edits.date", edits.from);
  if (edits.to !== undefined) query = query.lte("client_habit_day_edits.date", edits.to);
  return query.order("position").order("created_at").order("id");
}

/**
 * Every habit the client has — running, planned and stopped, and deleted too,
 * since every read of the past keeps a deleted habit for the days it ran — in
 * their order, each with every version and the one-date edits over `edits`. A
 * client's habits are a coaching record, tens of rows over years, so one
 * unpaged read is the whole of it.
 */
export async function listClientHabits(clientId: string, edits: EditRange): Promise<ClientHabit[]> {
  const { data, error } = await clientHabitsQuery(clientId, edits, HABIT_SELECT);
  if (error) throw new Error(`Failed to read habits: ${error.message}`);
  return (data ?? []).map(mapHabit);
}

/**
 * The client's habits as `listClientHabits` reads them, less the ones the
 * coach deleted — the habits the coach manages — each with whether the client
 * has made any entry for it: one of its entries at most, found in the same
 * read on the habit's own `(client_habit_id, date)` key — a yes or no, never a
 * count of every entry the habit has had.
 */
export async function listClientHabitsWithEntryCheck(
  clientId: string,
  edits: EditRange
): Promise<(ClientHabit & { hasEntries: boolean })[]> {
  const { data, error } = await clientHabitsQuery(clientId, edits, `${HABIT_SELECT}, client_habit_logs(id)`)
    .is("deleted_at", null)
    .limit(1, { referencedTable: "client_habit_logs" });
  if (error) throw new Error(`Failed to read habits: ${error.message}`);
  return (data ?? []).map((row) => ({
    ...mapHabit(row),
    hasEntries: (row.client_habit_logs ?? []).length > 0,
  }));
}

/** One of the client's habits, as `listClientHabits` reads it; null when it is not theirs. */
export async function getClientHabit(
  clientId: string,
  habitId: string,
  edits: DayRange
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
  range: DayRange,
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
 * A habit of one of the roster's clients, as the attention feed reads it, and
 * whether the coach deleted it: its past days stay prescribed work, while no
 * missed-habit line names it.
 */
export type RosterHabit = ClientHabit & { clientId: string; deleted: boolean };

/** An entry of one of the roster's clients, without its note: the feed judges entries and never shows one. */
export type RosterHabitEntry = Omit<HabitEntry, "note"> & { clientId: string };

/**
 * Every habit of the given clients that a version covers on a day of
 * from..to, with the versions over those days and the one-date edits inside
 * them — the attention feed's read, across a coach's roster. Chunked by client
 * and paged, so neither the request line nor the row cap can drop a client.
 */
export async function listHabitsForClients(clientIds: string[], range: DayRange): Promise<RosterHabit[]> {
  const rows = await fetchAllByChunkedIds(
    clientIds,
    (chunk, from, to) =>
      supabaseAdmin
        .from("client_habits")
        .select(
          "client_id, id, name, how_to, measure, unit, direction, position, deleted_at, client_habit_versions!inner(id, starts_on, ends_on, target, times_per_week, client_habit_version_days(weekday)), client_habit_day_edits(date, planned, target)"
        )
        .in("client_id", chunk)
        .lte("client_habit_versions.starts_on", range.to)
        .or(`ends_on.is.null,ends_on.gte.${range.from}`, { referencedTable: "client_habit_versions" })
        .gte("client_habit_day_edits.date", range.from)
        .lte("client_habit_day_edits.date", range.to)
        .order("client_id")
        .order("id")
        .range(from, to),
    { errorLabel: "habits" }
  );
  return rows.map((row) => ({ ...mapHabit(row), clientId: row.client_id, deleted: row.deleted_at !== null }));
}

/**
 * The given clients' entries on the days from..to, without their notes —
 * chunked by client and paged in the order the `(client_id, date)` index
 * serves the filter, with the habit last to make it unique, so no page
 * repeats or skips an entry.
 */
export async function listHabitEntriesForClients(clientIds: string[], range: DayRange): Promise<RosterHabitEntry[]> {
  const rows = await fetchAllByChunkedIds(
    clientIds,
    (chunk, from, to) =>
      supabaseAdmin
        .from("client_habit_logs")
        .select("client_id, client_habit_id, date, done, value")
        .in("client_id", chunk)
        .gte("date", range.from)
        .lte("date", range.to)
        .order("client_id")
        .order("date")
        .order("client_habit_id")
        .range(from, to),
    { errorLabel: "habit entries" }
  );
  return rows.map((row) => ({
    clientId: row.client_id,
    habitId: row.client_habit_id,
    date: row.date,
    done: row.done,
    value: amount(row.value),
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
