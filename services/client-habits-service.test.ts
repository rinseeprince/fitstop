import { describe, it, expect, vi, beforeEach } from "vitest";

// A PostgREST builder: every filter returns the builder, and awaiting it — or
// its maybeSingle() — gives the result set up for the test.
const { query, result } = vi.hoisted(() => {
  const result: { value: { data: unknown; error: unknown } } = { value: { data: [], error: null } };
  const query: Record<string, ReturnType<typeof vi.fn>> & { then?: unknown } = {};
  for (const method of ["select", "eq", "in", "or", "is", "not", "gte", "lte", "order", "range", "limit"]) query[method] = vi.fn(() => query);
  query.maybeSingle = vi.fn(() => Promise.resolve(result.value));
  query.then = (resolve: (value: unknown) => unknown) => resolve(result.value);
  return { query, result };
});
vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn(() => query), rpc: vi.fn() } }));

import { supabaseAdmin } from "./supabase-admin";
import {
  getClientHabit,
  listClientHabits,
  listClientHabitVersions,
  listClientHabitsWithEntryCheck,
  listDeletedHabitIds,
  listHabitChoices,
  listHabitEntries,
  listHabitEntriesForClients,
  listHabitsForClients,
} from "./client-habits-service";

const RANGE = { from: "2026-09-24", to: "2026-09-30" };

const waterRow = {
  id: "habit-water",
  name: "Water",
  how_to: "A glass with each meal",
  measure: "number",
  unit: "L",
  direction: "at_least",
  position: 2,
  client_habit_versions: [
    {
      id: "v2",
      starts_on: "2026-09-28",
      ends_on: null,
      target: 3.5,
      times_per_week: null,
      client_habit_version_days: [{ weekday: "sunday" }, { weekday: "monday" }, { weekday: "thursday" }],
    },
    { id: "v1", starts_on: "2026-09-01", ends_on: "2026-09-27", target: 3, times_per_week: 3, client_habit_version_days: [] },
  ],
  client_habit_day_edits: [
    { date: "2026-09-30", planned: true, target: 2 },
    { date: "2026-09-26", planned: false, target: null },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  result.value = { data: [], error: null };
});

describe("listDeletedHabitIds", () => {
  it("reads the ids of the client's habits the coach deleted, scoped to the client", async () => {
    result.value = { data: [{ id: "habit-walk" }, { id: "habit-read" }], error: null };
    expect(await listDeletedHabitIds("client-1")).toEqual(new Set(["habit-walk", "habit-read"]));
    expect(supabaseAdmin.from).toHaveBeenCalledWith("client_habits");
    expect(query.select).toHaveBeenCalledWith("id");
    expect(query.eq).toHaveBeenCalledWith("client_id", "client-1");
    expect(query.not).toHaveBeenCalledWith("deleted_at", "is", null);
  });

  it("throws when the read fails", async () => {
    result.value = { data: null, error: { message: "boom" } };
    await expect(listDeletedHabitIds("client-1")).rejects.toThrow("Failed to read the deleted habits: boom");
  });
});

