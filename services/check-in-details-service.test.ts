import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CheckIn, CheckInTrainingEventDetail } from "@/types/check-in";

// Mock the spine reader + the legacy-fallback dependencies. These let us assert
// that the derivation uses the STORED period (never a today-relative window) and
// maps to the preserved CheckInSessionCompletion shape.
const getTrainingEventDetailsForPeriodMock = vi.fn();
const getClientByIdMock = vi.fn();
const calculateCheckInPeriodMock = vi.fn();

vi.mock("./check-in-context-service", () => ({
  getTrainingEventDetailsForPeriod: (...args: unknown[]) =>
    getTrainingEventDetailsForPeriodMock(...args),
}));

vi.mock("./client-service", () => ({
  getClientById: (...args: unknown[]) => getClientByIdMock(...args),
}));

vi.mock("@/lib/date-helpers", () => ({
  calculateCheckInPeriod: (...args: unknown[]) => calculateCheckInPeriodMock(...args),
}));

// Not exercised here but imported transitively.
vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./check-in-service", () => ({ getCheckInById: vi.fn() }));

import { deriveSessionCompletionsForCheckIn } from "./check-in-details-service";

const baseCheckIn = (overrides: Partial<CheckIn> = {}): CheckIn => ({
  id: "ci-1",
  clientId: "client-1",
  status: "pending",
  periodStart: "2026-05-08",
  periodEnd: "2026-05-14",
  createdAt: "2026-05-14T12:00:00Z",
  updatedAt: "2026-05-14T12:00:00Z",
  ...overrides,
});

const detail = (overrides: Partial<CheckInTrainingEventDetail>): CheckInTrainingEventDetail => ({
  eventId: "e-1",
  date: "2026-05-08", // a Friday
  sessionName: "Push Day",
  status: "scheduled",
  logStatus: "not_logged",
  trainingSessionId: "ts-1",
  sessionLogId: null,
  ...overrides,
});

describe("deriveSessionCompletionsForCheckIn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the STORED period window and maps to the preserved completion shape", async () => {
    getTrainingEventDetailsForPeriodMock.mockResolvedValue([
      detail({
        eventId: "e-1",
        date: "2026-05-11", // Monday
        sessionName: "Push Day",
        status: "completed",
        logStatus: "logged",
        completionQuality: "full",
        notes: "felt strong",
        sessionLogId: "log-1",
      }),
      detail({
        eventId: "e-2",
        date: "2026-05-13", // Wednesday
        sessionName: "Pull Day",
        status: "scheduled",
        logStatus: "not_logged",
      }),
    ]);

    const result = await deriveSessionCompletionsForCheckIn(baseCheckIn());

    // Window comes from the STORED period — NOT a today-relative recompute.
    expect(getTrainingEventDetailsForPeriodMock).toHaveBeenCalledWith(
      "client-1",
      "2026-05-08",
      "2026-05-14"
    );
    expect(calculateCheckInPeriodMock).not.toHaveBeenCalled();
    expect(getClientByIdMock).not.toHaveBeenCalled();

    // Exactly the preserved keys.
    expect(Object.keys(result[0]).sort()).toEqual(
      ["checkInId", "completed", "completionQuality", "dayOfWeek", "id", "notes", "sessionName", "trainingSessionId"].sort()
    );

    expect(result[0]).toMatchObject({
      id: "e-1",
      checkInId: "ci-1",
      trainingSessionId: "ts-1",
      sessionName: "Push Day",
      dayOfWeek: "monday",
      completed: true,
      completionQuality: "full",
      notes: "felt strong",
    });
    // Mixed period: completed event counts, unlogged event does not.
    expect(result.map((r) => r.completed)).toEqual([true, false]);
    expect(result[1].dayOfWeek).toBe("wednesday");
  });

  it("fully-unlogged period → all completed=false", async () => {
    getTrainingEventDetailsForPeriodMock.mockResolvedValue([
      detail({ eventId: "e-1", status: "scheduled", logStatus: "not_logged" }),
      detail({ eventId: "e-2", status: "missed", logStatus: "not_logged" }),
    ]);

    const result = await deriveSessionCompletionsForCheckIn(baseCheckIn());
    expect(result.every((r) => r.completed === false)).toBe(true);
  });

  it("fully-logged period → real statuses surface", async () => {
    getTrainingEventDetailsForPeriodMock.mockResolvedValue([
      detail({ eventId: "e-1", status: "completed", logStatus: "logged", completionQuality: "full", sessionLogId: "l1" }),
      detail({ eventId: "e-2", status: "completed", logStatus: "logged", completionQuality: "partial", sessionLogId: "l2" }),
    ]);

    const result = await deriveSessionCompletionsForCheckIn(baseCheckIn());
    expect(result.map((r) => r.completed)).toEqual([true, true]);
    expect(result.map((r) => r.completionQuality)).toEqual(["full", "partial"]);
  });

  it("tolerates a null trainingSessionId (alt-session swap / unlinked event)", async () => {
    getTrainingEventDetailsForPeriodMock.mockResolvedValue([
      detail({
        eventId: "e-1",
        trainingSessionId: null,
        performedSessionName: "Improvised Conditioning",
        status: "completed",
        logStatus: "logged",
        sessionLogId: "l1",
      }),
    ]);

    const result = await deriveSessionCompletionsForCheckIn(baseCheckIn());
    expect(result[0].trainingSessionId).toBeNull();
    expect(result[0].id).toBe("e-1"); // React key falls back to eventId
    // performedSessionName takes precedence on a swap.
    expect(result[0].sessionName).toBe("Improvised Conditioning");
  });

  it("legacy pre-038 rows (null stored period) fall back to the check-in's OWN createdAt date, never today", async () => {
    getClientByIdMock.mockResolvedValue({ expectedCheckInDay: "sunday" });
    calculateCheckInPeriodMock.mockReturnValue({
      periodStart: "2025-01-05",
      periodEnd: "2025-01-11",
    });
    getTrainingEventDetailsForPeriodMock.mockResolvedValue([]);

    const legacy = baseCheckIn({
      periodStart: undefined,
      periodEnd: undefined,
      createdAt: "2025-01-11T12:00:00Z",
    });
    await deriveSessionCompletionsForCheckIn(legacy);

    // The period is computed from the check-in's createdAt date — not a fresh
    // `new Date()` "today" window.
    const [dateArg] = calculateCheckInPeriodMock.mock.calls[0];
    expect((dateArg as Date).toISOString()).toBe("2025-01-11T12:00:00.000Z");
    expect(getTrainingEventDetailsForPeriodMock).toHaveBeenCalledWith(
      "client-1",
      "2025-01-05",
      "2025-01-11"
    );
  });
});
