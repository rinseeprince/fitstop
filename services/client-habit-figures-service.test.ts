import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./check-in-week-service", () => ({ getClientWeekAnchor: vi.fn() }));
vi.mock("./client-habits-service", () => ({
  listClientHabits: vi.fn(),
  listHabitEntries: vi.fn(),
  getClientHabit: vi.fn(),
}));
vi.mock("./today-service", () => ({ getClientTodayString: vi.fn() }));
vi.mock("./client-habit-writes-service", () => {
  class HabitWriteError extends Error {
    constructor(
      readonly code: string,
      message: string
    ) {
      super(message);
    }
  }
  return { HabitWriteError };
});

import { getClientWeekAnchor } from "./check-in-week-service";
import { getClientHabit, listClientHabits, listHabitEntries } from "./client-habits-service";
import { getClientTodayString } from "./today-service";
import {
  getClientHabitDay,
  getClientHabitProgress,
  getClientHabitWeek,
  getCoachHabitWeek,
  getHabitEntryResult,
  HabitWeekRangeError,
} from "./client-habit-figures-service";
import type { ClientHabit, HabitEntry, HabitVersion } from "@/types/habits";

// A client checking in on Wednesdays: their week runs Thursday to Wednesday.
// 30 Sep 2026 is a Wednesday.
const TODAY = "2026-09-30";

function version(overrides: Partial<HabitVersion> = {}): HabitVersion {
  return { id: "v", startsOn: "2026-09-01", endsOn: null, target: null, timesPerWeek: null, weekdays: ["monday", "wednesday", "friday"], ...overrides };
}
function habit(id: string, overrides: Partial<ClientHabit> = {}): ClientHabit {
  return { id, name: id, howTo: null, measure: "tick", unit: null, direction: null, position: 1, versions: [version()], dayEdits: [], ...overrides };
}
const ticked = (habitId: string, date: string): HabitEntry => ({ habitId, date, done: true, value: null, note: null });

const mobility = habit("mobility");
const water = habit("water", {
  measure: "number",
  unit: "L",
  direction: "at_least",
  versions: [version({ target: 3, weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] })],
  dayEdits: [{ date: "2026-09-30", planned: true, target: 2 }],
});
const stoppedLongAgo = habit("stopped", { versions: [version({ startsOn: "2026-08-01", endsOn: "2026-08-31" })] });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getClientWeekAnchor).mockResolvedValue({ weekday: "wednesday", startDate: "2026-06-01" });
  vi.mocked(getClientTodayString).mockResolvedValue(TODAY);
  vi.mocked(listClientHabits).mockResolvedValue([mobility, water, stoppedLongAgo]);
  vi.mocked(listHabitEntries).mockResolvedValue([ticked("mobility", "2026-09-25"), ticked("mobility", "2026-09-29")]);
});

describe("getCoachHabitWeek", () => {
  it("reads the client week holding today, lists the habits running in it, and tallies today", async () => {
    const week = await getCoachHabitWeek("client-3");
    expect(listClientHabits).toHaveBeenCalledWith("client-3", { from: "2026-09-24", to: "2026-09-30" });
    expect(listHabitEntries).toHaveBeenCalledWith("client-3", { from: "2026-09-24", to: "2026-09-30" });
    expect(week).toMatchObject({ clientToday: TODAY, start: "2026-09-24", end: "2026-09-30" });
    expect(week.habits.map((row) => row.habit.id)).toEqual(["mobility", "water"]);
    expect(week.habits[0]).toMatchObject({ words: { schedule: "Mon, Wed, Fri", target: null }, figures: { planned: 3, done: 2, met: 2 } });
    expect(week.totals).toEqual({ planned: 10, done: 2, met: 2 });
    expect(week.today).toEqual({ planned: 2, done: 0 });
  });

  it("reads the week holding the day asked for, with no today when today is outside it", async () => {
    const week = await getCoachHabitWeek("client-3", "2026-10-05");
    expect(week).toMatchObject({ start: "2026-10-01", end: "2026-10-07", today: null });
  });
});

