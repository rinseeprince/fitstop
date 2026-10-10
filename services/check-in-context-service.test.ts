import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockTrainingEvent } from "@/__tests__/helpers/mock-data-builders";
import type { LoggedQuality } from "@/types/training";

// Mock supabase-admin before importing the service under test.
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

// Mock the training-event-service: we exercise getTrainingEventDetailsForPeriod,
// which calls getEventsForDateRange — the events arrive with their logs already
// embedded, so the only query left in the function is the performed-session
// name lookup on a swap.
vi.mock("./training-event-service", () => ({
  getEventsForDateRange: vi.fn(),
}));

import { supabaseAdmin } from "./supabase-admin";
import { getEventsForDateRange } from "./training-event-service";
import { getTrainingEventDetailsForPeriod } from "./check-in-context-service";

const mockFrom = vi.mocked(supabaseAdmin.from);
const mockGetEvents = vi.mocked(getEventsForDateRange);

/** The log a calendar read embeds on a workout. */
const log = (overrides: {
  id?: string;
  completionQuality?: LoggedQuality;
  performedSessionId?: string | null;
  notes?: string | null;
}) => ({
  id: overrides.id ?? "log-1",
  completionQuality: overrides.completionQuality ?? "full",
  performedSessionId:
    overrides.performedSessionId === undefined ? null : overrides.performedSessionId,
  notes: overrides.notes ?? null,
});

const PERIOD_START = "2026-04-06";
const PERIOD_END = "2026-04-12";
const CLIENT = "client-1";

// Build a chained query whose terminal (.in) resolves to `{ data }`. Used for
// the batched training_sessions name read on a swap.
function sessionNamesQuery(
  data: Array<{ id: string; name: string }> | null,
  error: { message: string } | null = null,
) {
  const q: Record<string, unknown> = {};
  q.select = vi.fn(() => q);
  q.in = vi.fn(() => Promise.resolve({ data, error }));
  return q;
}

