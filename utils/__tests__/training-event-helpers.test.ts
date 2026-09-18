import { describe, it, expect } from "vitest";
import { mapEventsToScheduleDays } from "@/utils/training-event-helpers";
import { createMockTrainingEvent } from "@/__tests__/helpers/mock-data-builders";
import type { LoggedQuality } from "@/types/training";

// The caller's own calendar day — the coach's for the history table, the
// client's for the week a check-in freezes. Wednesday 8 April 2026.
const TODAY = "2026-04-08";

const log = (
  completionQuality: LoggedQuality,
  performedSessionId: string | null = null
) => ({ id: "log-1", completionQuality, performedSessionId, notes: null });

describe("mapEventsToScheduleDays", () => {
  it("maps a workout logged in full", () => {
    const events = [
      createMockTrainingEvent({
        date: "2026-04-06",
        sessionName: "Push Day",
        status: "completed",
        sessionLogId: "log-1",
        trainingSessionId: "session-1",
        log: log("full", "session-1"),
      }),
    ];

    const result = mapEventsToScheduleDays(["2026-04-06"], events, TODAY);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      date: "2026-04-06",
      dayOfWeek: "monday",
      status: "completed",
      plannedSessionName: "Push Day",
      completionQuality: "full",
      loggedSessionName: "Push Day",
      isAlternative: false,
      sessionLogId: "log-1",
    });
  });

  it("reads PARTIAL off the log, not off the status word", () => {
    // The event says only that the client logged it.
    const flipped = createMockTrainingEvent({
      date: "2026-04-07",
      sessionName: "Pull Day",
      status: "completed",
      sessionLogId: "log-1",
      trainingSessionId: "session-1",
      log: log("partial", "session-1"),
    });

    expect(mapEventsToScheduleDays(["2026-04-07"], [flipped], TODAY)[0]).toMatchObject({
      status: "completed",
      completionQuality: "partial",
      loggedSessionName: "Pull Day",
    });
  });

  it("reads a workout logged before the link existed as full", () => {
    // 209 such rows on dev: no log to carry a quality, so nobody recorded one.
    const events = [
      createMockTrainingEvent({ date: "2026-04-06", status: "completed", sessionLogId: null }),
    ];

    expect(mapEventsToScheduleDays(["2026-04-06"], events, TODAY)[0]).toMatchObject({
      status: "completed",
      completionQuality: "full",
    });
  });

  it("treats a workout still scheduled on a day that has passed as missed", () => {
    const events = [
      createMockTrainingEvent({ date: "2026-04-06", sessionName: "Leg Day", status: "scheduled" }),
    ];

    expect(mapEventsToScheduleDays(["2026-04-06"], events, TODAY)[0]).toMatchObject({
      status: "missed",
      completionQuality: null,
      loggedSessionName: null,
    });
  });

  it("treats a workout still to be done as scheduled, with its planned fields", () => {
    const events = [
      createMockTrainingEvent({
        date: "2026-04-10",
        sessionName: "Push Day",
        status: "scheduled",
        trainingSessionId: "session-1",
      }),
    ];

    expect(mapEventsToScheduleDays(["2026-04-10"], events, TODAY)[0]).toMatchObject({
      date: "2026-04-10",
      dayOfWeek: "friday",
      status: "scheduled",
      plannedSessionId: "session-1",
      plannedSessionName: "Push Day",
      loggedSessionName: null,
      completionQuality: null,
    });
  });

  it("returns rest for dates with no workout", () => {
    expect(mapEventsToScheduleDays(["2026-04-09"], [], TODAY)[0]).toMatchObject({
      date: "2026-04-09",
      dayOfWeek: "thursday",
      status: "rest",
      plannedSessionId: null,
      plannedSessionName: null,
      loggedSessionName: null,
      completionQuality: null,
      sessionLogId: null,
    });
  });

  it("handles a full week with mixed workouts", () => {
    const dates = [
      "2026-04-06", // Mon - logged
      "2026-04-07", // Tue - rest
      "2026-04-08", // Wed (today) - still to be done
      "2026-04-09", // Thu - rest
      "2026-04-10", // Fri - still to be done
      "2026-04-11", // Sat - rest
      "2026-04-12", // Sun - rest
    ];

    const events = [
      createMockTrainingEvent({
        date: "2026-04-06",
        sessionName: "Push",
        status: "completed",
        sessionLogId: "log-1",
        log: log("full"),
      }),
      createMockTrainingEvent({ date: "2026-04-08", sessionName: "Pull", status: "scheduled" }),
      createMockTrainingEvent({ date: "2026-04-10", sessionName: "Legs", status: "scheduled" }),
    ];

    const result = mapEventsToScheduleDays(dates, events, TODAY);

    expect(result.map((d) => d.status)).toEqual([
      "completed", // Mon
      "rest",      // Tue
      "scheduled", // Wed (today — not missed, the client can still train)
      "rest",      // Thu
      "scheduled", // Fri
      "rest",      // Sat
      "rest",      // Sun
    ]);
    expect(result[2].plannedSessionName).toBe("Pull");
    expect(result[4].plannedSessionName).toBe("Legs");
  });

  it("gives each workout on a date its own row, in the day's order", () => {
    const events = [
      createMockTrainingEvent({
        id: "ev-am",
        date: "2026-04-06",
        sessionName: "Morning run",
        status: "completed",
        sessionLogId: "log-1",
        trainingSessionId: "run-1",
        log: log("full", "run-1"),
      }),
      createMockTrainingEvent({
        id: "ev-pm",
        date: "2026-04-06",
        sessionName: "Evening lift",
        status: "scheduled",
        trainingSessionId: "lift-1",
      }),
    ];

    const result = mapEventsToScheduleDays(["2026-04-06", "2026-04-07"], events, TODAY);

    expect(result.map((row) => [row.date, row.plannedSessionName, row.status])).toEqual([
      ["2026-04-06", "Morning run", "completed"],
      // Past and never logged: missed — not hidden behind the logged one.
      ["2026-04-06", "Evening lift", "missed"],
      ["2026-04-07", null, "rest"],
    ]);
  });

  it("carries the log's own note onto the row", () => {
    const events = [
      createMockTrainingEvent({
        date: "2026-04-06",
        status: "completed",
        sessionLogId: "log-1",
        trainingSessionId: "session-1",
        log: { ...log("partial", "session-1"), notes: "Shoulder was sore" },
      }),
    ];

    expect(mapEventsToScheduleDays(["2026-04-06"], events, TODAY)[0].notes).toBe(
      "Shoulder was sore"
    );
  });

  it("a swap shows the PERFORMED session name, not the prescribed one", () => {
    const events = [
      createMockTrainingEvent({
        date: "2026-04-06",
        sessionName: "Chest Day",
        status: "completed",
        trainingSessionId: "chest",
        sessionLogId: "log-1",
        log: log("full", "back"),
      }),
    ];

    const result = mapEventsToScheduleDays(
      ["2026-04-06"],
      events,
      TODAY,
      new Map([["back", "Back Day"]])
    );

    expect(result[0].status).toBe("completed");
    expect(result[0].isAlternative).toBe(true);
    expect(result[0].loggedSessionName).toBe("Back Day"); // performed, not "Chest Day"
    expect(result[0].plannedSessionName).toBe("Chest Day"); // prescribed still surfaced
  });

  it("a swap falls back to the prescribed name when no performed name is provided", () => {
    const events = [
      createMockTrainingEvent({
        date: "2026-04-06",
        sessionName: "Chest Day",
        status: "completed",
        trainingSessionId: "chest",
        sessionLogId: "log-1",
        log: log("full", "back"),
      }),
    ];

    const result = mapEventsToScheduleDays(["2026-04-06"], events, TODAY);

    expect(result[0].isAlternative).toBe(true);
    expect(result[0].loggedSessionName).toBe("Chest Day");
  });
});
