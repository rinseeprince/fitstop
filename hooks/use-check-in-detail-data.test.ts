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
  buildFullWeekTarget,
  checkInDetailKey,
  resolveCheckInDetailWindow,
  unloggedDates,
  useCheckInDetailData,
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

describe("unloggedDates", () => {
  it("lists the window's dates that have no daily log", () => {
    const range = { startDate: "2026-08-22", endDate: "2026-08-25" };
    expect(unloggedDates(range, [log("2026-08-22"), log("2026-08-24")])).toEqual([
      "2026-08-23",
      "2026-08-25",
    ]);
  });
});

describe("buildFullWeekTarget", () => {
  it("sums the logged days' own targets plus the plan targets handed to it", () => {
    const logs = [
      log("2026-08-22", { targetCalories: 2000, targetProteinG: 150, targetCarbsG: 200, targetFatG: 60 }),
      log("2026-08-23", { targetCalories: 2100, targetProteinG: 150, targetCarbsG: 220, targetFatG: 65 }),
    ];
    expect(
      buildFullWeekTarget(logs, [{ calories: 1900, proteinG: 140, carbsG: 180, fatG: 55 }])
    ).toEqual({ calories: 6000, proteinG: 440, carbsG: 600, fatG: 180 });
  });

  it("counts a missing target as zero rather than NaN", () => {
    expect(buildFullWeekTarget([log("2026-08-22")], [{ calories: null }])).toEqual({
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
    });
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
  function wireSWR(planTargets?: unknown) {
    mockUseSWR.mockImplementation((key: string | null) => {
      if (key === null) return idle;
      if (key.endsWith("/comparison")) return { ...idle, data: { comparison: {} } };
      if (key.startsWith("/api/check-in/")) return { ...idle, data: detail };
      if (key.includes("plan-targets")) return { ...idle, data: planTargets };
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
    expect(mockUseWellnessData).toHaveBeenCalledWith("c1", {
      range: { startDate: "2026-08-22", endDate: "2026-08-28" },
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
    expect(mockUseWellnessData).toHaveBeenCalledWith("c2", { range: null });
    expect(result.current.contextStartDate).toBeNull();
    expect(result.current.dailyContextLoading).toBe(false);
    const planTargetKeys = mockUseSWR.mock.calls
      .map((c) => c[0])
      .filter((k) => typeof k === "string" && k.includes("plan-targets"));
    expect(planTargetKeys).toEqual([]);
  });

  it("asks the plan only for the unlogged dates and folds them into the week target", () => {
    const logs = [
      log("2026-08-22", { targetCalories: 2000, targetProteinG: 150, targetCarbsG: 200, targetFatG: 60 }),
      log("2026-08-23", { targetCalories: 2000, targetProteinG: 150, targetCarbsG: 200, targetFatG: 60 }),
      log("2026-08-24", { targetCalories: 2000, targetProteinG: 150, targetCarbsG: 200, targetFatG: 60 }),
      log("2026-08-25", { targetCalories: 2000, targetProteinG: 150, targetCarbsG: 200, targetFatG: 60 }),
      log("2026-08-26", { targetCalories: 2000, targetProteinG: 150, targetCarbsG: 200, targetFatG: 60 }),
    ];
    mockUseWellnessData.mockReturnValue({ logs, habitLogs: [], isLoading: false });
    wireSWR({
      targets: [
        { calories: 1800, proteinG: 140, carbsG: 170, fatG: 50 },
        { calories: 1800, proteinG: 140, carbsG: 170, fatG: 50 },
      ],
    });
    const { result } = renderHook(() =>
      useCheckInDetailData({ checkInId: "ci-1", clientId: "c1" })
    );

    const keys = mockUseSWR.mock.calls.map((c) => c[0]);
    expect(keys).toContain(
      "/api/clients/c1/nutrition/plan-targets?dates=2026-08-27,2026-08-28"
    );
    expect(result.current.fullWeekTarget).toEqual({
      calories: 13600,
      proteinG: 1030,
      carbsG: 1340,
      fatG: 400,
    });
  });

  it("needs no plan read when every day is logged", () => {
    const logs = [
      "2026-08-22", "2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28",
    ].map((d) => log(d, { targetCalories: 2000, targetProteinG: 150, targetCarbsG: 200, targetFatG: 60 }));
    mockUseWellnessData.mockReturnValue({ logs, habitLogs: [], isLoading: false });
    wireSWR();
    const { result } = renderHook(() =>
      useCheckInDetailData({ checkInId: "ci-1", clientId: "c1" })
    );

    const planTargetKeys = mockUseSWR.mock.calls
      .map((c) => c[0])
      .filter((k) => typeof k === "string" && k.includes("plan-targets"));
    expect(planTargetKeys).toEqual([]);
    expect(result.current.fullWeekTarget).toEqual({
      calories: 14000,
      proteinG: 1050,
      carbsG: 1400,
      fatG: 420,
    });
  });

  it("reports the context as loading only once a window exists", () => {
    wireSWR();
    mockUseWellnessData.mockReturnValue({ logs: [], habitLogs: [], isLoading: true });
    const { result } = renderHook(() =>
      useCheckInDetailData({ checkInId: "ci-1", clientId: "c1" })
    );
    expect(result.current.dailyContextLoading).toBe(true);
    expect(result.current.fullWeekTarget).toBeNull();
  });
});
