import { describe, it, expect, vi, beforeEach } from "vitest";

const { upsert, deleteQuery } = vi.hoisted(() => {
  const deleteQuery = { eq: vi.fn() };
  deleteQuery.eq.mockReturnValue(deleteQuery);
  return { upsert: vi.fn(), deleteQuery };
});
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    rpc: vi.fn(),
    from: vi.fn(() => ({ upsert, delete: vi.fn(() => deleteQuery) })),
  },
}));
vi.mock("./client-habits-service", () => ({ getClientHabit: vi.fn() }));
vi.mock("./daily-log-permissions-service", () => ({ getDayEditState: vi.fn() }));

import { supabaseAdmin } from "./supabase-admin";
import { getClientHabit } from "./client-habits-service";
import { getDayEditState } from "./daily-log-permissions-service";
import { DayLockedError } from "@/lib/daily-log-permissions";
import {
  addHabits,
  changeHabit,
  clearHabitEntry,
  deleteHabit,
  HabitWriteError,
  orderHabits,
  renameHabit,
  resetHabitDay,
  saveHabitEntry,
  setHabitDay,
  stopHabit,
  toHabitWriteError,
} from "./client-habit-writes-service";
import type { ClientHabit } from "@/types/habits";

const rpc = vi.mocked(supabaseAdmin.rpc);
const TODAY = "2026-09-30";

function rpcReturns(data: unknown, error: { message: string } | null = null) {
  rpc.mockResolvedValue({ data, error } as never);
}

const water: ClientHabit = {
  id: "habit-water",
  name: "Water",
  howTo: null,
  measure: "number",
  unit: "L",
  direction: "at_least",
  position: 1,
  versions: [
    { id: "v1", startsOn: "2026-09-01", endsOn: "2026-10-04", target: 3, timesPerWeek: null, weekdays: ["monday"] },
  ],
  dayEdits: [],
};

describe("toHabitWriteError", () => {
  it("reads a function's code and message", () => {
    const error = toHabitWriteError({ message: "stops_in_past: a habit stops today or later" });
    expect(error).toBeInstanceOf(HabitWriteError);
    expect(error).toMatchObject({ code: "stops_in_past", message: "a habit stops today or later" });
  });

  it("leaves anything that is not a refusal a plain error", () => {
    const error = toHabitWriteError({ message: "permission denied for table client_habits" });
    expect(error).not.toBeInstanceOf(HabitWriteError);
    expect(error.message).toMatch(/permission denied/);
  });
});

