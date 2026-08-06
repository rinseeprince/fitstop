import { describe, it, expect, vi, beforeEach } from "vitest";

const getLastViewedAtMock = vi.fn();
const upsertLastViewedMock = vi.fn();
const evaluateSingleClientAlertsMock = vi.fn();
const getActivitySinceMock = vi.fn();
const getClientByIdMock = vi.fn();
const calculateNextExpectedCheckInMock = vi.fn();
const getDaysUntilOrPastDueMock = vi.fn();
const isClientOverdueMock = vi.fn();

vi.mock("./coach-client-views-service", () => ({
  getLastViewedAt: (...a: unknown[]) => getLastViewedAtMock(...a),
  upsertLastViewed: (...a: unknown[]) => upsertLastViewedMock(...a),
}));
vi.mock("./attention-feed-service", () => ({
  evaluateSingleClientAlerts: (...a: unknown[]) => evaluateSingleClientAlertsMock(...a),
}));
vi.mock("./client-activity-feed-service", () => ({
  getActivitySince: (...a: unknown[]) => getActivitySinceMock(...a),
}));
vi.mock("./client-service", () => ({
  getClientById: (...a: unknown[]) => getClientByIdMock(...a),
}));
vi.mock("./check-in-tracking-service", () => ({
  calculateNextExpectedCheckIn: (...a: unknown[]) => calculateNextExpectedCheckInMock(...a),
  getDaysUntilOrPastDue: (...a: unknown[]) => getDaysUntilOrPastDueMock(...a),
  isClientOverdue: (...a: unknown[]) => isClientOverdueMock(...a),
}));

const fromMock = vi.fn();
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: { from: (...a: unknown[]) => fromMock(...a) },
}));

import { getOverviewBrief } from "./client-overview-brief-service";

// A chainable builder that is awaitable (→ {count}) and supports .maybeSingle (→ {data}).
function makeChain(count: number, single: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gt", "neq", "in", "order", "limit"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: single, error: null }));
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ count, error: null });
  return chain;
}

const LATEST_CHECK_IN = {
  id: "ci-1",
  created_at: "2026-06-03T10:00:00Z",
  status: "pending",
  period_end: "2026-06-05",
};
const CLIENT = {
  id: "client-1",
  weightUnit: "kg",
  checkInFrequency: "weekly",
  expectedCheckInDay: "friday",
  timezone: "UTC",
};

beforeEach(() => {
  vi.clearAllMocks();
  evaluateSingleClientAlertsMock.mockResolvedValue([]);
  getActivitySinceMock.mockResolvedValue([]);
  getClientByIdMock.mockResolvedValue(CLIENT);
  calculateNextExpectedCheckInMock.mockReturnValue(new Date("2026-06-05T00:00:00"));
  getDaysUntilOrPastDueMock.mockReturnValue(-2);
  isClientOverdueMock.mockReturnValue(false);
  fromMock.mockImplementation((table: string) =>
    makeChain(0, table === "check_ins" ? LATEST_CHECK_IN : null)
  );
});

describe("getOverviewBrief", () => {
  it("repeat visit: returns the activity feed built against the prior timestamp", async () => {
    getLastViewedAtMock.mockResolvedValue("2026-06-01T00:00:00Z");
    const feed = [{ type: "check_in", at: "2026-06-02T09:00:00Z" }];
    getActivitySinceMock.mockResolvedValue(feed);

    const brief = await getOverviewBrief("coach-1", "client-1");

    expect(brief.lastViewedAt).toBe("2026-06-01T00:00:00Z");
    expect(brief.activity).toEqual(feed);
    expect(getActivitySinceMock).toHaveBeenCalledWith("client-1", "2026-06-01T00:00:00Z");
    expect(brief.waitingOnYou.unreviewedCheckIn).toEqual({
      id: "ci-1",
      submittedAt: "2026-06-03T10:00:00Z",
    });
  });

  it("does not read the retired since-last-visit delta tables", async () => {
    getLastViewedAtMock.mockResolvedValue("2026-06-01T00:00:00Z");

    await getOverviewBrief("coach-1", "client-1");

    for (const table of ["daily_logs", "body_metrics", "session_logs", "training_events"]) {
      expect(fromMock).not.toHaveBeenCalledWith(table);
    }
  });

  it("is read-only: never advances last_viewed_at (the seen route owns that)", async () => {
    getLastViewedAtMock.mockResolvedValue("2026-06-01T00:00:00Z");

    await getOverviewBrief("coach-1", "client-1");

    expect(getLastViewedAtMock).toHaveBeenCalledTimes(1);
    expect(upsertLastViewedMock).not.toHaveBeenCalled();
  });

  it("first visit (null last_viewed_at): empty feed, no anchored query", async () => {
    getLastViewedAtMock.mockResolvedValue(null);

    const brief = await getOverviewBrief("coach-1", "client-1");

    expect(brief.lastViewedAt).toBeNull();
    expect(brief.activity).toEqual([]);
    expect(getActivitySinceMock).not.toHaveBeenCalled();
  });

  it("surfaces attention alerts from the single-client evaluator", async () => {
    getLastViewedAtMock.mockResolvedValue("2026-06-01T00:00:00Z");
    evaluateSingleClientAlertsMock.mockResolvedValue([
      { type: "no_log_gap", severity: "high", message: "No logs in 5 days", affectedDays: [], metricData: [] },
    ]);

    const brief = await getOverviewBrief("coach-1", "client-1");

    expect(brief.waitingOnYou.attentionAlerts).toHaveLength(1);
    expect(brief.waitingOnYou.attentionAlerts[0].message).toBe("No logs in 5 days");
  });

  it("builds checkInTiming through the tracking service with the last check-in attached", async () => {
    getLastViewedAtMock.mockResolvedValue("2026-06-01T00:00:00Z");

    const brief = await getOverviewBrief("coach-1", "client-1");

    expect(brief.checkInTiming).toEqual({
      frequency: "weekly",
      expectedCheckInDay: "friday",
      lastSubmittedAt: "2026-06-03T10:00:00Z",
      nextDueDate: "2026-06-05",
      daysUntilDue: -2,
      isOverdue: false,
    });
    // The tracking service must see the latest check-in's period_end so its
    // "already checked in this period" branch can fire.
    expect(calculateNextExpectedCheckInMock).toHaveBeenCalledWith(
      expect.objectContaining({ lastCheckInPeriodEnd: "2026-06-05" })
    );
  });

  it("returns null checkInTiming when the client has no schedule", async () => {
    getLastViewedAtMock.mockResolvedValue("2026-06-01T00:00:00Z");
    getClientByIdMock.mockResolvedValue({ ...CLIENT, checkInFrequency: "none" });

    const brief = await getOverviewBrief("coach-1", "client-1");

    expect(brief.checkInTiming).toBeNull();
    expect(calculateNextExpectedCheckInMock).not.toHaveBeenCalled();
  });
});