describe("listClientHabits", () => {
  it("reads the client's habits in their order, with every version and the one-date edits in the window", async () => {
    result.value = { data: [waterRow], error: null };
    const [water] = await listClientHabits("client-3", RANGE);

    expect(supabaseAdmin.from).toHaveBeenCalledWith("client_habits");
    expect(query.eq).toHaveBeenCalledWith("client_id", "client-3");
    expect(query.gte).toHaveBeenCalledWith("client_habit_day_edits.date", "2026-09-24");
    expect(query.lte).toHaveBeenCalledWith("client_habit_day_edits.date", "2026-09-30");
    expect(query.order.mock.calls.map((call) => call[0])).toEqual(["position", "created_at", "id"]);

    expect(water).toEqual({
      id: "habit-water",
      name: "Water",
      howTo: "A glass with each meal",
      measure: "number",
      unit: "L",
      direction: "at_least",
      position: 2,
      versions: [
        { id: "v1", startsOn: "2026-09-01", endsOn: "2026-09-27", target: 3, timesPerWeek: 3, weekdays: [] },
        { id: "v2", startsOn: "2026-09-28", endsOn: null, target: 3.5, timesPerWeek: null, weekdays: ["monday", "thursday", "sunday"] },
      ],
      dayEdits: [
        { date: "2026-09-26", planned: false, target: null },
        { date: "2026-09-30", planned: true, target: 2 },
      ],
    });
  });

  it("refuses a habit stored with a measure the product does not know", async () => {
    result.value = { data: [{ ...waterRow, measure: "count" }], error: null };
    await expect(listClientHabits("client-3", RANGE)).rejects.toThrow(/unknown measure/);
  });

  it("fails loudly when the read fails", async () => {
    result.value = { data: null, error: { message: "boom" } };
    await expect(listClientHabits("client-3", RANGE)).rejects.toThrow(/Failed to read habits: boom/);
  });

  it("leaves an end of the edits' range open when it is not given: every edit from a day, or every edit", async () => {
    await listClientHabits("client-3", { from: "2026-09-30" });
    expect(query.gte).toHaveBeenCalledWith("client_habit_day_edits.date", "2026-09-30");
    expect(query.lte).not.toHaveBeenCalled();

    vi.clearAllMocks();
    await listClientHabits("client-3", {});
    expect(query.gte).not.toHaveBeenCalled();
    expect(query.lte).not.toHaveBeenCalled();
    expect(query.eq).toHaveBeenCalledWith("client_id", "client-3");
  });
});

describe("listClientHabitsWithEntryCheck", () => {
  it("looks for one entry per habit in the same read — never counts them all — and says whether it has any", async () => {
    result.value = {
      data: [
        { ...waterRow, client_habit_logs: [{ id: "log-1" }] },
        { ...waterRow, id: "habit-new", client_habit_logs: [] },
      ],
      error: null,
    };
    const habits = await listClientHabitsWithEntryCheck("client-3", {});

    const selected = query.select.mock.calls[0][0] as string;
    expect(selected).toContain("client_habit_logs(id)");
    expect(selected).not.toContain("count");
    expect(query.limit).toHaveBeenCalledWith(1, { referencedTable: "client_habit_logs" });
    expect(habits.map((habit) => [habit.id, habit.hasEntries])).toEqual([
      ["habit-water", true],
      ["habit-new", false],
    ]);
    expect(habits[0].versions).toHaveLength(2);
  });

  it("is listClientHabits' own query — the same client, edits and order — with the check added and the deleted habits left out", async () => {
    const filters = () => ({
      eq: [...query.eq.mock.calls],
      gte: [...query.gte.mock.calls],
      lte: [...query.lte.mock.calls],
      order: [...query.order.mock.calls],
    });
    await listClientHabits("client-3", { from: "2026-09-30" });
    const list = { select: query.select.mock.calls[0][0] as string, filters: filters() };
    // Only the list with the check looks at the entries, and only it leaves a
    // deleted habit out: every other read keeps it for the days it ran.
    expect(query.limit).not.toHaveBeenCalled();
    expect(query.is).not.toHaveBeenCalled();

    vi.clearAllMocks();
    await listClientHabitsWithEntryCheck("client-3", { from: "2026-09-30" });

    expect(query.select.mock.calls[0][0]).toBe(`${list.select}, client_habit_logs(id)`);
    expect(filters()).toEqual(list.filters);
    expect(query.is.mock.calls).toEqual([["deleted_at", null]]);
    expect(list.filters.gte).toEqual([["client_habit_day_edits.date", "2026-09-30"]]);
  });
});

