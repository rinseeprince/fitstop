import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { supabaseAdmin } from "./supabase-admin";
import {
  assertSessionUnlogged,
  getSessionEventLinks,
  SessionLoggedError,
} from "./training-session-lock";

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

  it("returns the session's client-scoped event links", async () => {
    const q = mockLinksQuery({
      data: [
        { id: "ev-1", date: "2026-07-20", status: "completed" },
        { id: "ev-2", date: "2026-07-27", status: "scheduled" },
      ],
      error: null,
    });
    vi.mocked(supabaseAdmin.from).mockReturnValue(q as never);

    const links = await getSessionEventLinks(SESSION_ID, CLIENT_ID);

    expect(supabaseAdmin.from).toHaveBeenCalledWith("training_events");
    expect(q.eq).toHaveBeenCalledWith("training_session_id", SESSION_ID);
    expect(q.eq).toHaveBeenCalledWith("client_id", CLIENT_ID);
    expect(links).toEqual([
      { id: "ev-1", date: "2026-07-20", status: "completed" },
      { id: "ev-2", date: "2026-07-27", status: "scheduled" },
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
    // Narrowing this read to `scheduled` would disable the lock in silence.
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
    // A swallowed error here would silently disable the lock.
    vi.mocked(supabaseAdmin.from).mockReturnValue(
      mockLinksQuery({ data: null, error: { message: "boom" } }) as never,
    );

    const call = assertSessionUnlogged(SESSION_ID, CLIENT_ID);
    await expect(call).rejects.toThrow(/Failed to fetch session events/);
    await expect(call).rejects.not.toBeInstanceOf(SessionLoggedError);
  });
});
