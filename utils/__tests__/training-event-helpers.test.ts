import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mapEventsToScheduleDays } from "@/utils/training-event-helpers";
import { createMockTrainingEvent } from "@/__tests__/helpers/mock-data-builders";

describe("mapEventsToScheduleDays", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Fix "today" to Wednesday April 8, 2026
    vi.setSystemTime(new Date("2026-04-08T12:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps a completed event correctly", () => {
    const dates = ["2026-04-06"]; // Monday
    const events = [
      createMockTrainingEvent({
        date: "2026-04-06",
        sessionName: "Push Day",
        status: "completed",
        trainingSessionId: "session-1",
      }),
    ];

    const result = mapEventsToScheduleDays(dates, events);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      date: "2026-04-06",
      dayOfWeek: "monday",
      status: "completed",
      plannedSessionName: "Push Day",
      completionQuality: "full",
      loggedSessionName: "Push Day",
      isAlternative: false,
      sessionLogId: null,
    });
  });

  it("maps a partial event correctly", () => {
    const dates = ["2026-04-07"]; // Tuesday
    const events = [
      createMockTrainingEvent({
        date: "2026-04-07",
        sessionName: "Pull Day",
        status: "partial",
      }),
    ];

    const result = mapEventsToScheduleDays(dates, events);

    expect(result[0]).toMatchObject({
      status: "partial",
      completionQuality: "partial",
      loggedSessionName: "Pull Day",
    });
  });

  it("treats a scheduled event in the past as missed", () => {
    // 2026-04-06 is before today (2026-04-08)
    const dates = ["2026-04-06"];
    const events = [
      createMockTrainingEvent({
        date: "2026-04-06",
        sessionName: "Leg Day",
        status: "scheduled",
      }),
    ];

    const result = mapEventsToScheduleDays(dates, events);

    expect(result[0]).toMatchObject({
      status: "missed",
      completionQuality: null,
      loggedSessionName: null,
    });
  });

  it("treats a scheduled event in the future as rest with planned fields", () => {
    // 2026-04-10 is after today (2026-04-08), it's a Friday
    const dates = ["2026-04-10"];
    const events = [
      createMockTrainingEvent({
        date: "2026-04-10",
        sessionName: "Push Day",
        status: "scheduled",
        trainingSessionId: "session-1",
      }),
    ];

    const result = mapEventsToScheduleDays(dates, events);

    expect(result[0]).toMatchObject({
      date: "2026-04-10",
      dayOfWeek: "friday",
      status: "rest",
      plannedSessionId: "session-1",
      plannedSessionName: "Push Day",
      loggedSessionName: null,
      completionQuality: null,
    });
  });

  it("returns rest for dates with no event", () => {
    const dates = ["2026-04-09"]; // Thursday with no event
    const events: ReturnType<typeof createMockTrainingEvent>[] = [];

    const result = mapEventsToScheduleDays(dates, events);

    expect(result[0]).toMatchObject({
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

  it("maps a skipped event as missed with skipped quality", () => {
    const dates = ["2026-04-06"];
    const events = [
      createMockTrainingEvent({
        date: "2026-04-06",
        sessionName: "Push Day",
        status: "skipped",
      }),
    ];

    const result = mapEventsToScheduleDays(dates, events);

    expect(result[0]).toMatchObject({
      status: "missed",
      completionQuality: "skipped",
      loggedSessionName: null,
    });
  });

  it("handles a full week with mixed event types", () => {
    const dates = [
      "2026-04-06", // Mon - completed
      "2026-04-07", // Tue - rest
      "2026-04-08", // Wed (today) - scheduled
      "2026-04-09", // Thu - rest
      "2026-04-10", // Fri - scheduled (future)
      "2026-04-11", // Sat - rest
      "2026-04-12", // Sun - rest
    ];

    const events = [
      createMockTrainingEvent({ date: "2026-04-06", sessionName: "Push", status: "completed" }),
      createMockTrainingEvent({ date: "2026-04-08", sessionName: "Pull", status: "scheduled" }),
      createMockTrainingEvent({ date: "2026-04-10", sessionName: "Legs", status: "scheduled" }),
    ];

    const result = mapEventsToScheduleDays(dates, events);

    expect(result.map((d) => d.status)).toEqual([
      "completed", // Mon
      "rest",      // Tue
      "rest",      // Wed (today, scheduled → rest with planned)
      "rest",      // Thu
      "rest",      // Fri (future scheduled → rest with planned)
      "rest",      // Sat
      "rest",      // Sun
    ]);

    // Wednesday and Friday should have planned session names
    expect(result[2].plannedSessionName).toBe("Pull");
    expect(result[4].plannedSessionName).toBe("Legs");
  });

  it("gives each workout on a date its own row, in the day's order", () => {
    const dates = ["2026-04-06", "2026-04-07"];
    const events = [
      createMockTrainingEvent({
        id: "ev-am",
        date: "2026-04-06",
        sessionName: "Morning run",
        status: "completed",
        trainingSessionId: "run-1",
      }),
      createMockTrainingEvent({
        id: "ev-pm",
        date: "2026-04-06",
        sessionName: "Evening lift",
        status: "scheduled",
        trainingSessionId: "lift-1",
      }),
    ];

    const result = mapEventsToScheduleDays(dates, events);

    expect(result.map((row) => [row.date, row.plannedSessionName, row.status])).toEqual([
      ["2026-04-06", "Morning run", "completed"],
      // Past and never logged: missed — not hidden behind the logged one.
      ["2026-04-06", "Evening lift", "missed"],
      ["2026-04-07", null, "rest"],
    ]);
  });

  it("threads sessionLogId from a completed event", () => {
    const dates = ["2026-04-06"];
    const events = [
      createMockTrainingEvent({
        date: "2026-04-06",
        sessionName: "Push Day",
        status: "completed",
        sessionLogId: "log-123",
      }),
    ];

    const result = mapEventsToScheduleDays(dates, events);

    expect(result[0].sessionLogId).toBe("log-123");
  });

  it("sets sessionLogId from unlinked log when merged into missed day", () => {
    const dates = ["2026-04-06"];
    const events = [
      createMockTrainingEvent({
        date: "2026-04-06",
        sessionName: "Push Day",
        status: "missed",
      }),
    ];
    const unlinkedLogs = [
      {
        id: "unlinked-log-1",
        training_session_id: "other-session",
        completed_at: "2026-04-06",
        completion_quality: "full",
        notes: null,
        prescribed_session_snapshot: { name: "Alt Session" },
      },
    ];

    const result = mapEventsToScheduleDays(dates, events, unlinkedLogs);

    expect(result[0].sessionLogId).toBe("unlinked-log-1");
    expect(result[0].status).toBe("completed_swap");
  });

  it("sets sessionLogId from unlinked log when merged into rest day", () => {
    const dates = ["2026-04-06"];
    const events: ReturnType<typeof createMockTrainingEvent>[] = [];
    const unlinkedLogs = [
      {
        id: "rest-log-1",
        training_session_id: null,
        completed_at: "2026-04-06",
        completion_quality: "full",
        notes: null,
        prescribed_session_snapshot: { name: "Extra Session" },
      },
    ];

    const result = mapEventsToScheduleDays(dates, events, unlinkedLogs);

    expect(result[0].sessionLogId).toBe("rest-log-1");
    expect(result[0].status).toBe("rest_trained");
  });

  it("event-linked swap shows the PERFORMED session name, not the prescribed snapshot", () => {
    const dates = ["2026-04-06"];
    const events = [
      createMockTrainingEvent({
        date: "2026-04-06",
        sessionName: "Chest Day",
        status: "completed",
        trainingSessionId: "chest",
        sessionLogId: "log-1",
      }),
    ];
    const sessionLogMap = new Map([
      [
        "log-1",
        {
          id: "log-1",
          training_session_id: "back", // performed differs from prescribed (chest)
          completed_at: "2026-04-06",
          completion_quality: "full" as const,
          notes: null,
          prescribed_session_snapshot: { name: "Chest Day" }, // prescribed snapshot
        },
      ],
    ]);
    const performedSessionNames = new Map([["back", "Back Day"]]);

    const result = mapEventsToScheduleDays(
      dates,
      events,
      [],
      sessionLogMap,
      performedSessionNames
    );

    expect(result[0].status).toBe("completed_swap");
    expect(result[0].isAlternative).toBe(true);
    expect(result[0].loggedSessionName).toBe("Back Day"); // performed, not "Chest Day"
    expect(result[0].plannedSessionName).toBe("Chest Day"); // prescribed still surfaced
  });

  it("event-linked swap falls back to the snapshot name when no performed name is provided", () => {
    const dates = ["2026-04-06"];
    const events = [
      createMockTrainingEvent({
        date: "2026-04-06",
        sessionName: "Chest Day",
        status: "completed",
        trainingSessionId: "chest",
        sessionLogId: "log-1",
      }),
    ];
    const sessionLogMap = new Map([
      [
        "log-1",
        {
          id: "log-1",
          training_session_id: "back",
          completed_at: "2026-04-06",
          completion_quality: "full" as const,
          notes: null,
          prescribed_session_snapshot: { name: "Chest Day" },
        },
      ],
    ]);

    const result = mapEventsToScheduleDays(dates, events, [], sessionLogMap);

    expect(result[0].isAlternative).toBe(true);
    expect(result[0].loggedSessionName).toBe("Chest Day"); // snapshot fallback
  });

  it("merges an unlinked log onto the date's first missed workout, leaving the logged one alone", () => {
    const dates = ["2026-04-06"];
    const events = [
      createMockTrainingEvent({ id: "ev-1", date: "2026-04-06", sessionName: "Legs", status: "partial" }),
      createMockTrainingEvent({ id: "ev-2", date: "2026-04-06", sessionName: "Legs v2", status: "scheduled" }),
    ];
    const unlinked = [
      {
        id: "log-extra",
        training_session_id: "other",
        completed_at: "2026-04-06T18:00:00Z",
        completion_quality: "full",
        notes: null,
        prescribed_session_snapshot: { name: "Arms" },
      },
    ];

    const result = mapEventsToScheduleDays(dates, events, unlinked);

    expect(result.map((row) => [row.plannedSessionName, row.status, row.sessionLogId])).toEqual([
      ["Legs", "partial", null],
      ["Legs v2", "completed_swap", "log-extra"],
    ]);
  });
});
