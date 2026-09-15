import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./event-deletion-floor", () => ({
  // The one shared answer to "from which day may events be removed?" — its own
  // rules are proved in services/event-deletion-floor.test.ts.
  resolveEventDeletionFloor: vi.fn(),
}));
vi.mock("./training-event-service", () => ({
  cancelFutureEventsForPlans: vi.fn().mockResolvedValue(undefined),
}));

import { supabaseAdmin } from "./supabase-admin";
import { resolveEventDeletionFloor } from "./event-deletion-floor";
import { cancelFutureEventsForPlans } from "./training-event-service";
import {
  clearTrainingPlansForClient,
  endTrainingPlansAt,
  retireTrainingPlans,
} from "./training-plan-clear-service";

type ChainResult = { data?: unknown; error?: { message: string } | null };

/**
 * Each supabaseAdmin.from() call gets its own self-returning, THENABLE chain
 * bound to the next queued result, in from()-call order. Returned for
 * per-statement assertions.
 */
function mockFromSequence(results: ChainResult[]) {
  const chains: Array<Record<string, ReturnType<typeof vi.fn>>> = [];
  vi.mocked(supabaseAdmin.from).mockImplementation((() => {
    const result = results[chains.length] ?? { data: null, error: null };
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "is", "gte", "lte", "in", "update", "delete", "order"]) {
      chain[m] = vi.fn().mockReturnValue(chain);
    }
    chain.then = (resolve: (v: ChainResult) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject);
    chains.push(chain as Record<string, ReturnType<typeof vi.fn>>);
    return chain;
  }) as never);
  return chains;
}

const CLIENT = "client-41";
const TODAY = "2026-07-02";
const YESTERDAY = "2026-07-01";

const running = { id: "p-run", effective_from: "2026-06-01", effective_until: "2026-08-31" };
const queued = { id: "p-queued", effective_from: "2026-07-20", effective_until: "2026-09-13" };
const startedToday = { id: "p-today", effective_from: TODAY, effective_until: "2026-08-26" };
const finished = { id: "p-done", effective_from: "2026-03-01", effective_until: "2026-05-31" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveEventDeletionFloor).mockResolvedValue(TODAY);
  vi.mocked(cancelFutureEventsForPlans).mockResolvedValue([]);
});