describe("listClientHabitVersions — what the goals table reads", () => {
  it("reads every habit the client has had in their order, each with every version and none of its one-date edits", async () => {
    const { client_habit_day_edits: _edits, ...withoutEdits } = waterRow;
    result.value = { data: [withoutEdits], error: null };
    const [water] = await listClientHabitVersions("client-3");

    expect(supabaseAdmin.from).toHaveBeenCalledWith("client_habits");
    const selected = query.select.mock.calls[0][0] as string;
    expect(selected).toContain("client_habit_versions(id, starts_on, ends_on, target, times_per_week, client_habit_version_days(weekday))");
    expect(selected).not.toContain("client_habit_day_edits");
    expect(query.eq.mock.calls).toEqual([["client_id", "client-3"]]);
    expect(query.order.mock.calls.map((call) => call[0])).toEqual(["position", "created_at", "id"]);
    expect(query.gte).not.toHaveBeenCalled();
    expect(query.lte).not.toHaveBeenCalled();
    expect(water).toEqual({
      id: "habit-water",
      name: "Water",
      howTo: "A glass with each meal",
      measure: "number",
      unit: "L",
      direction: "at_least",
      position: 2,
      versions: [
        { id: "v1", startsOn: "2026-09-01", endsOn: "2026-09-27", target: 3, timesPerWeek: 3, weekdays: [] },
        { id: "v2", startsOn: "2026-09-28", endsOn: null, target: 3.5, timesPerWeek: null, weekdays: ["monday", "thursday", "sunday"] },
      ],
    });
  });

  // A deleted habit's past stays: its versions are lines on the goals it ran
  // in. So the client is the read's one filter — no other, by any spelling.
  it("keeps the habits the coach deleted", async () => {
    await listClientHabitVersions("client-3");
    expect(query.eq.mock.calls).toEqual([["client_id", "client-3"]]);
    for (const filter of ["in", "or", "is", "not", "gte", "lte", "range", "limit"]) {
      expect(query[filter]).not.toHaveBeenCalled();
    }
  });

  it("fails loudly when the read fails", async () => {
    result.value = { data: null, error: { message: "boom" } };
    await expect(listClientHabitVersions("client-3")).rejects.toThrow(/Failed to read habits: boom/);
  });
});

describe("the attention feed's cross-client reads", () => {
  const WINDOW = { from: "2026-09-02", to: "2026-09-30" };

  it("reads the roster's habits a version covers on a day of the window, with those days' versions and edits, and names each one's client", async () => {
    result.value = {
      data: [
        { ...waterRow, client_id: "client-3", deleted_at: null },
        { ...waterRow, id: "habit-read", client_id: "client-4", deleted_at: "2026-09-29T08:00:00+00:00" },
      ],
      error: null,
    };
    const habits = await listHabitsForClients(["client-3", "client-4"], WINDOW);

    expect(supabaseAdmin.from).toHaveBeenCalledWith("client_habits");
    expect(query.select.mock.calls[0][0]).toContain("client_habit_versions!inner(");
    // A deleted habit is read like any other, its mark with it: its days stay prescribed work.
    expect(query.select.mock.calls[0][0]).toContain("deleted_at");
    expect(query.is).not.toHaveBeenCalled();
    expect(habits.map((habit) => [habit.id, habit.deleted])).toEqual([
      ["habit-water", false],
      ["habit-read", true],
    ]);
    expect(query.in).toHaveBeenCalledWith("client_id", ["client-3", "client-4"]);
    // A version overlapping the window: it starts by its end, and runs on or ends in it.
    expect(query.lte).toHaveBeenCalledWith("client_habit_versions.starts_on", "2026-09-30");
    expect(query.or).toHaveBeenCalledWith("ends_on.is.null,ends_on.gte.2026-09-02", {
      referencedTable: "client_habit_versions",
    });
    expect(query.gte).toHaveBeenCalledWith("client_habit_day_edits.date", "2026-09-02");
    expect(query.lte).toHaveBeenCalledWith("client_habit_day_edits.date", "2026-09-30");
    // Paged on a unique order, so a page cannot repeat or skip a habit.
    expect(query.order.mock.calls.map((call) => call[0])).toEqual(["client_id", "id"]);
    expect(habits[0]).toMatchObject({ clientId: "client-3", id: "habit-water", measure: "number" });
  });

  it("reads the roster's entries over the window without their notes, each naming its client", async () => {
    result.value = {
      data: [{ client_id: "client-4", client_habit_id: "habit-walk", date: "2026-09-29", done: false, value: null }],
      error: null,
    };
    const entries = await listHabitEntriesForClients(["client-4"], WINDOW);

    expect(supabaseAdmin.from).toHaveBeenCalledWith("client_habit_logs");
    // The feed judges entries and never shows a note, so none is read.
    expect(query.select).toHaveBeenCalledWith("client_id, client_habit_id, date, done, value");
    expect(query.in).toHaveBeenCalledWith("client_id", ["client-4"]);
    expect(query.gte).toHaveBeenCalledWith("date", "2026-09-02");
    expect(query.lte).toHaveBeenCalledWith("date", "2026-09-30");
    expect(entries).toEqual([{ clientId: "client-4", habitId: "habit-walk", date: "2026-09-29", done: false, value: null }]);
  });

  it("pages the roster's entries in the (client_id, date) index's order, the habit last: unique, so no page repeats or skips one", async () => {
    await listHabitEntriesForClients(["client-4"], WINDOW);
    expect(query.order.mock.calls.map((call) => call[0])).toEqual(["client_id", "date", "client_habit_id"]);
  });

  it("reads nothing for an empty roster", async () => {
    expect(await listHabitsForClients([], WINDOW)).toEqual([]);
    expect(await listHabitEntriesForClients([], WINDOW)).toEqual([]);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });
});

