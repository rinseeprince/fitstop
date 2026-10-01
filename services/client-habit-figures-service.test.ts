import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./check-in-week-service", () => ({ getClientWeekAnchor: vi.fn() }));
vi.mock("./client-habits-service", () => ({
  listClientHabits: vi.fn(),
  listClientHabitsWithEntryCheck: vi.fn(),
  listDeletedHabitIds: vi.fn(),
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
import {
  getClientHabit,
  listClientHabits,
  listClientHabitsWithEntryCheck,
  listDeletedHabitIds,
  listHabitEntries,
} from "./client-habits-service";
import { getClientTodayString } from "./today-service";
import {
  getClientHabitDay,
  getClientHabitProgress,
  getClientHabitWeek,
  getCoachHabitList,
  getCoachHabitWeek,
  getCoachHabitWeekAndCurrent,
  getHabitDaySummary,
  getHabitEntryResult,
  getHabitPeriodWeek,
  hasHabitFromToday,
  HabitWeekRangeError,
  readHabitRange,
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
  vi.mocked(listDeletedHabitIds).mockResolvedValue(new Set());
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

  // A habit write's answer reads the list and the week side by side on the
  // today its route already read: one today for both, and no second read of it.
  it("judges on the client's today the caller already read, without reading it again", async () => {
    const week = await getCoachHabitWeek("client-3", undefined, "2026-10-02");
    expect(getClientTodayString).not.toHaveBeenCalled();
    expect(week).toMatchObject({ clientToday: "2026-10-02", start: "2026-10-01", end: "2026-10-07" });
    // Friday 2 Oct: Mobility (Mon, Wed, Fri) and Water (every day).
    expect(week.today).toEqual({ planned: 2, done: 0 });
  });

  // The server says which habit the coach deleted — the screen never guesses
  // it from a habit missing from another read.
  it("says which of the week's habits the coach has deleted since", async () => {
    vi.mocked(listDeletedHabitIds).mockResolvedValue(new Set(["water"]));
    const week = await getCoachHabitWeek("client-3");
    expect(listDeletedHabitIds).toHaveBeenCalledWith("client-3");
    expect(week.habits.map((row) => [row.habit.id, row.deleted])).toEqual([
      ["mobility", false],
      ["water", true],
    ]);
  });
});

describe("getCoachHabitWeekAndCurrent — a write's answer on another week", () => {
  it("reads the week holding the day and the client's current week, the anchor and today once", async () => {
    const { week, currentWeek } = await getCoachHabitWeekAndCurrent("client-3", "2026-09-17");
    expect(getClientWeekAnchor).toHaveBeenCalledTimes(1);
    expect(getClientTodayString).toHaveBeenCalledTimes(1);
    expect(week).toMatchObject({ start: "2026-09-17", end: "2026-09-23", today: null });
    expect(currentWeek).toMatchObject({ start: "2026-09-24", end: "2026-09-30", today: { planned: 2, done: 0 } });
  });

  it("answers no current week when the day is in it, reading one week alone", async () => {
    const { week, currentWeek } = await getCoachHabitWeekAndCurrent("client-3", "2026-09-26", TODAY);
    expect(getClientTodayString).not.toHaveBeenCalled();
    expect(week).toMatchObject({ start: "2026-09-24", end: "2026-09-30" });
    expect(currentWeek).toBeNull();
    expect(listClientHabits).toHaveBeenCalledTimes(1);
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

  it("adds the weeks' figures together for the span, each week judged on its own first", async () => {
    // Thu 17 to Wed 23: four days done, one more than the three planned, so
    // that week is met 3 of 3. Thu 24 to Wed 30: two of three.
    vi.mocked(listHabitEntries).mockResolvedValue(
      ["2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20", "2026-09-25", "2026-09-29"].map((date) =>
        ticked("mobility", date)
      )
    );
    const [mobilityRow] = (await getClientHabitProgress("client-3", 2)).habits;
    expect(mobilityRow.weeks.map((week) => [week.planned, week.done, week.met])).toEqual([
      [3, 4, 3],
      [3, 2, 2],
    ]);
    // Five of six: the first week's extra day never counts toward the second.
    expect(mobilityRow.span).toEqual({ planned: 6, done: 6, met: 5 });
  });
});

describe("readHabitRange — the kernel's input over a run of days", () => {
  it("reads the client's habits, with the edits on those days, and their entries on them, side by side", async () => {
    const range = await readHabitRange("client-3", "2026-09-24", "2026-09-30");
    expect(listClientHabits).toHaveBeenCalledWith("client-3", { from: "2026-09-24", to: "2026-09-30" });
    expect(listHabitEntries).toHaveBeenCalledWith("client-3", { from: "2026-09-24", to: "2026-09-30" });
    expect(range.habits.map((h) => h.id)).toEqual(["mobility", "water", "stopped"]);
    expect(range.entries).toHaveLength(2);
  });
});

describe("getHabitPeriodWeek — the habit week a check-in freezes", () => {
  const ENTRIES = [ticked("mobility", "2026-09-25"), ticked("mobility", "2026-09-29")];

  it("gives each habit a version covered during the period: its days as they happened, its figures, and the totals", () => {
    const week = getHabitPeriodWeek({ habits: [mobility, water, stoppedLongAgo], entries: ENTRIES }, "2026-09-24", "2026-09-30");
    // Mobility's Monday was missed and made up on the Tuesday: 2 of 3. Water:
    // every day planned, nothing entered. The habit stopped in August is not in it.
    expect(week.habits.map((row) => [row.habit.id, row.figures])).toEqual([
      ["mobility", { planned: 3, done: 2, met: 2 }],
      ["water", { planned: 7, done: 0, met: 0 }],
    ]);
    expect(week.totals).toEqual({ planned: 10, done: 2, met: 2 });
    expect(week.habits[0].days.map((day) => [day.date, day.planned, day.met])).toEqual([
      ["2026-09-24", false, false],
      ["2026-09-25", true, true],
      ["2026-09-26", false, false],
      ["2026-09-27", false, false],
      ["2026-09-28", true, false],
      ["2026-09-29", false, true],
      ["2026-09-30", true, false],
    ]);
    // The one-date edit's target is the day's.
    expect(week.habits[1].days[6]).toMatchObject({ target: 2, edited: true });
    expect(week.habits.map((row) => row.firstStartsOn)).toEqual(["2026-09-01", "2026-09-01"]);
  });

  it("carries only the versions running during the period: the prescription those days had", () => {
    const steppedUp = habit("steps", {
      versions: [
        version({ id: "old", startsOn: "2026-08-01", endsOn: "2026-09-15" }),
        version({ id: "before", startsOn: "2026-09-16", endsOn: "2026-09-26" }),
        version({ id: "after", startsOn: "2026-09-27" }),
      ],
    });
    const week = getHabitPeriodWeek({ habits: [steppedUp], entries: [] }, "2026-09-24", "2026-09-30");
    expect(week.habits[0].versions.map((v) => v.id)).toEqual(["before", "after"]);
    // Its first start is the history's, not the first of those versions.
    expect(week.habits[0].firstStartsOn).toBe("2026-08-01");
  });

  it("dates a habit stopped before the period and started again inside it from its first start, not its restart", () => {
    // Added 1 Aug, stopped after 31 Aug, started again on Sunday 27 Sep: the
    // period holds only the restart, yet the habit was added long before it.
    const restarted = habit("restarted", {
      versions: [
        version({ id: "first", startsOn: "2026-08-01", endsOn: "2026-08-31" }),
        version({ id: "again", startsOn: "2026-09-27" }),
      ],
    });
    const [row] = getHabitPeriodWeek({ habits: [restarted], entries: [] }, "2026-09-24", "2026-09-30").habits;
    expect(row.versions.map((v) => v.id)).toEqual(["again"]);
    expect(row.firstStartsOn).toBe("2026-08-01");
    // Its days before the restart are covered by nothing that week.
    expect(row.days.slice(0, 3).map((day) => day.covered)).toEqual([false, false, false]);
  });

  it("dates a habit first added inside the period from that day", () => {
    const added = habit("added", { versions: [version({ id: "new", startsOn: "2026-09-27" })] });
    const [row] = getHabitPeriodWeek({ habits: [added], entries: [] }, "2026-09-24", "2026-09-30").habits;
    expect(row.firstStartsOn).toBe("2026-09-27");
  });

  it("reads nothing, no week anchor included: the period is the check-in's own week however the anchor has moved since", () => {
    // Monday to Friday straddles two of today's Thursday-to-Wednesday weeks.
    const week = getHabitPeriodWeek({ habits: [mobility, water, stoppedLongAgo], entries: ENTRIES }, "2026-09-28", "2026-10-02");
    expect(getClientWeekAnchor).not.toHaveBeenCalled();
    expect(listClientHabits).not.toHaveBeenCalled();
    expect(listHabitEntries).not.toHaveBeenCalled();
    expect(week.habits[0].days.map((day) => day.date)).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
    ]);
  });
});

describe("getCoachHabitList — the Habits tab's list", () => {
  const upcoming = habit("sauna", { versions: [version({ startsOn: "2026-10-05", timesPerWeek: 3, weekdays: [] })] });

  beforeEach(() => {
    vi.mocked(listClientHabitsWithEntryCheck).mockResolvedValue([
      // Edits on either side of today and one on it; no entries yet.
      {
        ...mobility,
        dayEdits: [
          { date: "2026-09-28", planned: false, target: null },
          { date: "2026-09-30", planned: true, target: null },
          { date: "2026-10-05", planned: false, target: null },
        ],
        hasEntries: false,
      },
      // Entries made, and no edit at all.
      { ...stoppedLongAgo, hasEntries: true },
      { ...upcoming, hasEntries: false },
    ]);
  });

  it("gives every habit in the client's order where it stands on the client's today, its words, whether it has entries, and its edits from today on", async () => {
    const list = await getCoachHabitList("client-3");
    expect(getClientTodayString).toHaveBeenCalledWith("client-3");
    expect(listClientHabitsWithEntryCheck).toHaveBeenCalledWith("client-3", {});
    expect(list.clientToday).toBe(TODAY);
    // Whether a habit has entries is the entry check's answer, whatever its edits.
    expect(list.habits.map((h) => [h.id, h.status, h.hasEntries, h.words])).toEqual([
      ["mobility", "running", false, { schedule: "Mon, Wed, Fri", target: null }],
      ["stopped", "stopped", true, { schedule: "Mon, Wed, Fri", target: null }],
      ["sauna", "upcoming", false, { schedule: "3 times a week", target: null }],
    ]);
    // An edit before today is history; the tab edits from today on, today's own included.
    expect(list.habits[0].dayEdits).toEqual([
      { date: "2026-09-30", planned: true, target: null },
      { date: "2026-10-05", planned: false, target: null },
    ]);
    expect(list.habits[0].versions).toEqual(mobility.versions);
  });

  it("uses the client's today when the caller already read it", async () => {
    const list = await getCoachHabitList("client-3", "2026-10-05");
    expect(getClientTodayString).not.toHaveBeenCalled();
    expect(list.clientToday).toBe("2026-10-05");
    expect(list.habits.find((h) => h.id === "sauna")?.status).toBe("running");
  });
});

describe("getHabitDaySummary — the home card's habits", () => {
  it("counts the habits running on the day, those planned on it, those planned and done that day, and what the week still asks", async () => {
    vi.mocked(listHabitEntries).mockResolvedValue([ticked("mobility", "2026-09-30")]);
    // Wednesday: Mobility and Water are planned; Mobility is done. The week,
    // Thursday 24 to Wednesday 30: Mobility 1 of 3 (2 to do), Water 0 of 7.
    expect(await getHabitDaySummary("client-3", TODAY)).toEqual({
      plannedToday: 2,
      doneToday: 1,
      running: 2,
      toDoThisWeek: 9,
    });
    // The six days either side of the date: whichever week holds it.
    expect(listClientHabits).toHaveBeenCalledWith("client-3", { from: "2026-09-24", to: "2026-10-06" });
    expect(listHabitEntries).toHaveBeenCalledWith("client-3", { from: "2026-09-24", to: "2026-10-06" });
  });

  it("never counts a habit done on a day it was not planned as done that day, and counts it toward its week", async () => {
    // Tuesday: Mobility is not planned, and made up anyway; Water is planned and not done.
    vi.mocked(listHabitEntries).mockResolvedValue([ticked("mobility", "2026-09-29")]);
    expect(await getHabitDaySummary("client-3", "2026-09-29")).toEqual({
      plannedToday: 1,
      doneToday: 0,
      running: 2,
      // Mobility's Tuesday counts toward its week: 1 of 3, 2 to do; Water 7.
      toDoThisWeek: 9,
    });
  });

  it("asks of the client week holding the date, by the client's week anchor", async () => {
    // Mobility done on Friday 25 September. A client checking in on
    // Wednesdays holds it in Wednesday 30's week (2 left of 3); one checking
    // in on Sundays starts that week on Monday 28 (3 left of 3).
    vi.mocked(listHabitEntries).mockResolvedValue([ticked("mobility", "2026-09-25")]);
    expect((await getHabitDaySummary("client-3", TODAY)).toDoThisWeek).toBe(2 + 7);
    vi.mocked(getClientWeekAnchor).mockResolvedValue({ weekday: "sunday", startDate: "2026-06-01" });
    expect((await getHabitDaySummary("client-3", TODAY)).toDoThisWeek).toBe(3 + 7);
  });

  it("asks only of the habits running on the day: one stopped earlier in the week or starting later in it is not on that day's page", async () => {
    // Mobility stopped on Monday 28 (ran to Sunday 27); Stretch starts on
    // Wednesday 30. On Tuesday 29 neither runs, so neither's week counts; Water
    // runs and asks 7.
    const stopped = habit("mobility", { versions: [version({ endsOn: "2026-09-27" })] });
    const later = habit("stretch", { versions: [version({ startsOn: "2026-09-30", weekdays: ["wednesday", "thursday"] })] });
    vi.mocked(listClientHabits).mockResolvedValue([stopped, later, water]);
    vi.mocked(listHabitEntries).mockResolvedValue([]);
    expect(await getHabitDaySummary("client-3", "2026-09-29")).toEqual({
      plannedToday: 1,
      doneToday: 0,
      running: 1,
      toDoThisWeek: 7,
    });
  });

  it("says nothing is planned on a day only a weekly habit runs, and what its week still asks", async () => {
    const sauna = habit("sauna", { versions: [version({ timesPerWeek: 3, weekdays: [] })] });
    vi.mocked(listClientHabits).mockResolvedValue([sauna]);
    vi.mocked(listHabitEntries).mockResolvedValue([ticked("sauna", "2026-09-25"), ticked("sauna", "2026-09-27")]);
    expect(await getHabitDaySummary("client-3", "2026-09-29")).toEqual({
      plannedToday: 0,
      doneToday: 0,
      running: 1,
      toDoThisWeek: 1,
    });
  });

  it("reads the week's anchor and the habits side by side", async () => {
    let answerAnchor: (anchor: Awaited<ReturnType<typeof getClientWeekAnchor>>) => void = () => {};
    vi.mocked(getClientWeekAnchor).mockReturnValue(new Promise((resolve) => (answerAnchor = resolve)));

    const summary = getHabitDaySummary("client-3", TODAY);
    // The habits are asked for before the anchor answers.
    await vi.waitFor(() => expect(listClientHabits).toHaveBeenCalled());
    expect(listHabitEntries).toHaveBeenCalled();

    answerAnchor({ weekday: "wednesday", startDate: null });
    expect((await summary).plannedToday).toBe(2);
  });
});

describe("hasHabitFromToday — the activation card's habits item", () => {
  it("is true for a habit running on the client's today, or one starting later", async () => {
    vi.mocked(listClientHabits).mockResolvedValue([stoppedLongAgo, mobility]);
    expect(await hasHabitFromToday("client-3", TODAY)).toBe(true);
    vi.mocked(listClientHabits).mockResolvedValue([habit("later", { versions: [version({ startsOn: "2026-10-12" })] })]);
    expect(await hasHabitFromToday("client-3", TODAY)).toBe(true);
  });

  it("is false with only stopped habits, or none", async () => {
    vi.mocked(listClientHabits).mockResolvedValue([stoppedLongAgo]);
    expect(await hasHabitFromToday("client-3", TODAY)).toBe(false);
    vi.mocked(listClientHabits).mockResolvedValue([]);
    expect(await hasHabitFromToday("client-3", TODAY)).toBe(false);
  });

  it("judges on the today it is handed, reading none of its own and no edit but that day's", async () => {
    // Stopped at the end of August, so stopped on the 30 September the today
    // service would give — but running on the 15 August it is handed.
    vi.mocked(listClientHabits).mockResolvedValue([stoppedLongAgo]);
    expect(await hasHabitFromToday("client-3", "2026-08-15")).toBe(true);
    expect(getClientTodayString).not.toHaveBeenCalled();
    expect(listClientHabits).toHaveBeenCalledWith("client-3", { from: "2026-08-15", to: "2026-08-15" });
  });
});
