import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./event-deletion-floor", () => ({ resolveEventDeletionFloor: vi.fn() }));

import { supabaseAdmin } from "./supabase-admin";
import { resolveEventDeletionFloor } from "./event-deletion-floor";
import {
  clearEventsOutsideBlock,
  clearScheduledEvents,
} from "./block-event-sync-service";

const mockFrom = vi.mocked(supabaseAdmin.from);
const TODAY = "2026-09-04";

function query<T>(result: { data: T | null; error: unknown; }) {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  Object.assign(q, {
    select: vi.fn(chain), insert: vi.fn(chain), update: vi.fn(chain),
    delete: vi.fn(chain), eq: vi.fn(chain), neq: vi.fn(chain), is: vi.fn(chain),
    in: vi.fn(chain), gt: vi.fn(chain), gte: vi.fn(chain), lte: vi.fn(chain),
    or: vi.fn(chain), order: vi.fn(chain), limit: vi.fn(chain),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: (resolve: (v: typeof result) => void) => Promise.resolve(result).then(resolve),
  });
  return q as Record<string, ReturnType<typeof vi.fn>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: the client has not touched today, so removals may start on it.
  vi.mocked(resolveEventDeletionFloor).mockResolvedValue(TODAY);
});

describe("clearScheduledEvents", () => {
  it("removes the scheduled sessions and deactivates the slots behind them; nutrition has no day to remove", async () => {
    // The slots matter as much as the events: the plan's active rows are its
    // blueprint, so rows left active past its end would describe days the
    // window no longer has.
    const training = query({ data: [{ training_session_id: "s1" }], error: null });
    const slots = query({ data: null, error: null });
    let call = 0;
    mockFrom.mockImplementation((() => {
      call += 1;
      return call === 1 ? training : slots;
    }) as never);

    const result = await clearScheduledEvents({
      clientId: "c1", clientToday: TODAY, from: "2026-10-01", to: "2026-10-26",
    });

    expect(training.eq).toHaveBeenCalledWith("status", "scheduled");
    expect(training.gte).toHaveBeenCalledWith("date", "2026-10-01");
    expect(training.lte).toHaveBeenCalledWith("date", "2026-10-26");
    expect(slots.update).toHaveBeenCalledWith(
      expect.objectContaining({ is_active: false })
    );
    expect(slots.in).toHaveBeenCalledWith("id", ["s1"]);
    expect(result).toEqual({ trainingCleared: 1 });
    // A nutrition day is computed from the version covering it; the versions
    // are pulled back by the caller, and no day table is touched here.
    expect(mockFrom.mock.calls.map((call) => call[0])).toEqual([
      "training_events",
      "training_sessions",
    ]);
  });

  it("floors at the SHARED deletion floor so the past is never cleared", async () => {
    const training = query({ data: [], error: null });
    mockFrom.mockImplementation((() => training) as never);

    await clearScheduledEvents({
      clientId: "c1", clientToday: TODAY, from: "2026-07-13", to: "2026-10-26",
    });

    expect(resolveEventDeletionFloor).toHaveBeenCalledWith("c1", TODAY);
    expect(training.gte).toHaveBeenCalledWith("date", TODAY);
  });

  it("spares today entirely when the floor says the client has touched it", async () => {
    // Never its own arithmetic: the floor is the one answer, and a clear that
    // reached today after they logged would empty a day they are living in.
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-09-05");
    const training = query({ data: [], error: null });
    mockFrom.mockImplementation((() => training) as never);

    await clearScheduledEvents({
      clientId: "c1", clientToday: TODAY, from: "2026-08-17", to: "2026-11-09",
    });

    expect(training.gte).toHaveBeenCalledWith("date", "2026-09-05");
  });

  it("does nothing when the range has already gone by", async () => {
    const result = await clearScheduledEvents({
      clientId: "c1", clientToday: TODAY, from: "2026-06-01", to: "2026-08-24",
    });

    expect(result).toEqual({ trainingCleared: 0 });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("clearEventsOutsideBlock", () => {
  /** from() per table, in call order: the next-block probe, the last-session
   *  probe when there is no next block, the session removal, then on the
   *  nutrition track the read of the versions being cut and the delete of
   *  their hand edits, then the version cap and the version retirement on
   *  each track. */
  function wireTables(byTable: Record<string, ReturnType<typeof query>[]>) {
    mockFrom.mockImplementation(((table: string) => {
      const next = byTable[table]?.shift();
      if (!next) throw new Error(`unexpected from(${table})`);
      return next;
    }) as never);
  }

  it("pulls a version reaching past the new end back to it, retires one starting in the cleared stretch, and removes the hand edits on the days both lose (migration 166)", async () => {
    const cutQuery = query({
      data: [
        { id: "v-cap", effective_from: "2026-09-01", effective_until: "2026-12-13" },
        { id: "v-queued", effective_from: "2026-10-12", effective_until: "2026-10-31" },
      ],
      error: null,
    });
    const editsQuery = query({ data: null, error: null });
    const capQuery = query({ data: null, error: null });
    const retireQuery = query({ data: null, error: null });
    const trainingCapQuery = query({ data: null, error: null });
    const trainingRetireQuery = query({ data: null, error: null });
    wireTables({
      client_phases: [query({ data: { starts_on: "2026-11-01" }, error: null })],
      training_events: [query({ data: [], error: null })],
      nutrition_plans: [cutQuery, capQuery, retireQuery],
      nutrition_day_edits: [editsQuery],
      training_plans: [trainingCapQuery, trainingRetireQuery],
    });

    await clearEventsOutsideBlock({
      clientId: "c1", clientToday: TODAY, blockEndsOn: "2026-10-05",
    });

    // The versions being cut are read before they move — the same two
    // predicates the cap and the retirement apply, in one select.
    expect(cutQuery.eq).toHaveBeenCalledWith("status", "active");
    expect(cutQuery.gt).toHaveBeenCalledWith("effective_until", "2026-10-05");
    expect(cutQuery.lte).toHaveBeenCalledWith("effective_from", "2026-10-31");
    // Their hand edits on the days they lose go FIRST: the pulled-back version's
    // days past the new end, the retired version's whole window — one range
    // each, never the day before the new end, and never a day a surviving
    // version covers.
    expect(editsQuery.delete).toHaveBeenCalledWith({ count: "exact" });
    expect(editsQuery.eq).toHaveBeenCalledWith("client_id", "c1");
    expect(editsQuery.or).toHaveBeenCalledWith(
      "and(date.gte.2026-10-06,date.lte.2026-12-13),and(date.gte.2026-10-12,date.lte.2026-10-31)"
    );
    const tables = mockFrom.mock.calls.map((call) => String(call[0]));
    expect(tables.indexOf("nutrition_day_edits")).toBeLessThan(tables.lastIndexOf("nutrition_plans"));
    // Its days are computed from its window, so pulling the end back IS
    // removing the days past it.
    expect(capQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({ effective_until: "2026-10-05" })
    );
    expect(capQuery.eq).toHaveBeenCalledWith("status", "active");
    expect(capQuery.lte).toHaveBeenCalledWith("effective_from", "2026-10-05");
    expect(capQuery.gt).toHaveBeenCalledWith("effective_until", "2026-10-05");
    // A queued version now sitting in the cleared stretch goes with its days —
    // bounded by the next block, which owns its own versions.
    expect(retireQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "archived" })
    );
    expect(retireQuery.gt).toHaveBeenCalledWith("effective_from", "2026-10-05");
    expect(retireQuery.lte).toHaveBeenCalledWith("effective_from", "2026-10-31");
    // The training programs follow their days too (migration 167): a live one
    // reaching past the new end is pulled back, a queued one in the cleared
    // stretch is archived — the same two statements, on the other track.
    expect(trainingCapQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({ effective_until: "2026-10-05" })
    );
    expect(trainingCapQuery.is).toHaveBeenCalledWith("deleted_at", null);
    expect(trainingCapQuery.neq).toHaveBeenCalledWith("status", "archived");
    expect(trainingCapQuery.lte).toHaveBeenCalledWith("effective_from", "2026-10-05");
    expect(trainingCapQuery.gt).toHaveBeenCalledWith("effective_until", "2026-10-05");
    expect(trainingRetireQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "archived" })
    );
    expect(trainingRetireQuery.gt).toHaveBeenCalledWith("effective_from", "2026-10-05");
    expect(trainingRetireQuery.lte).toHaveBeenCalledWith("effective_from", "2026-10-31");
  });

  it("with nothing past the block, still pulls the versions back, retires none, and touches no edit when no version is cut", async () => {
    const cutQuery = query({ data: [], error: null });
    const capQuery = query({ data: null, error: null });
    const trainingCapQuery = query({ data: null, error: null });
    wireTables({
      client_phases: [query({ data: null, error: null })],
      training_events: [query({ data: null, error: null })],
      nutrition_plans: [cutQuery, capQuery],
      training_plans: [trainingCapQuery],
    });

    const cleared = await clearEventsOutsideBlock({
      clientId: "c1", clientToday: TODAY, blockEndsOn: "2026-10-05",
    });

    expect(cleared).toEqual({ trainingCleared: 0 });
    expect(capQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({ effective_until: "2026-10-05" })
    );
    expect(trainingCapQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({ effective_until: "2026-10-05" })
    );
    // No ceiling → the cut read is bounded at the block's end, and no session
    // removal, no retirement and no edits statement: the two probes, the cut
    // read, one cap per track.
    expect(cutQuery.lte).toHaveBeenCalledWith("effective_from", "2026-10-05");
    expect(mockFrom.mock.calls.map((call) => call[0])).not.toContain("nutrition_day_edits");
    expect(mockFrom).toHaveBeenCalledTimes(5);
  });
});
