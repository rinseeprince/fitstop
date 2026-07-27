import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { supabaseAdmin } from "./supabase-admin";
import {
  assertDateFree,
  rethrowIfDateOccupied,
  DateOccupiedError,
} from "./training-event-occupancy";

/** Mirrors the PostgREST chain assertDateFree builds: select→eq→eq→[neq]→limit. */
function mockQuery(result: { data: unknown[] | null; error: { message: string } | null }) {
  const q: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq"]) {
    q[method] = vi.fn().mockReturnValue(q);
  }
  q.limit = vi.fn().mockResolvedValue(result);
  return q;
}

describe("assertDateFree", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a date that already holds an event, naming the day", async () => {
    const q = mockQuery({ data: [{ id: "existing" }], error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(q as never);

    await expect(assertDateFree("client-1", "2026-08-14")).rejects.toThrow(DateOccupiedError);
    // The coach has to be told WHICH day, not "duplicate key value violates…".
    await expect(assertDateFree("client-1", "2026-08-14")).rejects.toThrow(
      /Fri, 14 Aug already has a session/,
    );
  });

  it("allows a free date", async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery({ data: [], error: null }) as never);

    await expect(assertDateFree("client-1", "2026-08-14")).resolves.toBeUndefined();
  });

  it("is status-agnostic — a logged session still occupies the day", async () => {
    // Deliberately wider than migration 136's scheduled-only index: dropping a
    // session onto a day the client already trained would stack two cards.
    const q = mockQuery({ data: [{ id: "completed-one" }], error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(q as never);

    await expect(assertDateFree("client-1", "2026-08-14")).rejects.toThrow(DateOccupiedError);
    const statusFiltered = (q.eq as ReturnType<typeof vi.fn>).mock.calls.some(
      ([column]) => column === "status",
    );
    expect(statusFiltered).toBe(false);
  });

  it("excludes the event being moved, so a move never rejects itself", async () => {
    const q = mockQuery({ data: [], error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(q as never);

    await assertDateFree("client-1", "2026-08-14", "event-1");

    expect(q.neq).toHaveBeenCalledWith("id", "event-1");
  });

  it("throws loudly on a read failure instead of reporting the day as free", async () => {
    // A swallowed error here would silently disable the guard.
    vi.mocked(supabaseAdmin.from).mockReturnValue(
      mockQuery({ data: null, error: { message: "boom" } }) as never,
    );

    const call = assertDateFree("client-1", "2026-08-14");
    await expect(call).rejects.toThrow(/Failed to check date availability/);
    await expect(call).rejects.not.toBeInstanceOf(DateOccupiedError);
  });
});

describe("rethrowIfDateOccupied", () => {
  it("translates the index's unique violation into the same coach-readable error", () => {
    // The event upserts arbitrate on (client_id, training_session_id, date),
    // which does not cover migration 136's index — so a collision arrives raw.
    const pgError = {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "idx_training_events_one_scheduled_per_day"',
    };

    expect(() => rethrowIfDateOccupied(pgError, "2026-08-14")).toThrow(DateOccupiedError);
    expect(() => rethrowIfDateOccupied(pgError, "2026-08-14")).toThrow(
      /Fri, 14 Aug already has a session/,
    );
  });

  it("leaves every other error to the caller", () => {
    expect(() =>
      rethrowIfDateOccupied(
        { code: "23505", message: 'violates unique constraint "uq_training_events_session_date"' },
        "2026-08-14",
      ),
    ).not.toThrow();
    expect(() => rethrowIfDateOccupied({ code: "23503" }, "2026-08-14")).not.toThrow();
    expect(() => rethrowIfDateOccupied(null, "2026-08-14")).not.toThrow();
  });
});