describe("getClientHabitDay", () => {
  it("lists every habit a version covers on the date, planned or not, with the day's target in words", async () => {
    const tuesday = await getClientHabitDay("client-3", "2026-09-29");
    expect(tuesday.habits.map((item) => [item.habit.id, item.day.planned, item.day.met])).toEqual([
      ["mobility", false, true],
      ["water", true, false],
    ]);
    expect(tuesday.habits[0].words).toEqual({ schedule: "Mon, Wed, Fri", target: null, week: "2 of 3" });
    expect(tuesday.habits[0].week).toEqual({ planned: 3, done: 2, met: 2, start: "2026-09-24", end: "2026-09-30" });

    const wednesday = await getClientHabitDay("client-3", "2026-09-30");
    expect(wednesday.habits[1].words.target).toBe("at least 2 L");
  });
});

describe("getClientHabitWeek", () => {
  it("reads the dates asked for inside one client week — a check-in period clamped to the start day", async () => {
    const week = await getClientHabitWeek("client-3", "2026-09-28", "2026-09-30");
    expect(week.dates).toEqual(["2026-09-28", "2026-09-29", "2026-09-30"]);
    expect(week.habits[0].figures).toEqual({ planned: 2, done: 1, met: 1 });
  });

  it("refuses dates running over two client weeks, or backwards", async () => {
    await expect(getClientHabitWeek("client-3", "2026-09-30", "2026-10-01")).rejects.toBeInstanceOf(HabitWeekRangeError);
    await expect(getClientHabitWeek("client-3", "2026-09-29", "2026-09-28")).rejects.toBeInstanceOf(HabitWeekRangeError);
    expect(listClientHabits).not.toHaveBeenCalled();
  });
});

describe("getHabitEntryResult", () => {
  it("answers with the habit's day and the week holding it, on the anchor it is handed", async () => {
    vi.mocked(getClientHabit).mockResolvedValue(mobility);
    const result = await getHabitEntryResult("client-3", "mobility", "2026-09-29", { weekday: "wednesday" });
    expect(getClientWeekAnchor).not.toHaveBeenCalled();
    expect(getClientHabit).toHaveBeenCalledWith("client-3", "mobility", { from: "2026-09-24", to: "2026-09-30" });
    expect(listHabitEntries).toHaveBeenCalledWith("client-3", { from: "2026-09-24", to: "2026-09-30" }, "mobility");
    expect(result.day).toMatchObject({ date: "2026-09-29", planned: false, met: true });
    expect(result.week).toEqual({ planned: 3, done: 2, met: 2, start: "2026-09-24", end: "2026-09-30" });
  });

  it("says a habit that is gone is not found", async () => {
    vi.mocked(getClientHabit).mockResolvedValue(null);
    await expect(
      getHabitEntryResult("client-3", "mobility", "2026-09-29", { weekday: "wednesday" })
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("getClientHabitProgress", () => {
  it("gives each habit running in the span its weeks oldest first — the last holding today — and its last 28 days", async () => {
    const progress = await getClientHabitProgress("client-3", 2);
    expect(listClientHabits).toHaveBeenCalledWith("client-3", { from: "2026-09-03", to: "2026-09-30" });
    expect(progress.habits.map((row) => row.habit.id)).toEqual(["mobility", "water"]);
    const rowOf = progress.habits[0];
    expect(rowOf.weeks.map((week) => [week.start, week.end, week.met, week.planned])).toEqual([
      ["2026-09-17", "2026-09-23", 0, 3],
      ["2026-09-24", "2026-09-30", 2, 3],
    ]);
    expect(rowOf.days).toHaveLength(28);
    expect([rowOf.days[0].date, rowOf.days[27].date]).toEqual(["2026-09-03", "2026-09-30"]);
  });

  it("reads from the first week's start when that is older than the days, to the end of the week holding today", async () => {
    // Monday 28 Sep, mid-week: eight weeks start on Thursday 6 Aug, the 28 days on 1 Sep, and the week ends Wednesday 30.
    vi.mocked(getClientTodayString).mockResolvedValue("2026-09-28");
    const progress = await getClientHabitProgress("client-3", 8);
    expect(listClientHabits).toHaveBeenCalledWith("client-3", { from: "2026-08-06", to: "2026-09-30" });
    expect(listHabitEntries).toHaveBeenCalledWith("client-3", { from: "2026-08-06", to: "2026-09-30" });
    const row = progress.habits[0];
    expect([row.weeks[0].start, row.weeks[7].end, row.days[0].date, row.days[27].date]).toEqual([
      "2026-08-06",
      "2026-09-30",
      "2026-09-01",
      "2026-09-28",
    ]);
  });
});