describe("check-in-context-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // getTrainingEventDetailsForPeriod — single-source per-workout detail
  // =========================================================================
  describe("getTrainingEventDetailsForPeriod", () => {
    it("returns [] and queries nothing else when there are no events", async () => {
      mockGetEvents.mockResolvedValue([]);

      const result = await getTrainingEventDetailsForPeriod(CLIENT, PERIOD_START, PERIOD_END);

      expect(result).toEqual([]);
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("emits status + name + the log's quality for a logged workout", async () => {
      const ev = createMockTrainingEvent({
        id: "ev-1",
        date: "2026-04-08",
        sessionName: "Push Day",
        status: "completed",
        sessionLogId: "log-1",
        trainingSessionId: "sess-1",
        log: log({ performedSessionId: "sess-1", notes: "felt strong" }),
      });
      mockGetEvents.mockResolvedValue([ev]);

      const result = await getTrainingEventDetailsForPeriod(CLIENT, PERIOD_START, PERIOD_END);

      // The quality rides the events read — no second query for the logs.
      expect(mockFrom).not.toHaveBeenCalled();
      expect(result).toEqual([
        {
          eventId: "ev-1",
          date: "2026-04-08",
          sessionName: "Push Day",
          status: "completed",
          logStatus: "logged",
          trainingSessionId: "sess-1",
          sessionLogId: "log-1",
          notes: "felt strong",
          completionQuality: "full",
        },
      ]);
    });

    it("carries the notes and the PARTIAL quality of a workout partly done", async () => {
      const ev = createMockTrainingEvent({
        id: "ev-2",
        date: "2026-04-09",
        sessionName: "Leg Day",
        status: "completed",
        sessionLogId: "log-2",
        trainingSessionId: "sess-2",
        log: log({
          id: "log-2",
          completionQuality: "partial",
          performedSessionId: "sess-2",
          notes: "knee sore, cut it short",
        }),
      });
      mockGetEvents.mockResolvedValue([ev]);

      const result = await getTrainingEventDetailsForPeriod(CLIENT, PERIOD_START, PERIOD_END);

      expect(result[0]).toMatchObject({
        eventId: "ev-2",
        status: "completed",
        logStatus: "logged",
        notes: "knee sore, cut it short",
        completionQuality: "partial",
      });
    });

    it("marks a workout with no log as not_logged, with a null quality and no notes", async () => {
      const ev = createMockTrainingEvent({
        id: "ev-3",
        date: "2026-04-10",
        sessionName: "Pull Day",
        status: "scheduled",
        sessionLogId: null,
        trainingSessionId: "sess-3",
      });
      mockGetEvents.mockResolvedValue([ev]);

      const result = await getTrainingEventDetailsForPeriod(CLIENT, PERIOD_START, PERIOD_END);

      expect(mockFrom).not.toHaveBeenCalled();
      expect(result[0]).toEqual({
        eventId: "ev-3",
        date: "2026-04-10",
        sessionName: "Pull Day",
        status: "scheduled",
        logStatus: "not_logged",
        trainingSessionId: "sess-3",
        sessionLogId: null,
        // Always present, so the row itself is a workout read.
        completionQuality: null,
      });
      expect(result[0]).not.toHaveProperty("notes");
    });

    it("returns details in calendar order, each carrying its own log's quality", async () => {
      const evA = createMockTrainingEvent({
        id: "ev-a",
        date: "2026-04-06",
        sessionName: "A",
        status: "completed",
        sessionLogId: "log-a",
        trainingSessionId: "sess-a",
        log: log({ id: "log-a", performedSessionId: "sess-a" }),
      });
      const evB = createMockTrainingEvent({
        id: "ev-b",
        date: "2026-04-08",
        sessionName: "B",
        status: "scheduled",
        sessionLogId: null,
        trainingSessionId: "sess-b",
      });
      const evC = createMockTrainingEvent({
        id: "ev-c",
        date: "2026-04-11",
        sessionName: "C",
        status: "completed",
        sessionLogId: "log-c",
        trainingSessionId: "sess-c",
        log: log({
          id: "log-c",
          completionQuality: "partial",
          performedSessionId: "sess-c",
          notes: "tired",
        }),
      });
      // getEventsForDateRange already returns ordered-by-date events.
      mockGetEvents.mockResolvedValue([evA, evB, evC]);

      const result = await getTrainingEventDetailsForPeriod(CLIENT, PERIOD_START, PERIOD_END);

      expect(result.map((d) => d.eventId)).toEqual(["ev-a", "ev-b", "ev-c"]);
      // Logged with null notes → quality set, no notes key.
      expect(result[0]).toMatchObject({ logStatus: "logged", completionQuality: "full" });
      expect(result[0]).not.toHaveProperty("notes");
      // Unlogged middle workout.
      expect(result[1]).toMatchObject({
        logStatus: "not_logged",
        status: "scheduled",
        completionQuality: null,
      });
      // Partial-with-log.
      expect(result[2]).toMatchObject({
        logStatus: "logged",
        completionQuality: "partial",
        notes: "tired",
      });
    });

    it("resolves performedSessionName on a swap (performed session ≠ prescribed)", async () => {
      const ev = createMockTrainingEvent({
        id: "ev-1",
        date: "2026-04-08",
        sessionName: "Push Day",
        status: "completed",
        sessionLogId: "log-1",
        trainingSessionId: "sess-prescribed",
        log: log({ performedSessionId: "sess-performed" }),
      });
      mockGetEvents.mockResolvedValue([ev]);
      mockFrom.mockReturnValue(
        sessionNamesQuery([{ id: "sess-performed", name: "Pull Day" }]) as never,
      );

      const result = await getTrainingEventDetailsForPeriod(CLIENT, PERIOD_START, PERIOD_END);

      expect(mockFrom).toHaveBeenCalledTimes(1);
      expect(mockFrom).toHaveBeenCalledWith("training_sessions");
      expect(result[0]).toMatchObject({
        sessionLogId: "log-1",
        trainingSessionId: "sess-prescribed",
        performedSessionName: "Pull Day",
      });
    });

    it("does not look up a name (or set performedSessionName) when performed === prescribed", async () => {
      const ev = createMockTrainingEvent({
        id: "ev-1",
        date: "2026-04-08",
        sessionName: "Push Day",
        status: "completed",
        sessionLogId: "log-1",
        trainingSessionId: "sess-1",
        log: log({ performedSessionId: "sess-1" }),
      });
      mockGetEvents.mockResolvedValue([ev]);

      const result = await getTrainingEventDetailsForPeriod(CLIENT, PERIOD_START, PERIOD_END);

      expect(mockFrom).not.toHaveBeenCalled();
      expect(result[0]).not.toHaveProperty("performedSessionName");
    });
  });
});
