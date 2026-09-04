import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));
// The day rule's boundary. Its DERIVATION is proved in
// services/daily-log-permissions-service.test.ts; this file owns the POLICY the
// layout service applies with it.
vi.mock("./daily-log-permissions-service", () => ({
  getLogWindow: vi.fn(),
}));
vi.mock("./nutrition-event-service", () => ({
  cascadeNutritionAfterTrainingChange: vi.fn().mockResolvedValue(undefined),
}));

// Inline query-builder mock (mirrors services/training-event-service.test.ts).
function createMockQuery<T = unknown>(result: {
  data: T | null;
  error: { message: string } | null;
}) {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: vi.fn(),
  };
  Object.defineProperty(mockQuery, "then", {
    value: (resolve: (value: typeof result) => void) =>
      Promise.resolve(result).then(resolve),
  });
  return mockQuery;
}

import { supabaseAdmin } from "./supabase-admin";
import { getLogWindow } from "./daily-log-permissions-service";
import { cascadeNutritionAfterTrainingChange } from "./nutrition-event-service";
import { DateOccupiedError } from "./training-event-occupancy";
import {
  applyClientLayout,
  LayoutDriftError,
  LayoutNotFoundError,
  LayoutPolicyError,
  LAYOUT_DRIFT_MESSAGE,
} from "./training-event-layout-service";

const mockFrom = vi.mocked(supabaseAdmin.from);
const mockRpc = vi.mocked(supabaseAdmin.rpc);

// Monday-anchored week (check-in day null → Monday start): 2026-08-24 (Mon) … 2026-08-30 (Sun).
const WED = "2026-08-26"; // Wednesday
const THU = "2026-08-27";
const SAT = "2026-08-29";
const MON = "2026-08-24";
const NEXT_MON = "2026-08-31";

type EventRow = { id: string; date: string; status: string };

/**
 * Wires the reads the service issues, in order, per table:
 *   training_events #1 = the moving events (client-scoped, by id)
 *   clients          = check-in day
 *   training_events #2 = occupants on the target dates
 *
 * `session_logs` is wired but must stay untouched: the old backfill rule read it
 * to ask whether a past target already held a logged workout, and the day rule
 * replaced that question outright.
 */
function wire(opts: {
  events: EventRow[];
  occupants?: { id: string; date: string }[];
  checkInDue?: string | null;
  logsOpenFrom?: string | null;
}) {
  let eventsCalls = 0;
  const eventsQuery = createMockQuery<EventRow[]>({ data: opts.events, error: null });
  const occupantsQuery = createMockQuery({ data: opts.occupants ?? [], error: null });
  const clientQuery = createMockQuery({
    data: { next_check_in_due: opts.checkInDue ?? null },
    error: null,
  });
  const sessionLogsQuery = createMockQuery({ data: [], error: null });

  vi.mocked(getLogWindow).mockResolvedValue({
    logsOpenFrom: opts.logsOpenFrom ?? null,
    clientTimezone: "UTC",
  });

  mockFrom.mockImplementation((table: string) => {
    if (table === "training_events") {
      eventsCalls += 1;
      return (eventsCalls === 1 ? eventsQuery : occupantsQuery) as any;
    }
    if (table === "clients") return clientQuery as any;
    if (table === "session_logs") return sessionLogsQuery as any;
    return createMockQuery({ data: null, error: null }) as any;
  });

  return { eventsQuery, occupantsQuery, sessionLogsQuery };
}

