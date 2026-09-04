import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/services/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { supabaseAdmin } from "@/services/supabase-admin";
import {
  getLastSubmittedPeriodEnd,
  getLogWindow,
  getDayEditState,
  assertCanEdit,
} from "./daily-log-permissions-service";
import { DayLockedError } from "@/lib/daily-log-permissions";

// Thu 3 Sep 2026, with Sunday check-ins. The outstanding check-in covers the
// week that ended Sun 30 Aug, so the open range is Mon 24 Aug through today.
const NOW = "2026-09-03T12:00:00Z";
const SUNDAY_DUE = "2026-09-06";
const WINDOW_START = "2026-08-24";
const TODAY = "2026-09-03";

type ClientRow = {
  timezone: string;
  next_check_in_due: string | null;
  start_date: string | null;
};

const CLIENT: ClientRow = {
  timezone: "UTC",
  next_check_in_due: SUNDAY_DUE,
  start_date: "2026-01-01",
};

/** Records every table the code touched, so a test can prove what it did NOT read. */
let touched: string[] = [];

function clientsQuery(row: ClientRow | null, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: row, error }),
  };
}

function checkInsQuery(periodEnd: string | null, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi
      .fn()
      .mockResolvedValue({ data: periodEnd === null ? null : { period_end: periodEnd }, error }),
  };
}

function mockFrom(
  opts: {
    client?: ClientRow | null;
    clientError?: unknown;
    lastPeriodEnd?: string | null;
    checkInsError?: unknown;
  } = {}
) {
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
    touched.push(table);
    if (table === "clients") {
      return clientsQuery(
        opts.client === undefined ? CLIENT : opts.client,
        opts.clientError ?? null
      );
    }
    return checkInsQuery(opts.lastPeriodEnd ?? null, opts.checkInsError ?? null);
  }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  touched = [];
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

describe("getLastSubmittedPeriodEnd", () => {
  it("returns the newest submitted period end", async () => {
    mockFrom({ lastPeriodEnd: "2026-08-30" });
    await expect(getLastSubmittedPeriodEnd("c1")).resolves.toBe("2026-08-30");
  });

  it("returns null for a client who has never checked in", async () => {
    mockFrom({ lastPeriodEnd: null });
    await expect(getLastSubmittedPeriodEnd("c1")).resolves.toBeNull();
  });

  it("logs a read failure loudly rather than silently closing or opening days", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFrom({ checkInsError: { message: "boom" } });
    await expect(getLastSubmittedPeriodEnd("c1")).resolves.toBeNull();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("getLastSubmittedPeriodEnd"),
      expect.anything()
    );
    spy.mockRestore();
  });
});

describe("getLogWindow", () => {
  it("reads the client and the check-in period, and NOTHING else", async () => {
    mockFrom({ lastPeriodEnd: null });
    await getLogWindow("c1");
    // Mutation guard: the old rule read a per-resource child table
    // (nutrition_logs / wellness_logs / daily_habit_logs / training_logs) to ask
    // whether the day was already logged. Nothing may read one again.
    expect(new Set(touched)).toEqual(new Set(["clients", "check_ins"]));
  });

  it("opens at the start of the week the outstanding check-in covers", async () => {
    mockFrom({ lastPeriodEnd: null });
    await expect(getLogWindow("c1")).resolves.toEqual({
      logsOpenFrom: WINDOW_START,
      clientTimezone: "UTC",
    });
  });

  it("a submitted check-in closes its week and everything before it", async () => {
    mockFrom({ lastPeriodEnd: "2026-08-30" });
    const { logsOpenFrom } = await getLogWindow("c1");
    expect(logsOpenFrom).toBe("2026-08-31");
  });

  it("a client with no schedule has no lower bound", async () => {
    mockFrom({ client: { ...CLIENT, next_check_in_due: null }, lastPeriodEnd: null });
    const { logsOpenFrom } = await getLogWindow("c1");
    expect(logsOpenFrom).toBeNull();
  });

  it("logs the client fetch error and still falls back to UTC", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFrom({ client: null, clientError: { message: "nope" }, lastPeriodEnd: null });
    const { clientTimezone, logsOpenFrom } = await getLogWindow("c1");
    expect(clientTimezone).toBe("UTC");
    // No row means no schedule, so the fallback opens rather than locking the
    // client out of their own day.
    expect(logsOpenFrom).toBeNull();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("getLogWindow: client fetch failed"),
      expect.anything()
    );
    spy.mockRestore();
  });
});

describe("getDayEditState / assertCanEdit", () => {
  it("today is editable and assertCanEdit resolves", async () => {
    mockFrom({ lastPeriodEnd: null });
    await expect(getDayEditState("c1", TODAY)).resolves.toMatchObject({ editable: true });

    mockFrom({ lastPeriodEnd: null });
    await expect(
      assertCanEdit({ clientId: "c1", date: TODAY, resourceType: "nutrition" })
    ).resolves.toBeUndefined();
  });

  it("a day inside a submitted check-in's week is locked, whatever the resource", async () => {
    for (const resourceType of ["nutrition", "wellness", "habit", "training"] as const) {
      mockFrom({ lastPeriodEnd: "2026-08-30" });
      const state = await getDayEditState("c1", "2026-08-28");
      expect(state.editable).toBe(false);

      mockFrom({ lastPeriodEnd: "2026-08-30" });
      await expect(
        assertCanEdit({ clientId: "c1", date: "2026-08-28", resourceType })
      ).rejects.toBeInstanceOf(DayLockedError);
    }
  });

  it("the error names no date and no resource in its sentence", async () => {
    mockFrom({ lastPeriodEnd: "2026-08-30" });
    const err = await assertCanEdit({
      clientId: "c1",
      date: "2026-08-28",
      resourceType: "habit",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DayLockedError);
    expect((err as DayLockedError).message).toBe("This day is locked.");
    // The fields survive for a caller that wants them; only the sentence is bare.
    expect((err as DayLockedError).date).toBe("2026-08-28");
    expect((err as DayLockedError).resourceType).toBe("habit");
  });

  it("a day in the open week is editable even after the client has checked in before", async () => {
    mockFrom({ lastPeriodEnd: "2026-08-30" });
    await expect(getDayEditState("c1", "2026-09-01")).resolves.toMatchObject({
      editable: true,
    });
  });

  it("the future is locked", async () => {
    mockFrom({ lastPeriodEnd: null });
    await expect(getDayEditState("c1", "2026-09-04")).resolves.toMatchObject({
      editable: false,
    });
  });
});
