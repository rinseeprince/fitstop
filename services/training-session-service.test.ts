import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase-admin before importing the service
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock("./training-mappers", () => ({
  mapExerciseRow: vi.fn(),
  mapSessionRow: vi.fn(),
}));

vi.mock("./exercise-catalog-service", () => ({
  resolveExercises: vi.fn(),
}));

import { supabaseAdmin } from "./supabase-admin";
import {
  cloneSessionForEvent,
  updateSurplusForFutureEvents,
} from "./training-session-service";
import { SessionLoggedError } from "./training-event-occupancy";

const mockFrom = vi.mocked(supabaseAdmin.from);

describe("updateSurplusForFutureEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates only scheduled events for the given session from fromDate onward", async () => {
    // Chain mock: from().update().eq().gte().eq().select() returns data
    const selectFn = vi.fn().mockResolvedValue({
      data: [{ date: "2026-04-23" }, { date: "2026-04-25" }],
      error: null,
    });
    const innerEq = vi.fn().mockReturnValue({ select: selectFn });
    const gte = vi.fn().mockReturnValue({ eq: innerEq });
    const outerEq = vi.fn().mockReturnValue({ gte });
    const update = vi.fn().mockReturnValue({ eq: outerEq });

    mockFrom.mockReturnValue({ update } as unknown as ReturnType<typeof mockFrom>);

    const dates = await updateSurplusForFutureEvents("session-1", 20, "2026-04-22");

    // The DATES of the touched events, so the caller can cascade over exactly
    // them; `.length` is the old count.
    expect(dates).toEqual(["2026-04-23", "2026-04-25"]);
    expect(selectFn).toHaveBeenCalledWith("date");
    expect(mockFrom).toHaveBeenCalledWith("training_events");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        calorie_surplus_percentage: 20,
        is_modified: true,
      }),
    );
    expect(outerEq).toHaveBeenCalledWith("training_session_id", "session-1");
    expect(gte).toHaveBeenCalledWith("date", "2026-04-22");
    expect(innerEq).toHaveBeenCalledWith("status", "scheduled");
  });

  it("accepts null surplus (clears the value)", async () => {
    const selectFn = vi.fn().mockResolvedValue({ data: [], error: null });
    const innerEq = vi.fn().mockReturnValue({ select: selectFn });
    const gte = vi.fn().mockReturnValue({ eq: innerEq });
    const outerEq = vi.fn().mockReturnValue({ gte });
    const update = vi.fn().mockReturnValue({ eq: outerEq });

    mockFrom.mockReturnValue({ update } as unknown as ReturnType<typeof mockFrom>);

    const dates = await updateSurplusForFutureEvents("session-1", null, "2026-04-22");

    expect(dates).toEqual([]);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ calorie_surplus_percentage: null }),
    );
  });

  it("throws on db error with a descriptive message", async () => {
    const selectFn = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "permission denied" },
    });
    const innerEq = vi.fn().mockReturnValue({ select: selectFn });
    const gte = vi.fn().mockReturnValue({ eq: innerEq });
    const outerEq = vi.fn().mockReturnValue({ gte });
    const update = vi.fn().mockReturnValue({ eq: outerEq });

    mockFrom.mockReturnValue({ update } as unknown as ReturnType<typeof mockFrom>);

    await expect(
      updateSurplusForFutureEvents("session-1", 15, "2026-04-22"),
    ).rejects.toThrow(/permission denied/);
  });
});

// ---------------------------------------------------------------------------
// cloneSessionForEvent
// ---------------------------------------------------------------------------

type ChainResult = { data: unknown; error: { message: string } | null };

