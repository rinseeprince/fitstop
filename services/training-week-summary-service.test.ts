import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./training-event-service", () => ({ getEventsForDateRange: vi.fn() }));
vi.mock("./today-service", () => ({ getCoachTodayString: vi.fn() }));
vi.mock("./check-in-week-service", () => ({ getClientWeekAnchor: vi.fn() }));

import { getEventsForDateRange } from "./training-event-service";
import { getCoachTodayString } from "./today-service";
import { getClientWeekAnchor } from "./check-in-week-service";
import { getTrainingWeekSummary } from "./training-week-summary-service";
import { createMockTrainingEvent } from "@/__tests__/helpers/mock-data-builders";
import type { TrainingEventStatus } from "@/types/training";

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
  quality: "full" | "partial" | "skipped" | null,
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
  it("counts the week's calendar workouts up to today, full completions only", async () => {
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
      completed: 2,
      totalPlanned: 4,
      plannedUpToToday: 4,
      // A partial is not a full completion here, so it sits in missed until
      // commit 10 moves every done-count together.
      missed: 2,
      weekStart: WEEK_START,
      weekEnd: WEEK_END,
    });
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
    // 209 such rows on dev: completed, with no log to have recorded a quality.
    readEvents.mockResolvedValue([workout("2026-09-15", null, "completed")]);

    const summary = await getTrainingWeekSummary(CLIENT, COACH);

    expect(summary).toMatchObject({ completed: 1, plannedUpToToday: 1, missed: 0 });
  });

  it("reads a stored skip as a workout that was not done", async () => {
    readEvents.mockResolvedValue([workout("2026-09-15", "skipped", "skipped")]);

    const summary = await getTrainingWeekSummary(CLIENT, COACH);

    expect(summary).toMatchObject({ completed: 0, plannedUpToToday: 1, missed: 1 });
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
