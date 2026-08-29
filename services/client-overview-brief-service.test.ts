import { describe, it, expect, vi, beforeEach } from "vitest";

const getLastViewedAtMock = vi.fn();
const upsertLastViewedMock = vi.fn();
const evaluateSingleClientAlertsMock = vi.fn();
const getActivitySinceMock = vi.fn();
const getClientByIdMock = vi.fn();
const resolveCheckInDueMock = vi.fn();
const getDaysUntilOrPastDueMock = vi.fn();
const isClientOverdueMock = vi.fn();
const listBlocksMock = vi.fn();
const getClientTodayStringMock = vi.fn();

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
  resolveCheckInDue: (...a: unknown[]) => resolveCheckInDueMock(...a),
  getDaysUntilOrPastDue: (...a: unknown[]) => getDaysUntilOrPastDueMock(...a),
  isClientOverdue: (...a: unknown[]) => isClientOverdueMock(...a),
}));
vi.mock("./client-blocks-service", () => ({
  listBlocks: (...a: unknown[]) => listBlocksMock(...a),
}));
vi.mock("./today-service", () => ({
  getClientTodayString: (...a: unknown[]) => getClientTodayStringMock(...a),
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
  nextCheckInDue: "2026-06-05",
  timezone: "UTC",
};

beforeEach(() => {
  vi.clearAllMocks();
  evaluateSingleClientAlertsMock.mockResolvedValue([]);
  getActivitySinceMock.mockResolvedValue([]);
  getClientByIdMock.mockResolvedValue(CLIENT);
  resolveCheckInDueMock.mockReturnValue(new Date("2026-06-05T00:00:00"));
  getDaysUntilOrPastDueMock.mockReturnValue(-2);
  isClientOverdueMock.mockReturnValue(false);
  listBlocksMock.mockResolvedValue([]);
  getClientTodayStringMock.mockResolvedValue("2026-06-04");
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

  it("reads the awaiting-review row with the shared unreviewed predicate", async () => {
    getLastViewedAtMock.mockResolvedValue("2026-06-01T00:00:00Z");
    // The service reads check_ins more than once; keep every chain, not the last.
    const checkInsChains: ReturnType<typeof makeChain>[] = [];
    fromMock.mockImplementation((table: string) => {
      const chain = makeChain(0, table === "check_ins" ? LATEST_CHECK_IN : null);
      if (table === "check_ins") checkInsChains.push(chain);
      return chain;
    });

    await getOverviewBrief("coach-1", "client-1");

    const inFilters = checkInsChains.flatMap(
      (chain) => (chain.in as ReturnType<typeof vi.fn>).mock.calls
    );
    // `pending` included: a check-in whose AI pass failed still waits on the coach.
    expect(inFilters).toContainEqual(["status", ["pending", "ai_processed"]]);
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

  it("builds checkInTiming from the stored due date, with lastSubmittedAt from the check-in read", async () => {
    getLastViewedAtMock.mockResolvedValue("2026-06-01T00:00:00Z");

    const brief = await getOverviewBrief("coach-1", "client-1");

    expect(brief.checkInTiming).toEqual({
      frequency: "weekly",
      lastSubmittedAt: "2026-06-03T10:00:00Z",
      nextDueDate: "2026-06-05",
      daysUntilDue: -2,
      isOverdue: false,
    });
    // The due date is READ, not reconstructed from the last check-in — so the
    // resolver is handed the client itself, with nothing bolted on.
    expect(resolveCheckInDueMock).toHaveBeenCalledWith(
      expect.objectContaining({ nextCheckInDue: "2026-06-05" })
    );
  });

  it("returns null checkInTiming when the client has no schedule", async () => {
    getLastViewedAtMock.mockResolvedValue("2026-06-01T00:00:00Z");
    getClientByIdMock.mockResolvedValue({ ...CLIENT, checkInFrequency: "none" });

    const brief = await getOverviewBrief("coach-1", "client-1");

    expect(brief.checkInTiming).toBeNull();
    expect(resolveCheckInDueMock).not.toHaveBeenCalled();
  });

  it("surfaces the block-ending row when the current block is in its final 7 days", async () => {
    getLastViewedAtMock.mockResolvedValue("2026-06-01T00:00:00Z");
    getClientTodayStringMock.mockResolvedValue("2026-06-04");
    listBlocksMock.mockResolvedValue([
      { id: "b1", name: "Build", startsOn: "2026-05-11", endsOn: "2026-06-07" },
      { id: "b2", name: "Cut", startsOn: "2026-06-08", endsOn: "2026-07-05" },
    ]);

    const brief = await getOverviewBrief("coach-1", "client-1");

    expect(brief.waitingOnYou.blockEnding).toEqual({
      blockName: "Build",
      endsOn: "2026-06-07",
      nextBlockName: "Cut",
    });
    // Anchored on the CLIENT's calendar day — the blocks routes' anchor.
    expect(getClientTodayStringMock).toHaveBeenCalledWith("client-1");
  });

  it("no block-ending row mid-block", async () => {
    getLastViewedAtMock.mockResolvedValue("2026-06-01T00:00:00Z");
    getClientTodayStringMock.mockResolvedValue("2026-05-20");
    listBlocksMock.mockResolvedValue([
      { id: "b1", name: "Build", startsOn: "2026-05-11", endsOn: "2026-06-07" },
    ]);

    const brief = await getOverviewBrief("coach-1", "client-1");

    expect(brief.waitingOnYou.blockEnding).toBeNull();
  });

  it("a blocks read failure degrades the row to null, never the brief", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    getLastViewedAtMock.mockResolvedValue("2026-06-01T00:00:00Z");
    listBlocksMock.mockRejectedValue(new Error("blocks boom"));

    const brief = await getOverviewBrief("coach-1", "client-1");

    expect(brief.waitingOnYou.blockEnding).toBeNull();
    expect(brief.waitingOnYou.unreviewedCheckIn).not.toBeUndefined();
    consoleSpy.mockRestore();
  });
});
