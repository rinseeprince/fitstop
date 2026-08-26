import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase-admin before importing the service
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock("./training-mappers", () => ({
  mapExerciseRow: vi.fn((row: unknown) => row),
  mapSessionRow: vi.fn((row: Record<string, unknown>, exercises: unknown[]) => ({
    ...row,
    exercises,
  })),
}));

vi.mock("./training-session-service", () => ({
  bulkReplaceExercises: vi.fn(),
  updateSurplusForFutureEvents: vi.fn(),
}));

import { supabaseAdmin } from "./supabase-admin";
import {
  bulkReplaceExercises,
  updateSurplusForFutureEvents,
} from "./training-session-service";
import type { ExerciseInput } from "./training-session-service";
import { replaceSessionFull } from "./training-session-replace-service";
import { SessionLoggedError } from "./training-event-occupancy";

const mockFrom = vi.mocked(supabaseAdmin.from);
const mockBulkReplace = vi.mocked(bulkReplaceExercises);
const mockSurplusUpdate = vi.mocked(updateSurplusForFutureEvents);

type ChainResult = { data: unknown; error: { message: string } | null };

// One fake per from() call: every builder method returns the chain; maybeSingle/
// single resolve the result; awaiting the chain itself (rename .select("id"),
// exercises .order()) resolves it too.
function makeChain(result: ChainResult) {
  const fns = {
    select: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    gte: vi.fn(),
    order: vi.fn(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
  };
  const chain: Record<string, unknown> = { ...fns };
  for (const key of ["select", "update", "eq", "gte", "order"] as const) {
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

const SESSION_ID = "sess-1";
const PLAN_ID = "plan-1";
const CLIENT_ID = "client-1";
const COACH_ID = "coach-1";
const FROM_DATE = "2026-07-22";

const currentRow = {
  id: SESSION_ID,
  plan_id: PLAN_ID,
  name: "Push Day",
  focus: "Chest",
  notes: null,
  estimated_duration_minutes: 60,
  calorie_surplus_percentage: 10,
  is_rest: false,
  training_plans: { client_id: CLIENT_ID },
};

const updatedRow = {
  id: SESSION_ID,
  plan_id: PLAN_ID,
  name: "Push Day",
  focus: "Chest",
  notes: null,
  estimated_duration_minutes: 60,
  calorie_surplus_percentage: 10,
  is_rest: false,
};

const exercisesWithSpecs: ExerciseInput[] = [
  {
    name: "Bench Press",
    sets: 3,
    orderIndex: 0,
    exerciseId: null,
    setSpecs: [
      { set_number: 1, set_type: "warmup", reps_min: 10, reps_max: 12 },
      { set_number: 2, set_type: "working", reps_min: 5, reps_max: 8 },
    ],
    videoUrl: "https://example.com/bench.mp4",
  },
];

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Push Day",
    focus: "Chest",
    estimatedDurationMinutes: 60,
    calorieSurplusPercentage: 10,
    notes: null,
    exercises: exercisesWithSpecs,
    ...overrides,
  };
}

/**
 * The lock read `replaceSessionFull` now issues before touching anything
 * (`assertSessionUnlogged` -> `getSessionEventLinks`). It is the SECOND from()
 * call, right after the ownership read.
 */
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

const SCHEDULED_LINK = [{ date: "2026-07-27", status: "scheduled" }];

function baseParams(input = makeInput()) {
  return {
    sessionId: SESSION_ID,
    planId: PLAN_ID,
    clientId: CLIENT_ID,
    coachId: COACH_ID,
    fromDate: FROM_DATE,
    input,
  };
}

describe("replaceSessionFull", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a session that isn't owned by the client/plan before any write", async () => {
    const read = makeChain({ data: null, error: null });
    mockFrom.mockReturnValueOnce(read.chain);

    await expect(replaceSessionFull(baseParams())).rejects.toThrow("Session not found");
    expect(mockBulkReplace).not.toHaveBeenCalled();
    expect(read.fns.eq).toHaveBeenCalledWith("plan_id", PLAN_ID);
    expect(read.fns.eq).toHaveBeenCalledWith("training_plans.client_id", CLIENT_ID);
  });

  it("rejects rest rows", async () => {
    const read = makeChain({ data: { ...currentRow, is_rest: true }, error: null });
    mockFrom.mockReturnValueOnce(read.chain);

    await expect(replaceSessionFull(baseParams())).rejects.toThrow(
      "Rest days cannot be edited",
    );
    expect(mockBulkReplace).not.toHaveBeenCalled();
  });

  it("passes exercises to bulkReplaceExercises verbatim (setSpecs/videoUrl survive) and writes no events when nothing propagates", async () => {
    const read = makeChain({ data: currentRow, error: null });
    const links = linksChain(SCHEDULED_LINK);
    const update = makeChain({ data: updatedRow, error: null });
    const exercisesRead = makeChain({ data: [{ id: "ex-1" }], error: null });
    mockFrom
      .mockReturnValueOnce(read.chain)
      .mockReturnValueOnce(links.chain)
      .mockReturnValueOnce(update.chain)
      .mockReturnValueOnce(exercisesRead.chain);

    const result = await replaceSessionFull(baseParams());

    // Verbatim: the SAME array reference, specs and video untouched.
    expect(mockBulkReplace).toHaveBeenCalledWith(
      SESSION_ID,
      exercisesWithSpecs,
      COACH_ID,
      CLIENT_ID,
    );
    expect(mockBulkReplace.mock.calls[0][1]).toBe(exercisesWithSpecs);

    // No-change input: the ONLY training_events call is the lock read, and it
    // writes nothing. (It used to be "no training_events touch at all"; the
    // lock added one read, so the assertion narrows to the write.)
    expect(
      mockFrom.mock.calls.filter(([table]) => String(table) === "training_events"),
    ).toHaveLength(1);
    expect(links.fns.update).not.toHaveBeenCalled();
    expect(mockSurplusUpdate).not.toHaveBeenCalled();
    expect(result.surplusChanged).toBe(false);
    expect(result.identityChanged).toBe(false);

    expect(result.session).toEqual(
      expect.objectContaining({ id: SESSION_ID, exercises: [{ id: "ex-1" }] }),
    );

    expect(update.fns.update).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Push Day",
        focus: "Chest",
        estimated_duration_minutes: 60,
        calorie_surplus_percentage: 10,
        notes: null,
      }),
    );
  });

  it("writes a rename to the session's future scheduled events only (normally the edited day)", async () => {
    const read = makeChain({ data: currentRow, error: null });
    const update = makeChain({
      data: { ...updatedRow, name: "Push Day A", focus: "Chest + Tris" },
      error: null,
    });
    const rename = makeChain({ data: [{ id: "ev-1" }, { id: "ev-2" }], error: null });
    const exercisesRead = makeChain({ data: [], error: null });
    mockFrom
      .mockReturnValueOnce(read.chain)
      .mockReturnValueOnce(linksChain(SCHEDULED_LINK).chain)
      .mockReturnValueOnce(update.chain)
      .mockReturnValueOnce(rename.chain)
      .mockReturnValueOnce(exercisesRead.chain);

    const result = await replaceSessionFull(
      baseParams(makeInput({ name: "Push Day A", focus: "Chest + Tris" })),
    );

    expect(mockFrom).toHaveBeenCalledWith("training_events");
    expect(rename.fns.update).toHaveBeenCalledWith(
      expect.objectContaining({
        session_name: "Push Day A",
        session_focus: "Chest + Tris",
      }),
    );
    expect(rename.fns.eq).toHaveBeenCalledWith("training_session_id", SESSION_ID);
    expect(rename.fns.eq).toHaveBeenCalledWith("status", "scheduled");
    expect(rename.fns.gte).toHaveBeenCalledWith("date", FROM_DATE);

    expect(mockSurplusUpdate).not.toHaveBeenCalled();
    expect(result.identityChanged).toBe(true);
    expect(result.surplusChanged).toBe(false);
  });

  it("propagates a surplus change through updateSurplusForFutureEvents with the fromDate floor", async () => {
    const read = makeChain({ data: currentRow, error: null });
    const update = makeChain({
      data: { ...updatedRow, calorie_surplus_percentage: 20 },
      error: null,
    });
    const exercisesRead = makeChain({ data: [], error: null });
    const links = linksChain(SCHEDULED_LINK);
    mockFrom
      .mockReturnValueOnce(read.chain)
      .mockReturnValueOnce(links.chain)
      .mockReturnValueOnce(update.chain)
      .mockReturnValueOnce(exercisesRead.chain);
    mockSurplusUpdate.mockResolvedValue(["2026-04-23", "2026-04-25", "2026-04-28"]);

    const result = await replaceSessionFull(
      baseParams(makeInput({ calorieSurplusPercentage: 20 })),
    );

    expect(mockSurplusUpdate).toHaveBeenCalledWith(SESSION_ID, 20, FROM_DATE);
    // The surplus write goes through the mocked helper, so the only direct
    // training_events call is the lock read.
    expect(
      mockFrom.mock.calls.filter(([table]) => String(table) === "training_events"),
    ).toHaveLength(1);
    expect(links.fns.update).not.toHaveBeenCalled();
    expect(result.surplusChanged).toBe(true);
    expect(result.identityChanged).toBe(false);

    // The route cascades nutrition over exactly these days.
    expect(result.surplusAffectedDates).toEqual(["2026-04-23", "2026-04-25", "2026-04-28"]);
  });

  it("REFUSES a session the client has logged, before any write", async () => {
    // Two rounds of chains: the assertion is made twice (class, then message).
    for (let i = 0; i < 2; i++) {
      mockFrom
        .mockReturnValueOnce(makeChain({ data: currentRow, error: null }).chain)
        .mockReturnValueOnce(linksChain([{ date: "2026-08-14", status: "completed" }]).chain);
    }

    await expect(replaceSessionFull(baseParams())).rejects.toThrow(SessionLoggedError);
    await expect(replaceSessionFull(baseParams())).rejects.toThrow(/Fri, Aug 14/);

    // The whole point: bulkReplaceExercises soft-deletes the rows the client's
    // exercise_logs reference. It must not have run.
    expect(mockBulkReplace).not.toHaveBeenCalled();
    expect(mockSurplusUpdate).not.toHaveBeenCalled();
  });

  it("still replaces a session whose events are all scheduled", async () => {
    const read = makeChain({ data: currentRow, error: null });
    const update = makeChain({ data: updatedRow, error: null });
    const exercisesRead = makeChain({ data: [], error: null });
    mockFrom
      .mockReturnValueOnce(read.chain)
      .mockReturnValueOnce(
        linksChain([
          { date: "2026-07-27", status: "scheduled" },
          { date: "2026-08-03", status: "scheduled" },
        ]).chain,
      )
      .mockReturnValueOnce(update.chain)
      .mockReturnValueOnce(exercisesRead.chain);

    await expect(replaceSessionFull(baseParams())).resolves.toBeDefined();
    expect(mockBulkReplace).toHaveBeenCalledTimes(1);
  });

  it("treats clearing the surplus (value -> null) as a change", async () => {
    const read = makeChain({ data: currentRow, error: null });
    const update = makeChain({
      data: { ...updatedRow, calorie_surplus_percentage: null },
      error: null,
    });
    const exercisesRead = makeChain({ data: [], error: null });
    const links = linksChain(SCHEDULED_LINK);
    mockFrom
      .mockReturnValueOnce(read.chain)
      .mockReturnValueOnce(links.chain)
      .mockReturnValueOnce(update.chain)
      .mockReturnValueOnce(exercisesRead.chain);
    mockSurplusUpdate.mockResolvedValue(["2026-04-23"]);

    const result = await replaceSessionFull(
      baseParams(makeInput({ calorieSurplusPercentage: null })),
    );

    expect(mockSurplusUpdate).toHaveBeenCalledWith(SESSION_ID, null, FROM_DATE);
    expect(result.surplusChanged).toBe(true);
  });
});
