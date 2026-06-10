import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString, getCoachTodayString } from "./today-service";

// 23:30 UTC on June 9 — already June 10 in London (BST, UTC+1), still June 9
// in UTC. The canonical boundary instant for these tests.
const BOUNDARY = new Date("2026-06-09T23:30:00Z");

function mockClientRow(
  row: { timezone: string; coaches: { timezone: string } | null } | null,
) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  };
  vi.mocked(supabaseAdmin.from).mockReturnValue(
    query as unknown as ReturnType<typeof supabaseAdmin.from>,
  );
  return query;
}

describe("getClientTodayString", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the client's synced timezone (London 23:30Z -> next local day)", async () => {
    const query = mockClientRow({
      timezone: "Europe/London",
      coaches: { timezone: "America/New_York" },
    });

    await expect(getClientTodayString("client-1", BOUNDARY)).resolves.toBe(
      "2026-06-10",
    );
    expect(supabaseAdmin.from).toHaveBeenCalledWith("clients");
    expect(query.eq).toHaveBeenCalledWith("id", "client-1");
  });

  it("falls back to the coach's timezone when the client is the unsynced 'UTC' default", async () => {
    mockClientRow({
      timezone: "UTC",
      coaches: { timezone: "Europe/London" },
    });

    await expect(getClientTodayString("client-1", BOUNDARY)).resolves.toBe(
      "2026-06-10",
    );
  });

  it("falls back to UTC when both client and coach are unsynced", async () => {
    mockClientRow({ timezone: "UTC", coaches: { timezone: "UTC" } });

    await expect(getClientTodayString("client-1", BOUNDARY)).resolves.toBe(
      "2026-06-09",
    );
  });

  it("falls back to UTC when the coach embed is missing", async () => {
    mockClientRow({ timezone: "UTC", coaches: null });

    await expect(getClientTodayString("client-1", BOUNDARY)).resolves.toBe(
      "2026-06-09",
    );
  });

  it("falls back to UTC when the client row is not found", async () => {
    mockClientRow(null);

    await expect(getClientTodayString("missing", BOUNDARY)).resolves.toBe(
      "2026-06-09",
    );
  });

  it("resolves a west-of-UTC client to the previous local day", async () => {
    // 00:30 UTC June 10 is still 17:30 June 9 in Los Angeles.
    mockClientRow({ timezone: "America/Los_Angeles", coaches: null });

    await expect(
      getClientTodayString("client-1", new Date("2026-06-10T00:30:00Z")),
    ).resolves.toBe("2026-06-09");
  });
});

describe("getCoachTodayString", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockCoachRow(row: { timezone: string } | null) {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    };
    vi.mocked(supabaseAdmin.from).mockReturnValue(
      query as unknown as ReturnType<typeof supabaseAdmin.from>,
    );
    return query;
  }

  it("uses the coach's synced timezone (London 23:30Z -> next local day)", async () => {
    const query = mockCoachRow({ timezone: "Europe/London" });

    await expect(getCoachTodayString("coach-1", BOUNDARY)).resolves.toBe(
      "2026-06-10",
    );
    expect(supabaseAdmin.from).toHaveBeenCalledWith("coaches");
    expect(query.eq).toHaveBeenCalledWith("id", "coach-1");
  });

  it("falls back to UTC when the coach row is missing or unsynced", async () => {
    mockCoachRow(null);

    await expect(getCoachTodayString("missing", BOUNDARY)).resolves.toBe(
      "2026-06-09",
    );
  });
});