describe("applyClientLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: null, error: null } as any);
  });

  it("applies a swap through the RPC in caller order and cascades once over every touched day", async () => {
    wire({
      events: [
        { id: "ev-wed", date: WED, status: "scheduled" },
        { id: "ev-thu", date: THU, status: "scheduled" },
      ],
      // The only occupants of the targets are the moving rows themselves.
      occupants: [
        { id: "ev-wed", date: WED },
        { id: "ev-thu", date: THU },
      ],
    });

    const result = await applyClientLayout("client-1", [
      { eventId: "ev-wed", fromDate: WED, toDate: THU },
      { eventId: "ev-thu", fromDate: THU, toDate: WED },
    ]);

    expect(mockRpc).toHaveBeenCalledWith("move_training_events_atomic", {
      p_client_id: "client-1",
      p_moves: [
        { event_id: "ev-wed", from_date: WED, to_date: THU },
        { event_id: "ev-thu", from_date: THU, to_date: WED },
      ],
    });
    expect(cascadeNutritionAfterTrainingChange).toHaveBeenCalledTimes(1);
    expect(cascadeNutritionAfterTrainingChange).toHaveBeenCalledWith(
      "client-1",
      { kind: "dates", dates: [WED, THU] },
      "cascade-nutrition-events-from-client-layout",
    );
    expect(result.moved).toHaveLength(2);
  });

  it("writes and cascades nothing when every move is a no-op", async () => {
    const result = await applyClientLayout("client-1", [
      { eventId: "ev-wed", fromDate: WED, toDate: WED },
    ]);

    expect(result).toEqual({ moved: [] });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(cascadeNutritionAfterTrainingChange).not.toHaveBeenCalled();
  });

  it("refuses to move a session that has been logged", async () => {
    wire({ events: [{ id: "ev-wed", date: WED, status: "completed" }] });

    await expect(
      applyClientLayout("client-1", [{ eventId: "ev-wed", fromDate: WED, toDate: SAT }]),
    ).rejects.toBeInstanceOf(LayoutPolicyError);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("reports drift when the session is no longer on the day the client saw", async () => {
    wire({ events: [{ id: "ev-thu", date: SAT, status: "scheduled" }] });

    await expect(
      applyClientLayout("client-1", [{ eventId: "ev-thu", fromDate: THU, toDate: WED }]),
    ).rejects.toMatchObject({ message: LAYOUT_DRIFT_MESSAGE });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("bounds a move to the training week the session currently sits in", async () => {
    wire({ events: [{ id: "ev-thu", date: THU, status: "scheduled" }] });

    await expect(
      applyClientLayout("client-1", [{ eventId: "ev-thu", fromDate: THU, toDate: NEXT_MON }]),
    ).rejects.toBeInstanceOf(LayoutPolicyError);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("refuses a move whose TARGET falls in a week a check-in has closed", async () => {
    wire({
      events: [{ id: "ev-thu", date: THU, status: "scheduled" }],
      logsOpenFrom: WED, // everything before Wednesday is reported and shut
    });
    await expect(
      applyClientLayout("client-1", [{ eventId: "ev-thu", fromDate: THU, toDate: MON }]),
    ).rejects.toBeInstanceOf(LayoutPolicyError);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("refuses a move whose SOURCE falls in a closed week — a reported week keeps its shape", async () => {
    wire({
      events: [{ id: "ev-mon", date: MON, status: "scheduled" }],
      logsOpenFrom: WED,
    });
    // Mutation guard: checking only `toDate` lets a session be lifted OUT of the
    // week a check-in described, which changes that week after the fact.
    await expect(
      applyClientLayout("client-1", [{ eventId: "ev-mon", fromDate: MON, toDate: SAT }]),
    ).rejects.toBeInstanceOf(LayoutPolicyError);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("allows a past target inside the open week, and reads no session_logs to decide it", async () => {
    const { sessionLogsQuery } = wire({
      events: [{ id: "ev-thu", date: THU, status: "scheduled" }],
      logsOpenFrom: MON, // the whole week is still open
    });
    await applyClientLayout("client-1", [{ eventId: "ev-thu", fromDate: THU, toDate: MON }]);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    // Mutation guard: restoring the old backfill read would call this.
    expect(sessionLogsQuery.select).not.toHaveBeenCalled();
  });

  it("a client with no boundary can move anywhere inside the week", async () => {
    wire({
      events: [{ id: "ev-thu", date: THU, status: "scheduled" }],
      logsOpenFrom: null,
    });
    await applyClientLayout("client-1", [{ eventId: "ev-thu", fromDate: THU, toDate: MON }]);
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it("refuses a target held by a session that is not moving — whatever its status", async () => {
    wire({
      events: [{ id: "ev-thu", date: THU, status: "scheduled" }],
      // Wednesday already has a COMPLETED session; the index would not care,
      // the policy does (the assertDateFree posture).
      occupants: [{ id: "ev-wed-done", date: WED }],
    });

    await expect(
      applyClientLayout("client-1", [{ eventId: "ev-thu", fromDate: THU, toDate: WED }]),
    ).rejects.toMatchObject({ message: "Wed, Aug 26 already has a session" });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("reads as not found when an event is foreign or missing", async () => {
    wire({ events: [] });

    await expect(
      applyClientLayout("client-1", [{ eventId: "ev-x", fromDate: THU, toDate: WED }]),
    ).rejects.toBeInstanceOf(LayoutNotFoundError);
  });

  it("translates the RPC's message contract into typed errors", async () => {
    const attempt = async (message: string) => {
      wire({
        events: [{ id: "ev-thu", date: THU, status: "scheduled" }],
        occupants: [{ id: "ev-thu", date: THU }],
      });
      mockRpc.mockResolvedValue({ data: null, error: { message } } as any);
      return applyClientLayout("client-1", [{ eventId: "ev-thu", fromDate: THU, toDate: SAT }]);
    };

    await expect(attempt("drift: event ev-thu is on 2026-08-29, not 2026-08-27")).rejects.toBeInstanceOf(
      LayoutDriftError,
    );
    await expect(attempt("occupied:2026-08-29")).rejects.toMatchObject({
      message: "Sat, Aug 29 already has a session",
    });
    await expect(attempt("occupied:2026-08-29")).rejects.toBeInstanceOf(DateOccupiedError);
    await expect(attempt("not_found: event ev-thu is not this client's")).rejects.toBeInstanceOf(
      LayoutNotFoundError,
    );
    await expect(attempt("not_scheduled: event ev-thu has left the scheduled state")).rejects.toBeInstanceOf(
      LayoutPolicyError,
    );
    // A failed RPC never cascades.
    expect(cascadeNutritionAfterTrainingChange).not.toHaveBeenCalled();
  });

  it("translates the index backstop (a raw 23505) into the same sentence as the pre-check", async () => {
    wire({
      events: [{ id: "ev-thu", date: THU, status: "scheduled" }],
      occupants: [{ id: "ev-thu", date: THU }],
    });
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "idx_training_events_one_scheduled_per_day"',
        details: "Key (client_id, date)=(client-1, 2026-08-29) already exists.",
      },
    } as any);

    await expect(
      applyClientLayout("client-1", [{ eventId: "ev-thu", fromDate: THU, toDate: SAT }]),
    ).rejects.toMatchObject({ message: "Sat, Aug 29 already has a session" });
  });
});
