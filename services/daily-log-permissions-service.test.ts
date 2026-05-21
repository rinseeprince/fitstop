import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { supabaseAdmin } from "@/services/supabase-admin";
import { getDayEditState, assertCanEdit } from "./daily-log-permissions-service";
import { DayLockedError } from "@/lib/daily-log-permissions";
import { getTodayDateStringInTimezone } from "@/lib/date-helpers";

const today = getTodayDateStringInTimezone("UTC");
const daysAgo = (n: number): string => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

function clientsQuery(timezone: string | null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: timezone === null ? null : { timezone },
      error: null,
    }),
  };
}

function childQuery(row: { id: string } | null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  };
}

function mockFrom(opts: { timezone?: string | null; childRow?: { id: string } | null }) {
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) =>
    table === "clients"
      ? clientsQuery(opts.timezone === undefined ? "UTC" : opts.timezone)
      : childQuery(opts.childRow ?? null)) as never);
}

describe("getDayEditState / assertCanEdit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows editing today when never logged", async () => {
    mockFrom({ timezone: "UTC", childRow: null });
    const state = await getDayEditState("c1", today, "nutrition");
    expect(state).toEqual({ editable: true, loggedStatus: "never-logged", clientTimezone: "UTC" });

    mockFrom({ timezone: "UTC", childRow: null });
    await expect(
      assertCanEdit({ clientId: "c1", date: today, resourceType: "nutrition" })
    ).resolves.toEqual({ loggedStatus: "never-logged" });
  });

  it("locks a past logged day and assertCanEdit throws DayLockedError", async () => {
    const past = daysAgo(3);
    mockFrom({ timezone: "UTC", childRow: { id: "n1" } });
    const state = await getDayEditState("c1", past, "nutrition");
    expect(state.editable).toBe(false);
    expect(state.loggedStatus).toBe("logged");

    mockFrom({ timezone: "UTC", childRow: { id: "n1" } });
    await expect(
      assertCanEdit({ clientId: "c1", date: past, resourceType: "nutrition" })
    ).rejects.toBeInstanceOf(DayLockedError);

    mockFrom({ timezone: "UTC", childRow: { id: "n1" } });
    const err = await assertCanEdit({ clientId: "c1", date: past, resourceType: "nutrition" }).catch(
      (e) => e
    );
    expect(err).toBeInstanceOf(DayLockedError);
    expect(err.date).toBe(past);
    expect(err.resourceType).toBe("nutrition");
  });

  it("reads the resource's own child table", async () => {
    const fromSpy = vi.mocked(supabaseAdmin.from);
    mockFrom({ timezone: "UTC", childRow: null });
    await getDayEditState("c1", today, "nutrition");
    expect(fromSpy).toHaveBeenCalledWith("nutrition_logs");

    fromSpy.mockClear();
    mockFrom({ timezone: "UTC", childRow: null });
    await getDayEditState("c1", today, "wellness");
    expect(fromSpy).toHaveBeenCalledWith("wellness_logs");
  });

  it("treats an invalid client timezone as UTC (no throw)", async () => {
    mockFrom({ timezone: "Mars/Olympus", childRow: { id: "n1" } });
    const state = await getDayEditState("c1", today, "nutrition");
    expect(state.editable).toBe(true); // today is editable; bad tz falls back to UTC
  });
});