describe("retireTrainingPlans — a delete is a save of nothing from today", () => {
  it("ends a running program at YESTERDAY, archives a queued one, and leaves a finished one alone", async () => {
    const chains = mockFromSequence([{ error: null }, { error: null }]);

    const result = await retireTrainingPlans([running, queued, finished], TODAY);

    expect(result).toEqual({ ended: ["p-run"], archived: ["p-queued"] });
    // Statement 1 — the cap: the row's window closes on yesterday, its past
    // days stay its own, on the calendar and on every block it ran in.
    expect(chains[0].update).toHaveBeenCalledWith(
      expect.objectContaining({ effective_until: YESTERDAY })
    );
    expect(chains[0].in).toHaveBeenCalledWith("id", ["p-run"]);
    // Statement 2 — the archive: a program that never ran a day of its own.
    expect(chains[1].update).toHaveBeenCalledWith(expect.objectContaining({ status: "archived" }));
    expect(chains[1].in).toHaveBeenCalledWith("id", ["p-queued"]);
    // The finished program appears in neither statement.
    expect(chains).toHaveLength(2);
  });

  it("a program that started TODAY has no yesterday to end on and is archived", async () => {
    const chains = mockFromSequence([{ error: null }]);

    expect(await retireTrainingPlans([startedToday], TODAY)).toEqual({
      ended: [],
      archived: ["p-today"],
    });
    expect(chains[0].update).toHaveBeenCalledWith(expect.objectContaining({ status: "archived" }));
  });

  it("issues nothing for an empty or all-finished list", async () => {
    expect(await retireTrainingPlans([finished], TODAY)).toEqual({ ended: [], archived: [] });
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("surfaces a failed cap rather than reporting the program ended", async () => {
    mockFromSequence([{ error: { message: "boom" } }]);
    await expect(retireTrainingPlans([running], TODAY)).rejects.toThrow(
      "Failed to end the running program: boom"
    );
  });
});

describe("endTrainingPlansAt — each program ends on its own last day (a block trim)", () => {
  it("caps each program on its day, one statement per day, archives one left no day, and never lengthens a window", async () => {
    const chains = mockFromSequence([{ error: null }, { error: null }, { error: null }]);

    const result = await endTrainingPlansAt([
      { ...running, lastDay: "2026-07-19" },
      { ...queued, lastDay: "2026-08-02" },
      { id: "p-inside", effective_from: "2026-07-20", effective_until: "2026-08-02", lastDay: "2026-08-02" },
      { id: "p-gone", effective_from: "2026-08-10", effective_until: "2026-08-23", lastDay: "2026-08-09" },
    ]);

    expect(result).toEqual({ ended: ["p-run", "p-queued"], archived: ["p-gone"] });
    expect(chains[0].update).toHaveBeenCalledWith(expect.objectContaining({ effective_until: "2026-07-19" }));
    expect(chains[0].in).toHaveBeenCalledWith("id", ["p-run"]);
    expect(chains[1].update).toHaveBeenCalledWith(expect.objectContaining({ effective_until: "2026-08-02" }));
    expect(chains[1].in).toHaveBeenCalledWith("id", ["p-queued"]);
    expect(chains[2].update).toHaveBeenCalledWith(expect.objectContaining({ status: "archived" }));
    expect(chains[2].in).toHaveBeenCalledWith("id", ["p-gone"]);
    // The program already ending on its last day is in no statement.
    expect(chains).toHaveLength(3);
  });
});

describe("clearTrainingPlansForClient — the calendar's own delete (no window)", () => {
  it("reads only programs with a day still ahead, retires them and removes their days from the floor", async () => {
    const chains = mockFromSequence([
      { data: [running, queued], error: null },
      { error: null },
      { error: null },
    ]);

    const result = await clearTrainingPlansForClient(CLIENT, TODAY);

    expect(result).toEqual({ plansCleared: 2 });
    // The read: live programs reaching today or later — a finished program is
    // untouched history and is never even selected.
    expect(chains[0].is).toHaveBeenCalledWith("deleted_at", null);
    expect(chains[0].neq).toHaveBeenCalledWith("status", "archived");
    expect(chains[0].gte).toHaveBeenCalledWith("effective_until", TODAY);
    // Then the two retire statements, in order: cap, archive.
    expect(chains[1].update).toHaveBeenCalledWith(expect.objectContaining({ effective_until: YESTERDAY }));
    expect(chains[2].update).toHaveBeenCalledWith(expect.objectContaining({ status: "archived" }));
    // The days: every retired program's forward ray from the floor, one call.
    expect(cancelFutureEventsForPlans).toHaveBeenCalledWith(["p-run", "p-queued"], TODAY);
    // Nothing else: a nutrition day is computed from the session on it, so the
    // removed sessions re-price their days with no statement here.
    expect(chains).toHaveLength(3);
  });

  it("a client who logged today keeps today's session: the day removal starts tomorrow, the program still ends yesterday", async () => {
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-07-03");
    const chains = mockFromSequence([{ data: [running], error: null }, { error: null }]);

    await clearTrainingPlansForClient(CLIENT, TODAY);

    expect(chains[1].update).toHaveBeenCalledWith(expect.objectContaining({ effective_until: YESTERDAY }));
    expect(cancelFutureEventsForPlans).toHaveBeenCalledWith(["p-run"], "2026-07-03");
  });

  it("nothing running or queued: one read, no retire statements, zero", async () => {
    mockFromSequence([{ data: [], error: null }]);

    expect(await clearTrainingPlansForClient(CLIENT, TODAY)).toEqual({ plansCleared: 0 });
    expect(vi.mocked(supabaseAdmin.from).mock.calls).toHaveLength(1);
    expect(cancelFutureEventsForPlans).toHaveBeenCalledWith([], TODAY);
  });
});

describe("clearTrainingPlansForClient — the block delete's 'and its plans' (a window)", () => {
  it("takes only the programs PLACED INSIDE the block that still have a day ahead", async () => {
    const chains = mockFromSequence([{ data: [running], error: null }, { error: null }]);

    await clearTrainingPlansForClient(CLIENT, TODAY, { from: "2026-06-01", to: "2026-06-28" });

    expect(chains[0].gte).toHaveBeenCalledWith("effective_until", TODAY);
    expect(chains[0].gte).toHaveBeenCalledWith("effective_from", "2026-06-01");
    expect(chains[0].lte).toHaveBeenCalledWith("effective_from", "2026-06-28");
    expect(chains[1].update).toHaveBeenCalledWith(expect.objectContaining({ effective_until: YESTERDAY }));
  });
});
