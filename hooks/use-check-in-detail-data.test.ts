import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { DailyLog } from "@/types/daily-log";

const { mockUseSWR, mockUseSWRConfig, mockUseWellnessData } = vi.hoisted(() => ({
  mockUseSWR: vi.fn(),
  mockUseSWRConfig: vi.fn(),
  mockUseWellnessData: vi.fn(),
}));
vi.mock("swr", () => ({ default: mockUseSWR, useSWRConfig: mockUseSWRConfig }));
vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));
vi.mock("@/hooks/use-wellness-data", () => ({ useWellnessData: mockUseWellnessData }));

import {
  checkInDetailKey,
  resolveCheckInDetailWindow,
  useCheckInDetailData,
  useClearCheckInComparisons,
  useInvalidateCheckInDetail,
} from "./use-check-in-detail-data";
import { getDateString } from "@/lib/date-helpers";

const log = (date: string, targets: Partial<DailyLog> = {}): DailyLog =>
  ({ id: date, clientId: "c1", date, ...targets }) as DailyLog;

describe("resolveCheckInDetailWindow", () => {
  it("uses the stored period, as local-midnight dates", () => {
    const { start, end } = resolveCheckInDetailWindow({
      periodStart: "2026-08-22",
      periodEnd: "2026-08-28",
      createdAt: "2026-08-29T09:00:00Z",
    });
    expect(getDateString(start)).toBe("2026-08-22");
    expect(getDateString(end)).toBe("2026-08-28");
    expect(start.getHours()).toBe(0);
  });

  it("falls back to the six days up to submission for a row with no period", () => {
    const createdAt = "2026-08-28T10:00:00Z";
    const { start, end } = resolveCheckInDetailWindow({ createdAt });
    expect(end.getTime()).toBe(new Date(createdAt).getTime());
    const expectedStart = new Date(createdAt);
    expectedStart.setDate(expectedStart.getDate() - 6);
    expect(getDateString(start)).toBe(getDateString(expectedStart));
  });
});

describe("useInvalidateCheckInDetail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reaches the detail and its comparison, never a same-prefix id or the queue", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);
    mockUseSWRConfig.mockReturnValue({ mutate });
    const { result } = renderHook(() => useInvalidateCheckInDetail());
    await result.current("ci-1");

    const filter = mutate.mock.calls[0][0] as (key: unknown) => boolean;
    expect(filter("/api/check-in/ci-1")).toBe(true);
    expect(filter("/api/check-in/ci-1/comparison")).toBe(true);
    expect(filter("/api/check-in/ci-10")).toBe(false);
    expect(filter("/api/check-ins/unreviewed")).toBe(false);
    expect(filter(null)).toBe(false);
  });
});

// A goal write changes whether a sent check-in's goal is still the client's
// (`goalIsCurrent`) — the one live answer on a comparison, and the one that
// offers "Set new goals". Cleared, never merely revalidated.
describe("useClearCheckInComparisons", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears every cached comparison and refetches, and touches nothing else", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);
    mockUseSWRConfig.mockReturnValue({ mutate });
    const { result } = renderHook(() => useClearCheckInComparisons());
    await result.current();

    const [filter, data, opts] = mutate.mock.calls[0] as [(key: unknown) => boolean, unknown, unknown];
    expect(filter("/api/check-in/ci-3/comparison")).toBe(true);
    expect(filter("/api/check-in/ci-44/comparison")).toBe(true);
    expect(filter("/api/check-in/ci-3")).toBe(false);
    expect(filter("/api/check-in/ci-3/comparison/extra")).toBe(false);
    expect(filter("/api/check-ins/unreviewed")).toBe(false);
    expect(filter(undefined)).toBe(false);
    expect(data).toBeUndefined();
    expect(opts).toEqual({ revalidate: true });
  });
});

