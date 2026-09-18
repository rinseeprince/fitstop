import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./training-event-service", () => ({ getEventsForDateRange: vi.fn() }));
vi.mock("./today-service", () => ({ getCoachTodayString: vi.fn() }));
vi.mock("./check-in-week-service", () => ({ getClientWeekAnchor: vi.fn() }));

import { getEventsForDateRange } from "./training-event-service";
import { getCoachTodayString } from "./today-service";
import { getClientWeekAnchor } from "./check-in-week-service";
import { getTrainingWeekSummary } from "./training-week-summary-service";
import { createMockTrainingEvent } from "@/__tests__/helpers/mock-data-builders";
import type { LoggedQuality, TrainingEventStatus } from "@/types/training";

const CLIENT = "client-1";
const COACH = "coach-1";
// Thursday. The client checks in on Mondays, so their week ENDS on a Monday:
// Tue 15 – Mon 21 (lib/check-in-week.ts anchors the week on the check-in day).
const TODAY = "2026-09-17";
const WEEK_START = "2026-09-15";
const WEEK_END = "2026-09-21";

const readEvents = vi.mocked(getEventsForDateRange);

const workout = (
  date: string,
  quality: LoggedQuality | null,
  status: TrainingEventStatus = quality === null ? "scheduled" : "completed"
) =>
  createMockTrainingEvent({
    date,
    status,
    sessionLogId: quality === null ? null : "log-1",
    log:
      quality === null
        ? null
        : { id: "log-1", completionQuality: quality, performedSessionId: null, notes: null },
  });

describe("getTrainingWeekSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCoachTodayString).mockResolvedValue(TODAY);
    vi.mocked(getClientWeekAnchor).mockResolvedValue({
      weekday: "monday",
    } as Awaited<ReturnType<typeof getClientWeekAnchor>>);
    readEvents.mockResolvedValue([]);
  });

  // The primary branch: a week with workouts on it, some logged.
  it("counts every workout the client logged in the week, up to today", async () => {
    readEvents.mockResolvedValue([
      workout("2026-09-15", "full"),
      workout("2026-09-16", "partial"),
      workout("2026-09-16", null), // the day passed, never logged
      workout("2026-09-17", "full"), // today, already logged
    ]);

    const summary = await getTrainingWeekSummary(CLIENT, COACH);

    // The read is the week, capped at today — a session still to be done on
    // Friday is neither planned-against nor missed yet.
    expect(readEvents).toHaveBeenCalledWith(CLIENT, WEEK_START, TODAY);
    expect(summary).toEqual({
      // The partial is one of the three: a workout partly done is a workout
      // done, so only the one nobody logged is missed.
      completed: 3,
      totalPlanned: 4,
      plannedUpToToday: 4,
      missed: 1,
      weekStart: WEEK_START,
      weekEnd: WEEK_END,
    });
  });

  // The cap is inclusive of today, so without the day rule a session the client
  // can still do this afternoon sits in `planned` AND in `missed` — while the
  // Overview's rail beside it, which derives missed from the day, calls the same
  // session "no log".
  it("leaves today's unlogged workout out of both sides until it is logged", async () => {
    readEvents.mockResolvedValue([
      workout("2026-09-15", "full"),
      workout("2026-09-16", "partial"),
      workout(TODAY, null), // still to be done, later today
    ]);

    expect(await getTrainingWeekSummary(CLIENT, COACH)).toMatchObject({
      completed: 2,
      totalPlanned: 2,
      plannedUpToToday: 2,
      missed: 0,
    });
  });

  it("counts today's workout on both sides the moment it is logged", async () => {
    readEvents.mockResolvedValue([
      workout("2026-09-15", "full"),
      workout("2026-09-16", "partial"),
      workout(TODAY, "partial"),
    ]);

    expect(await getTrainingWeekSummary(CLIENT, COACH)).toMatchObject({
      completed: 3,
      totalPlanned: 3,
      plannedUpToToday: 3,
      missed: 0,
    });
  });

  // The rule is TODAY's alone: a day that has passed with nothing logged is a
  // miss, whether or not the client could still have trained on it.
  it("still counts a workout missed on a day that has passed", async () => {
    readEvents.mockResolvedValue([
      workout("2026-09-15", null),
      workout(TODAY, null),
    ]);

    expect(await getTrainingWeekSummary(CLIENT, COACH)).toMatchObject({
      completed: 0,
      plannedUpToToday: 1,
      missed: 1,
    });
  });

  // completed + missed === planned, on every branch. The three figures sit on
  // one band; a coach reading 3 of 4 above "1 missed" can add them up.
  it("always leaves three figures that add up", async () => {
    readEvents.mockResolvedValue([
      workout("2026-09-15", "full"),
      workout("2026-09-16", null),
      workout(TODAY, null),
    ]);

    const summary = await getTrainingWeekSummary(CLIENT, COACH);
    expect(summary.completed + summary.missed).toBe(summary.plannedUpToToday);
  });

  // M7: the count is the CALENDAR's, by date. A log's stored completed_at does
  // not move when the workout moves, which put a moved workout in the wrong
  // week; nothing here reads it.
  it("counts a workout on the day its event sits on, whatever its log says", async () => {
    readEvents.mockResolvedValue([workout("2026-09-16", "full")]);

    const summary = await getTrainingWeekSummary(CLIENT, COACH);

    expect(summary.completed).toBe(1);
    expect(summary.plannedUpToToday).toBe(1);
    expect(summary.missed).toBe(0);
  });

  it("reads a workout logged before the link existed as a full completion", async () => {
    // 227 such rows on dev: completed, with no log to have recorded a quality.
    readEvents.mockResolvedValue([workout("2026-09-15", null, "completed")]);

    const summary = await getTrainingWeekSummary(CLIENT, COACH);

    expect(summary).toMatchObject({ completed: 1, plannedUpToToday: 1, missed: 0 });
  });

  it("reads zero for a week with no workouts, and never a negative miss", async () => {
    const summary = await getTrainingWeekSummary(CLIENT, COACH);

    expect(summary).toMatchObject({
      completed: 0,
      totalPlanned: 0,
      plannedUpToToday: 0,
      missed: 0,
    });
  });

  it("follows the client's own check-in day, not a Monday-first week", async () => {
    vi.mocked(getClientWeekAnchor).mockResolvedValue({
      weekday: "friday",
    } as Awaited<ReturnType<typeof getClientWeekAnchor>>);

    const summary = await getTrainingWeekSummary(CLIENT, COACH);

    // Sat 12 – Fri 18, the week containing Thursday 17.
    expect(readEvents).toHaveBeenCalledWith(CLIENT, "2026-09-12", TODAY);
    expect(summary).toMatchObject({ weekStart: "2026-09-12", weekEnd: "2026-09-18" });
  });
});
