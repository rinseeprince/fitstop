import { describe, it, expect, vi, beforeEach } from "vitest";

// One builder answers both shapes the service uses: `upsert(…)` awaited as is
// (Mark seen), `upsert(…).select(…)` (the first-visit start) and the
// `select … eq … eq … maybeSingle` read.
const upsertMock = vi.fn();
const upsertSelectMock = vi.fn();
const maybeSingleMock = vi.fn();
const fromMock = vi.fn();
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: { from: (...a: unknown[]) => fromMock(...a) },
}));

import { startLastViewed, upsertLastViewed } from "./coach-client-views-service";

beforeEach(() => {
  vi.clearAllMocks();
  upsertSelectMock.mockResolvedValue({ data: [{ last_viewed_at: "2026-06-04T09:15:00+00:00" }], error: null });
  maybeSingleMock.mockResolvedValue({ data: null, error: null });
  upsertMock.mockImplementation(() => {
    const done = Promise.resolve({ error: null });
    return Object.assign(done, { select: upsertSelectMock });
  });
  const read = {
    select: vi.fn(() => read),
    eq: vi.fn(() => read),
    maybeSingle: maybeSingleMock,
  };
  fromMock.mockReturnValue({ upsert: upsertMock, select: read.select });
});

// Two writers of one anchor, deliberately different: a first visit only ever
// STARTS it, and Mark seen alone MOVES it — so a page load can never clear an
// unread feed.
describe("the last-viewed anchor", () => {
  it("a first visit starts it only where none exists, on the database's clock: an insert that never overwrites", async () => {
    const anchor = await startLastViewed("coach-1", "client-1");

    expect(fromMock).toHaveBeenCalledWith("coach_client_views");
    // No time of its own: the column's default stamps it
    expect(upsertMock).toHaveBeenCalledWith(
      { coach_id: "coach-1", client_id: "client-1" },
      { onConflict: "coach_id,client_id", ignoreDuplicates: true }
    );
    expect(upsertSelectMock).toHaveBeenCalledWith("last_viewed_at");
    expect(anchor).toBe("2026-06-04T09:15:00+00:00");
  });

  it("answers the anchor another request started first, when its own insert wrote nothing", async () => {
    upsertSelectMock.mockResolvedValue({ data: [], error: null });
    maybeSingleMock.mockResolvedValue({ data: { last_viewed_at: "2026-06-04T09:14:58+00:00" }, error: null });

    expect(await startLastViewed("coach-1", "client-1")).toBe("2026-06-04T09:14:58+00:00");
  });

  it("Mark seen moves it: an upsert that overwrites", async () => {
    await upsertLastViewed("coach-1", "client-1");

    expect(upsertMock).toHaveBeenCalledWith(
      { coach_id: "coach-1", client_id: "client-1", last_viewed_at: expect.any(String) },
      { onConflict: "coach_id,client_id" }
    );
  });

  it("a failed start throws for its caller to handle", async () => {
    upsertSelectMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(startLastViewed("coach-1", "client-1")).rejects.toThrow(
      "Failed to start the view anchor: boom"
    );
    consoleError.mockRestore();
  });
});
