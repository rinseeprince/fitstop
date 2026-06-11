import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { supabaseAdmin } from "@/services/supabase-admin";
import {
  getDayEditState,
  assertCanEdit,
  assertCanEditTrainingDay,
} from "./daily-log-permissions-service";
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

/**
 * Child-row query for the habit resource whose result depends on the queried
 * `daily_habit_id`: returns a row only when it matches `loggedId`. This lets a test prove
 * the per-habit narrowing — same day, one habit "logged", another "never-logged".
 */
function habitChildQuery(loggedId: string) {
  let queriedHabitId: string | undefined;
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((col: string, val: string) => {
      if (col === "daily_habit_id") queriedHabitId = val;
      return builder;
    }),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(() =>
      Promise.resolve({ data: queriedHabitId === loggedId ? { id: "hl1" } : null, error: null }),
    ),
  };
  return builder;
}

function mockHabitFrom(loggedId: string, timezone = "UTC") {
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) =>
    table === "clients" ? clientsQuery(timezone) : habitChildQuery(loggedId)) as never);
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

  it("locks a past day per-habit: the recorded habit is locked, an unrecorded one stays editable", async () => {
    const past = daysAgo(3);

    mockHabitFrom("logged-habit");
    const locked = await getDayEditState("c1", past, "habit", { habitId: "logged-habit" });
    expect(locked.loggedStatus).toBe("logged");
    expect(locked.editable).toBe(false);

    mockHabitFrom("logged-habit");
    const open = await getDayEditState("c1", past, "habit", { habitId: "missed-habit" });
    expect(open.loggedStatus).toBe("never-logged");
    expect(open.editable).toBe(true);

    mockHabitFrom("logged-habit");
    await expect(
      assertCanEdit({ clientId: "c1", date: past, resourceType: "habit", habitId: "logged-habit" }),
    ).rejects.toBeInstanceOf(DayLockedError);

    mockHabitFrom("logged-habit");
    await expect(
      assertCanEdit({ clientId: "c1", date: past, resourceType: "habit", habitId: "missed-habit" }),
    ).resolves.toEqual({ loggedStatus: "never-logged" });
  });

  it("queries daily_habit_logs for the habit resource", async () => {
    const fromSpy = vi.mocked(supabaseAdmin.from);
    mockHabitFrom("logged-habit");
    await getDayEditState("c1", today, "habit", { habitId: "h1" });
    expect(fromSpy).toHaveBeenCalledWith("daily_habit_logs");
  });
});

// The loud log is the observable contract: a mocked chain can't reproduce a
// live PostgREST failure (the PGRST201 lesson), so these pin that a fetch
// error is logged rather than silently becoming a UTC day decision.
describe("timezone fetch error paths", () => {
  beforeEach(() => vi.clearAllMocks());

  function erroringClientsQuery() {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "PGRST301", message: "connection failure" },
      }),
    };
  }

  it("getDayEditState logs the fetch error and still falls back to UTC", async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) =>
      table === "clients" ? erroringClientsQuery() : childQuery(null)) as never);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const state = await getDayEditState("c1", today, "nutrition");

    expect(state).toEqual({
      editable: true,
      loggedStatus: "never-logged",
      clientTimezone: "UTC",
    });
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("getDayEditState: client timezone fetch failed, falling back to UTC"),
      expect.objectContaining({ code: "PGRST301" })
    );
    consoleError.mockRestore();
  });

  it("assertCanEditTrainingDay logs the fetch error and still applies the UTC fallback rule", async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((() =>
      erroringClientsQuery()) as never);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    // Today + never-logged is editable under the UTC fallback, so no throw.
    await expect(
      assertCanEditTrainingDay("c1", today, "never-logged")
    ).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(
        "assertCanEditTrainingDay: client timezone fetch failed, falling back to UTC"
      ),
      expect.objectContaining({ code: "PGRST301" })
    );
    consoleError.mockRestore();
  });
});
