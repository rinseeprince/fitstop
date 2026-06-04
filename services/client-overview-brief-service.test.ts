import { describe, it, expect, vi, beforeEach } from "vitest";

const getLastViewedAtMock = vi.fn();
const upsertLastViewedMock = vi.fn();
const evaluateSingleClientAlertsMock = vi.fn();

vi.mock("./coach-client-views-service", () => ({
  getLastViewedAt: (...a: unknown[]) => getLastViewedAtMock(...a),
  upsertLastViewed: (...a: unknown[]) => upsertLastViewedMock(...a),
}));
vi.mock("./attention-feed-service", () => ({
  evaluateSingleClientAlerts: (...a: unknown[]) => evaluateSingleClientAlertsMock(...a),
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

const COUNTS: Record<string, number> = {
  check_ins: 2,
  daily_logs: 5,
  body_metrics: 1,
  session_logs: 3,
  training_events: 4,
};
const UNREVIEWED = { id: "ci-1", created_at: "2026-06-03T10:00:00Z", status: "pending" };

beforeEach(() => {
  vi.clearAllMocks();
  evaluateSingleClientAlertsMock.mockResolvedValue([]);
  fromMock.mockImplementation((table: string) =>
    makeChain(COUNTS[table] ?? 0, table === "check_ins" ? UNREVIEWED : null)
  );
});

describe("getOverviewBrief", () => {
  it("repeat visit: returns deltas computed against the prior timestamp", async () => {
    getLastViewedAtMock.mockResolvedValue("2026-06-01T00:00:00Z");

    const brief = await getOverviewBrief("coach-1", "client-1");

    expect(brief.lastViewedAt).toBe("2026-06-01T00:00:00Z");
    expect(brief.sinceLastVisit).toEqual({
      newCheckIns: 2,
      newLogs: 5,
      newBodyMetrics: 1,
      newWorkoutsLogged: 3,
      eventStatusChanges: 4,
    });
    expect(brief.waitingOnYou.unreviewedCheckIn).toEqual({
      id: "ci-1",
      createdAt: "2026-06-03T10:00:00Z",
      status: "pending",
    });
  });

  it("reads last_viewed_at BEFORE upserting it (else deltas are always empty)", async () => {
    getLastViewedAtMock.mockResolvedValue("2026-06-01T00:00:00Z");

    await getOverviewBrief("coach-1", "client-1");

    expect(getLastViewedAtMock).toHaveBeenCalledTimes(1);
    expect(upsertLastViewedMock).toHaveBeenCalledTimes(1);
    expect(getLastViewedAtMock.mock.invocationCallOrder[0]).toBeLessThan(
      upsertLastViewedMock.mock.invocationCallOrder[0]
    );
  });

  it("first visit (null last_viewed_at): zero deltas, still records the view", async () => {
    getLastViewedAtMock.mockResolvedValue(null);

    const brief = await getOverviewBrief("coach-1", "client-1");

    expect(brief.lastViewedAt).toBeNull();
    expect(brief.sinceLastVisit).toEqual({
      newCheckIns: 0,
      newLogs: 0,
      newBodyMetrics: 0,
      newWorkoutsLogged: 0,
      eventStatusChanges: 0,
    });
    // No count queries fired on first visit (only the unreviewed check-in read).
    expect(fromMock).not.toHaveBeenCalledWith("daily_logs");
    expect(fromMock).not.toHaveBeenCalledWith("session_logs");
    expect(upsertLastViewedMock).toHaveBeenCalledWith("coach-1", "client-1");
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
});
