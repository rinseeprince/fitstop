import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./client-portal-service", () => ({ createPortalClient: vi.fn() }));

import { getClientProgressData } from "./client-portal-progress";
import { createPortalClient } from "./client-portal-service";

// Minimal fake of the supabase chains getClientProgressData uses:
//   check_ins: .select().eq().gte().order()  (awaited)
//   clients:   .select().eq().single()       (awaited)
function fakeSupabase(opts: {
  checkIns?: unknown[];
  client?: Record<string, unknown> | null;
  clientError?: { message: string } | null;
}) {
  const checkInChain = {
    select: () => checkInChain,
    eq: () => checkInChain,
    gte: () => checkInChain,
    order: () => Promise.resolve({ data: opts.checkIns ?? [], error: null }),
  };
  const clientChain = {
    select: () => clientChain,
    eq: () => clientChain,
    single: () =>
      Promise.resolve({ data: opts.client ?? null, error: opts.clientError ?? null }),
  };
  return {
    from: (table: string) => (table === "check_ins" ? checkInChain : clientChain),
  };
}

describe("getClientProgressData unit resolution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns kg + cm for a metric client and surfaces goals/streak", async () => {
    vi.mocked(createPortalClient).mockResolvedValue(
      fakeSupabase({
        client: {
          weight_unit: "kg",
          unit_preference: "metric",
          current_streak: 6,
          check_in_adherence_rate: 92,
          goal_weight: 78,
        },
      }) as never,
    );

    const result = await getClientProgressData("c1");

    expect(result.client.weightUnit).toBe("kg");
    expect(result.client.measurementUnit).toBe("cm");
    expect(result.currentStreak).toBe(6);
    expect(result.adherenceRate).toBe(92);
    expect(result.client.goalWeight).toBe(78);
  });

  it("returns lbs + in for an imperial client", async () => {
    vi.mocked(createPortalClient).mockResolvedValue(
      fakeSupabase({ client: { weight_unit: "lbs", unit_preference: "imperial" } }) as never,
    );

    const result = await getClientProgressData("c1");

    expect(result.client.weightUnit).toBe("lbs");
    expect(result.client.measurementUnit).toBe("in");
  });

  it("logs and does not throw when the client query errors (no silent lbs fallback bug)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createPortalClient).mockResolvedValue(
      fakeSupabase({ client: null, clientError: { message: "boom" } }) as never,
    );

    const result = await getClientProgressData("c1");

    expect(result.client.weightUnit).toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