/** One fake per from() call: builders return the chain, terminals resolve. */
function makeChain(result: ChainResult) {
  const fns = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
  };
  const chain: Record<string, unknown> = { ...fns };
  for (const key of ["select", "insert", "update", "eq", "order"] as const) {
    fns[key].mockReturnValue(chain);
  }
  fns.maybeSingle.mockResolvedValue(result);
  fns.single.mockResolvedValue(result);
  chain.then = (
    onFulfilled: (value: ChainResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return { chain: chain as unknown as ReturnType<typeof mockFrom>, fns };
}

const CLONE_SESSION_ID = "sess-1";
const CLONE_EVENT_ID = "ev-1";
const CLONE_CLIENT_ID = "client-1";
const CLONE_COACH_ID = "coach-1";

const sourceSessionRow = {
  id: CLONE_SESSION_ID,
  plan_id: "plan-1",
  name: "Push Day",
  order_index: 0,
  week_index: 0,
  is_rest: false,
  focus: "Chest",
  notes: null,
  estimated_duration_minutes: 60,
  estimated_calories: null,
  calories_calculated_at: null,
  calorie_surplus_percentage: 10,
  training_plans: { client_id: CLONE_CLIENT_ID },
};

function linksChain(events: Array<{ date: string; status: string }>) {
  return makeChain({
    data: events.map((e, i) => ({
      id: `ev-${i}`,
      date: e.date,
      status: e.status,
      is_modified: false,
    })),
    error: null,
  });
}

/** from() order: target event -> source session -> LOCK READ -> ... */
function queueCloneReads(events: Array<{ date: string; status: string }>) {
  mockFrom
    .mockReturnValueOnce(makeChain({ data: { id: CLONE_EVENT_ID }, error: null }).chain)
    .mockReturnValueOnce(makeChain({ data: sourceSessionRow, error: null }).chain)
    .mockReturnValueOnce(linksChain(events).chain);
}

function clone() {
  return cloneSessionForEvent(
    CLONE_SESSION_ID,
    CLONE_EVENT_ID,
    CLONE_CLIENT_ID,
    CLONE_COACH_ID,
    [],
  );
}

describe("cloneSessionForEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("REFUSES a session the client has logged, before inserting anything", async () => {
    // Two rounds: the assertion is made twice (class, then message).
    for (let i = 0; i < 2; i++) {
      queueCloneReads([{ date: "2026-08-14", status: "completed" }]);
    }

    await expect(clone()).rejects.toThrow(SessionLoggedError);
    await expect(clone()).rejects.toThrow(/Fri, Aug 14/);

    // Nothing was written: no cloned session row, no cloned exercises, and the
    // event still points at the original, so the client's exercise_logs keep
    // resolving. Two rounds x one source-session READ each and nothing more.
    expect(mockFrom.mock.calls.filter(([t]) => String(t) === "training_sessions")).toHaveLength(2);
    expect(mockFrom).not.toHaveBeenCalledWith("training_exercises");
  });

  it("still clones a session whose events are all scheduled", async () => {
    queueCloneReads([{ date: "2026-08-21", status: "scheduled" }]);
    const insert = makeChain({ data: { id: "clone-1" }, error: null });
    const eventUpdate = makeChain({ data: null, error: null });
    mockFrom.mockReturnValueOnce(insert.chain).mockReturnValueOnce(eventUpdate.chain);

    await expect(clone()).resolves.toBe("clone-1");

    expect(insert.fns.insert).toHaveBeenCalledWith(
      expect.objectContaining({ plan_id: "plan-1", name: "Push Day" }),
    );
    expect(eventUpdate.fns.update).toHaveBeenCalledWith(
      expect.objectContaining({ training_session_id: "clone-1", is_modified: true }),
    );
  });

  it("reports a foreign session as not found rather than as locked", async () => {
    // Ownership beats the lock, so a guessed sessionId gets no existence oracle.
    mockFrom
      .mockReturnValueOnce(makeChain({ data: { id: CLONE_EVENT_ID }, error: null }).chain)
      .mockReturnValueOnce(makeChain({ data: null, error: null }).chain);

    await expect(clone()).rejects.toThrow("Session not found");
    // Only the step-0 target-event read; the lock read never ran.
    expect(mockFrom.mock.calls.filter(([t]) => String(t) === "training_events")).toHaveLength(1);
  });
});
