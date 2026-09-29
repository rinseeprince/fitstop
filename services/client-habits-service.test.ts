import { describe, it, expect, vi, beforeEach } from "vitest";

// A PostgREST builder: every filter returns the builder, and awaiting it — or
// its maybeSingle() — gives the result set up for the test.
const { query, result } = vi.hoisted(() => {
  const result: { value: { data: unknown; error: unknown } } = { value: { data: [], error: null } };
  const query: Record<string, ReturnType<typeof vi.fn>> & { then?: unknown } = {};
  for (const method of ["select", "eq", "gte", "lte", "order", "range"]) query[method] = vi.fn(() => query);
  query.maybeSingle = vi.fn(() => Promise.resolve(result.value));
  query.then = (resolve: (value: unknown) => unknown) => resolve(result.value);
  return { query, result };
});
vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn(() => query), rpc: vi.fn() } }));

import { supabaseAdmin } from "./supabase-admin";
import { getClientHabit, listClientHabits, listHabitChoices, listHabitEntries } from "./client-habits-service";

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