describe("useCheckInDetailData", () => {
  const detail = {
    checkIn: {
      id: "ci-1",
      clientId: "c1",
      status: "ai_processed",
      periodStart: "2026-08-22",
      periodEnd: "2026-08-28",
      createdAt: "2026-08-28T10:00:00Z",
      updatedAt: "2026-08-28T10:00:00Z",
      sessionCompletions: [],
    },
    client: { id: "c1", name: "Jane" },
  };
  const idle = { data: undefined, error: undefined, isLoading: false, mutate: vi.fn() };

  /** Answer each SWR key by shape; unmatched keys (null) stay idle. */
  function wireSWR() {
    mockUseSWR.mockImplementation((key: string | null) => {
      if (key === null) return idle;
      if (key.endsWith("/comparison")) return { ...idle, data: { comparison: {} } };
      if (key.startsWith("/api/check-in/")) return { ...idle, data: detail };
      throw new Error(`unexpected key ${key}`);
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWellnessData.mockReturnValue({ logs: [], habitLogs: [], isLoading: false });
  });

  it("reads the detail and its comparison under the exported key", () => {
    wireSWR();
    renderHook(() => useCheckInDetailData({ checkInId: "ci-1", clientId: "c1" }));
    const keys = mockUseSWR.mock.calls.map((c) => c[0]);
    expect(keys).toContain(checkInDetailKey("ci-1"));
    expect(keys).toContain("/api/check-in/ci-1/comparison");
  });

  it("hands the stored period to the shared daily-log reader as an explicit range", () => {
    wireSWR();
    const { result } = renderHook(() =>
      useCheckInDetailData({ checkInId: "ci-1", clientId: "c1" })
    );
    // `withHabitLogs: false` is asserted, not incidental: the habit figures come
    // from the server's `periodAdherence` now, and a logs-derived grid silently
    // drops a habit the client ignored all week. Re-enabling the fetch here
    // would re-open that hole and cost a request nothing reads.
    expect(mockUseWellnessData).toHaveBeenCalledWith("c1", {
      range: { startDate: "2026-08-22", endDate: "2026-08-28" },
      withHabitLogs: false,
    });
    expect(result.current.isForeign).toBe(false);
    expect(getDateString(result.current.contextStartDate!)).toBe("2026-08-22");
  });

  it("refuses a check-in belonging to another client and fetches no context", () => {
    wireSWR();
    const { result } = renderHook(() =>
      useCheckInDetailData({ checkInId: "ci-1", clientId: "c2" })
    );
    expect(result.current.isForeign).toBe(true);
    expect(mockUseWellnessData).toHaveBeenCalledWith("c2", {
      range: null,
      withHabitLogs: false,
    });
    expect(result.current.contextStartDate).toBeNull();
    expect(result.current.dailyContextLoading).toBe(false);
    const planTargetKeys = mockUseSWR.mock.calls
      .map((c) => c[0])
      .filter((k) => typeof k === "string" && k.includes("plan-targets"));
    expect(planTargetKeys).toEqual([]);
  });

  // The figures come on the detail wire from the ONE kernel: the hook reads
  // no plan targets and folds no week target of its own.
  it("reads no plan targets and computes no week target", () => {
    const logs = [
      log("2026-08-22", { targetCalories: 9999 }),
      log("2026-08-23", { targetCalories: 9999 }),
    ];
    mockUseWellnessData.mockReturnValue({ logs, habitLogs: [], isLoading: false });
    wireSWR();
    const { result } = renderHook(() =>
      useCheckInDetailData({ checkInId: "ci-1", clientId: "c1" })
    );

    const keys = mockUseSWR.mock.calls.map((c) => c[0]);
    expect(keys.filter((k) => typeof k === "string" && k.includes("plan-targets"))).toEqual([]);
    expect("fullWeekTarget" in result.current).toBe(false);
  });

  it("reports the context as loading only once a window exists", () => {
    wireSWR();
    mockUseWellnessData.mockReturnValue({ logs: [], habitLogs: [], isLoading: true });
    const { result } = renderHook(() =>
      useCheckInDetailData({ checkInId: "ci-1", clientId: "c1" })
    );
    expect(result.current.dailyContextLoading).toBe(true);
  });
});