describe("getClientHabit", () => {
  it("reads one habit scoped to the client, and nothing for another client's", async () => {
    result.value = { data: null, error: null };
    expect(await getClientHabit("client-3", "habit-water", RANGE)).toBeNull();
    expect(query.eq.mock.calls).toEqual([
      ["id", "habit-water"],
      ["client_id", "client-3"],
    ]);
  });

  it("reads a deleted habit like any other: the client's entry still reaches the days it ran", async () => {
    result.value = { data: { ...waterRow, deleted_at: "2026-09-29T08:00:00+00:00" }, error: null };
    expect((await getClientHabit("client-3", "habit-water", RANGE))?.id).toBe("habit-water");
    expect(query.is).not.toHaveBeenCalled();
  });
});

describe("listHabitEntries", () => {
  it("reads the client's entries over the days by (date, habit), one habit's when asked", async () => {
    result.value = {
      data: [{ client_habit_id: "habit-water", date: "2026-09-29", done: null, value: 2.5, note: "Travelling" }],
      error: null,
    };
    const entries = await listHabitEntries("client-3", RANGE, "habit-water");

    expect(supabaseAdmin.from).toHaveBeenCalledWith("client_habit_logs");
    expect(query.eq.mock.calls).toEqual([
      ["client_id", "client-3"],
      ["client_habit_id", "habit-water"],
    ]);
    expect(query.gte).toHaveBeenCalledWith("date", "2026-09-24");
    expect(query.lte).toHaveBeenCalledWith("date", "2026-09-30");
    expect(query.order.mock.calls.map((call) => call[0])).toEqual(["date", "client_habit_id"]);
    expect(entries).toEqual([{ habitId: "habit-water", date: "2026-09-29", done: null, value: 2.5, note: "Travelling" }]);
  });
});

describe("listHabitChoices", () => {
  it("asks the function for the coach's habits less this client's, and words each", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: [
        { name: "Water", how_to: null, measure: "number", unit: "L", direction: "at_least", target: 3, times_per_week: null, weekdays: ["monday", "friday"] },
        { name: "Sauna", how_to: null, measure: "tick", unit: null, direction: null, target: null, times_per_week: 3, weekdays: [] },
      ],
      error: null,
    } as never);
    const choices = await listHabitChoices("coach-5", "client-3", "2026-09-30");

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("coach_habit_choices", {
      p_coach_id: "coach-5",
      p_client_id: "client-3",
      p_today: "2026-09-30",
    });
    expect(choices.map((choice) => [choice.name, choice.words])).toEqual([
      ["Water", { schedule: "Mon, Fri", target: "at least 3 L" }],
      ["Sauna", { schedule: "3 times a week", target: null }],
    ]);
  });
});
