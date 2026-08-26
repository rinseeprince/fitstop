import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { supabaseAdmin } from "./supabase-admin";
import {
  assertDateFree,
  assertSessionUnlogged,
  getSessionEventLinks,
  rethrowIfDateOccupied,
  DateOccupiedError,
  SessionLoggedError,
  hasCompletedWorkoutOn,
} from "./training-event-occupancy";

/** Mirrors the PostgREST chains built here: select→eq→eq→[neq|in]→limit. */
function mockQuery(result: { data: unknown[] | null; error: { message: string } | null }) {
  const q: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "in"]) {
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
      /Fri, Aug 14 already has a session/,
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
      /Fri, Aug 14 already has a session/,
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

/** Mirrors getSessionEventLinks' chain: select→eq→eq→order (awaited). */
function mockLinksQuery(result: { data: unknown[] | null; error: { message: string } | null }) {
  const q: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) {
    q[method] = vi.fn().mockReturnValue(q);
  }
  q.order = vi.fn().mockResolvedValue(result);
  return q;
}

const SESSION_ID = "sess-1";
const CLIENT_ID = "client-1";

describe("getSessionEventLinks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns client-scoped event links with is_modified coerced to boolean", async () => {
    const q = mockLinksQuery({
      data: [
        { id: "ev-1", date: "2026-07-20", status: "completed", is_modified: null },
        { id: "ev-2", date: "2026-07-27", status: "scheduled", is_modified: true },
      ],
      error: null,
    });
    vi.mocked(supabaseAdmin.from).mockReturnValue(q as never);

    const links = await getSessionEventLinks(SESSION_ID, CLIENT_ID);

    expect(supabaseAdmin.from).toHaveBeenCalledWith("training_events");
    expect(q.eq).toHaveBeenCalledWith("training_session_id", SESSION_ID);
    expect(q.eq).toHaveBeenCalledWith("client_id", CLIENT_ID);
    expect(links).toEqual([
      { id: "ev-1", date: "2026-07-20", status: "completed", isModified: false },
      { id: "ev-2", date: "2026-07-27", status: "scheduled", isModified: true },
    ]);
  });

  it("throws on db error with a descriptive message", async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(
      mockLinksQuery({ data: null, error: { message: "permission denied" } }) as never,
    );

    await expect(getSessionEventLinks(SESSION_ID, CLIENT_ID)).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("assertSessionUnlogged", () => {
  beforeEach(() => vi.clearAllMocks());

  const link = (date: string, status: string) => ({
    id: `ev-${date}`,
    date,
    status,
    is_modified: false,
  });

  it("refuses a session whose event has left `scheduled`, naming the day", async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(
      mockLinksQuery({ data: [link("2026-08-14", "completed")], error: null }) as never,
    );

    await expect(assertSessionUnlogged(SESSION_ID, CLIENT_ID)).rejects.toThrow(
      SessionLoggedError,
    );
    // The coach has to be told WHICH day, not a constraint name or a stack.
    await expect(assertSessionUnlogged(SESSION_ID, CLIENT_ID)).rejects.toThrow(
      /The client logged this session on Fri, Aug 14, so it can no longer be edited/,
    );
  });

  it("names the EARLIEST logged occurrence, not whichever row came back first", async () => {
    // The read orders by date ascending; the message must follow that order or
    // it would name a different day on a re-read.
    vi.mocked(supabaseAdmin.from).mockReturnValue(
      mockLinksQuery({
        data: [
          link("2026-08-10", "partial"),
          link("2026-08-14", "completed"),
        ],
        error: null,
      }) as never,
    );

    await expect(assertSessionUnlogged(SESSION_ID, CLIENT_ID)).rejects.toThrow(
      /Mon, Aug 10/,
    );
  });

  it.each(["completed", "partial", "skipped", "missed"])(
    "refuses on status %s — the predicate is `!== scheduled`, not a list of logged states",
    async (status) => {
      vi.mocked(supabaseAdmin.from).mockReturnValue(
        mockLinksQuery({ data: [link("2026-08-14", status)], error: null }) as never,
      );

      await expect(assertSessionUnlogged(SESSION_ID, CLIENT_ID)).rejects.toThrow(
        SessionLoggedError,
      );
    },
  );

  it("does not filter the read by status — narrowing it would leave nothing to find", async () => {
    // The mirror of assertDateFree's own status-agnostic test above. Whoever
    // deletes the vestigial save-scope dialog is the likely person to narrow
    // this read to `scheduled`, which would disable the lock in silence.
    const q = mockLinksQuery({ data: [link("2026-08-14", "completed")], error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(q as never);

    await expect(assertSessionUnlogged(SESSION_ID, CLIENT_ID)).rejects.toThrow(
      SessionLoggedError,
    );
    const statusFiltered = (q.eq as ReturnType<typeof vi.fn>).mock.calls.some(
      ([column]) => column === "status",
    );
    expect(statusFiltered).toBe(false);
  });

  it("allows a session whose events are all scheduled", async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(
      mockLinksQuery({
        data: [link("2026-08-14", "scheduled"), link("2026-08-21", "scheduled")],
        error: null,
      }) as never,
    );

    await expect(assertSessionUnlogged(SESSION_ID, CLIENT_ID)).resolves.toBeUndefined();
  });

  it("allows a session with no events at all", async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(
      mockLinksQuery({ data: [], error: null }) as never,
    );

    await expect(assertSessionUnlogged(SESSION_ID, CLIENT_ID)).resolves.toBeUndefined();
  });

  it("throws loudly on a read failure instead of reporting the session as unlogged", async () => {
    // A swallowed error here would silently disable the lock — the same
    // fail-loudly posture as assertDateFree.
    vi.mocked(supabaseAdmin.from).mockReturnValue(
      mockLinksQuery({ data: null, error: { message: "boom" } }) as never,
    );

    const call = assertSessionUnlogged(SESSION_ID, CLIENT_ID);
    await expect(call).rejects.toThrow(/Failed to fetch session events/);
    await expect(call).rejects.not.toBeInstanceOf(SessionLoggedError);
  });
});

describe("hasCompletedWorkoutOn", () => {
  it("is true when a completed or partial event sits on the day, false when the day is clear", async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery({ data: [{ id: "ev-1" }], error: null }) as never);
    await expect(hasCompletedWorkoutOn("c1", "2026-05-08")).resolves.toBe(true);

    vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery({ data: [], error: null }) as never);
    await expect(hasCompletedWorkoutOn("c1", "2026-05-08")).resolves.toBe(false);
  });

  it("filters on the client, the date and the logged statuses only", async () => {
    const q = mockQuery({ data: [], error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(q as never);
    await hasCompletedWorkoutOn("c1", "2026-05-08");
    expect(q.eq).toHaveBeenCalledWith("client_id", "c1");
    expect(q.eq).toHaveBeenCalledWith("date", "2026-05-08");
    expect(q.in).toHaveBeenCalledWith("status", ["completed", "partial"]);
  });
});