describe("the prescription writes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds habits as the function's JSON — weekdays or times a week, never both — in order", async () => {
    rpcReturns(["habit-a", "habit-b"]);
    const ids = await addHabits({
      clientId: "client-3",
      today: TODAY,
      startsOn: "2026-10-05",
      createdBy: "coach-5",
      habits: [
        { name: "Water", howTo: "A glass with each meal", measure: "number", unit: "L", direction: "at_least", target: 3, schedule: { weekdays: ["monday", "friday"] } },
        { name: "Sauna", howTo: null, measure: "tick", unit: null, direction: null, target: null, schedule: { timesPerWeek: 3 } },
      ],
    });
    expect(ids).toEqual(["habit-a", "habit-b"]);
    expect(rpc).toHaveBeenCalledWith("add_client_habits", {
      p_client_id: "client-3",
      p_today: TODAY,
      p_starts_on: "2026-10-05",
      p_created_by: "coach-5",
      p_habits: [
        { name: "Water", how_to: "A glass with each meal", measure: "number", unit: "L", direction: "at_least", target: 3, weekdays: ["monday", "friday"] },
        { name: "Sauna", how_to: null, measure: "tick", unit: null, direction: null, target: null, times_per_week: 3 },
      ],
    });
  });

  it("omits a change's empty target and sends one kind of days, so SQL defaults the rest", async () => {
    rpcReturns(true);
    await changeHabit({
      habitId: "habit-1", clientId: "client-3", today: TODAY, startsOn: "2026-10-05", createdBy: "coach-5",
      target: null, schedule: { timesPerWeek: 2 },
    });
    expect(rpc).toHaveBeenLastCalledWith("change_client_habit", {
      p_habit_id: "habit-1", p_client_id: "client-3", p_today: TODAY, p_starts_on: "2026-10-05",
      p_created_by: "coach-5", p_times_per_week: 2,
    });

    await changeHabit({
      habitId: "habit-1", clientId: "client-3", today: TODAY, startsOn: TODAY, createdBy: "coach-5",
      target: 0, schedule: { weekdays: ["tuesday"] },
    });
    expect(rpc).toHaveBeenLastCalledWith("change_client_habit", {
      p_habit_id: "habit-1", p_client_id: "client-3", p_today: TODAY, p_starts_on: TODAY,
      p_created_by: "coach-5", p_target: 0, p_weekdays: ["tuesday"],
    });
  });

  it("omits an empty how-to and an empty day target", async () => {
    rpcReturns(true);
    await renameHabit({ habitId: "habit-1", clientId: "client-3", name: "Evening walk", howTo: null });
    expect(rpc).toHaveBeenLastCalledWith("rename_client_habit", {
      p_habit_id: "habit-1", p_client_id: "client-3", p_name: "Evening walk",
    });
    await setHabitDay({ habitId: "habit-1", clientId: "client-3", today: TODAY, date: "2026-10-02", planned: false, target: null, coachId: "coach-5" });
    expect(rpc).toHaveBeenLastCalledWith("set_client_habit_day", {
      p_habit_id: "habit-1", p_client_id: "client-3", p_today: TODAY, p_date: "2026-10-02", p_planned: false, p_coach_id: "coach-5",
    });
  });

  it("passes stop, delete, order and reset straight through and returns whether anything changed", async () => {
    rpcReturns(false);
    expect(await stopHabit({ habitId: "habit-1", clientId: "client-3", today: TODAY, stopsOn: "2026-10-05" })).toBe(false);
    expect(rpc).toHaveBeenLastCalledWith("stop_client_habit", { p_habit_id: "habit-1", p_client_id: "client-3", p_today: TODAY, p_stops_on: "2026-10-05" });
    expect(await orderHabits({ clientId: "client-3", habitIds: ["habit-2", "habit-1"] })).toBe(false);
    expect(rpc).toHaveBeenLastCalledWith("order_client_habits", { p_client_id: "client-3", p_habit_ids: ["habit-2", "habit-1"] });
    expect(await resetHabitDay({ habitId: "habit-1", clientId: "client-3", today: TODAY, date: "2026-10-02" })).toBe(false);
    expect(rpc).toHaveBeenLastCalledWith("reset_client_habit_day", { p_habit_id: "habit-1", p_client_id: "client-3", p_today: TODAY, p_date: "2026-10-02" });
    rpcReturns(null);
    await deleteHabit({ habitId: "habit-1", clientId: "client-3", today: TODAY });
    expect(rpc).toHaveBeenLastCalledWith("delete_client_habit", { p_habit_id: "habit-1", p_client_id: "client-3", p_today: TODAY });
  });

  it("throws a function's refusal as a HabitWriteError", async () => {
    rpcReturns(null, { message: "not_found: habit habit-1 is not this client's" });
    await expect(deleteHabit({ habitId: "habit-1", clientId: "client-3", today: TODAY })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("the entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientHabit).mockResolvedValue(water);
    vi.mocked(getDayEditState).mockResolvedValue({ editable: true, logsOpenFrom: "2026-09-24", clientTimezone: "Europe/London" });
    upsert.mockResolvedValue({ error: null });
    deleteQuery.eq.mockReturnValue(deleteQuery);
  });

  const save = (overrides: Partial<Parameters<typeof saveHabitEntry>[0]> = {}) =>
    saveHabitEntry({ clientId: "client-3", habitId: "habit-water", date: "2026-09-29", answer: { value: 2.5 }, ...overrides });

  it("writes one row per habit per day, a number habit's value with no tick, keeping a note it was not given", async () => {
    await save();
    expect(getClientHabit).toHaveBeenCalledWith("client-3", "habit-water", { from: "2026-09-29", to: "2026-09-29" });
    expect(upsert).toHaveBeenCalledWith(
      { client_habit_id: "habit-water", client_id: "client-3", date: "2026-09-29", done: null, value: 2.5 },
      { onConflict: "client_habit_id,date" }
    );
  });

  it("writes the note it is given, and clears it on null", async () => {
    await save({ note: "Travelling" });
    expect(upsert.mock.calls[0][0]).toMatchObject({ note: "Travelling" });
    await save({ note: null });
    expect(upsert.mock.calls[1][0]).toMatchObject({ note: null });
  });

  it("refuses another client's habit before anything else", async () => {
    vi.mocked(getClientHabit).mockResolvedValue(null);
    vi.mocked(getDayEditState).mockResolvedValue({ editable: false, logsOpenFrom: null, clientTimezone: "UTC" });
    await expect(save({ answer: { done: true } })).rejects.toMatchObject({ code: "not_found" });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses a day no version covers, then an answer that does not fit, then a locked day", async () => {
    vi.mocked(getDayEditState).mockResolvedValue({ editable: false, logsOpenFrom: "2026-10-10", clientTimezone: "UTC" });
    await expect(save({ date: "2026-10-05", answer: { done: true } })).rejects.toMatchObject({ code: "not_running" });
    await expect(save({ answer: { done: true } })).rejects.toMatchObject({ code: "expects_number" });
    await expect(save()).rejects.toBeInstanceOf(DayLockedError);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("takes an entry on a covered day that is not planned — a day made up", async () => {
    await save({ date: "2026-09-30" });
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("reads a habit deleted mid-write as not found", async () => {
    upsert.mockResolvedValue({ error: { code: "23503", message: "violates foreign key constraint" } });
    await expect(save()).rejects.toMatchObject({ code: "not_found" });
  });

  it("clears the day's entry, scoped to the client, while the day is open", async () => {
    await clearHabitEntry({ clientId: "client-3", habitId: "habit-water", date: "2026-09-29" });
    expect(deleteQuery.eq.mock.calls).toEqual([
      ["client_habit_id", "habit-water"],
      ["client_id", "client-3"],
      ["date", "2026-09-29"],
    ]);
  });

  it("clears nothing on a locked day or for another client's habit", async () => {
    vi.mocked(getDayEditState).mockResolvedValue({ editable: false, logsOpenFrom: "2026-09-30", clientTimezone: "UTC" });
    await expect(clearHabitEntry({ clientId: "client-3", habitId: "habit-water", date: "2026-09-29" })).rejects.toBeInstanceOf(DayLockedError);
    vi.mocked(getClientHabit).mockResolvedValue(null);
    await expect(clearHabitEntry({ clientId: "client-3", habitId: "habit-water", date: "2026-09-29" })).rejects.toMatchObject({ code: "not_found" });
    expect(deleteQuery.eq).not.toHaveBeenCalled();
  });
});
