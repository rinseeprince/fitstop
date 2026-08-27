import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  ClientLayoutError,
  clientDaySummaryKey,
  clientTrainingWeekKey,
  isClientTrainingAreaKey,
  useApplyClientLayout,
} from "./use-client-training-data";

// The key builders and the area matcher are the contract (CONVENTIONS §7):
// a key the builder produces must be one the invalidator matches, and the
// matcher must cover the AREA, not one endpoint.
describe("client training-area SWR keys", () => {
  it("builds the day-summary and week keys the routes serve", () => {
    expect(clientDaySummaryKey("2026-08-26")).toBe("/api/client/day-summary?date=2026-08-26");
    expect(clientTrainingWeekKey("2026-08-26")).toBe("/api/client/training/week?date=2026-08-26");
  });

  it("matches every key the builders produce, for any date", () => {
    expect(isClientTrainingAreaKey(clientDaySummaryKey("2026-08-26"))).toBe(true);
    expect(isClientTrainingAreaKey(clientDaySummaryKey("2027-01-01"))).toBe(true);
    expect(isClientTrainingAreaKey(clientTrainingWeekKey("2026-08-30"))).toBe(true);
  });

  it("leaves other areas and non-string keys alone", () => {
    expect(isClientTrainingAreaKey("/api/client/nutrition-plan")).toBe(false);
    expect(isClientTrainingAreaKey("/api/client/daily-logs/2026-08-26/nutrition")).toBe(false);
    expect(isClientTrainingAreaKey(null)).toBe(false);
    expect(isClientTrainingAreaKey(["/api/client/day-summary", "x"])).toBe(false);
  });
});

// The writer's refusal carries the status: the week view shows a Reload
// affordance on 409 (drift / a day taken since the week was read) and only
// the sentence on 400 (a rule of the client's own calendar).
describe("useApplyClientLayout", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("throws the server's sentence with its status on a refusal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 409,
          json: () =>
            Promise.resolve({
              success: false,
              error: "Your week changed since you opened it — reload and try again",
            }),
        }),
      ),
    );
    const { result } = renderHook(() => useApplyClientLayout());

    const attempt = result.current([
      { eventId: "ev-thu", fromDate: "2026-08-27", toDate: "2026-08-29" },
    ]);
    await expect(attempt).rejects.toBeInstanceOf(ClientLayoutError);
    await expect(attempt).rejects.toMatchObject({
      status: 409,
      message: "Your week changed since you opened it — reload and try again",
    });
  });

  it("POSTs the moves as one layout and resolves with what moved", async () => {
    const moves = [{ eventId: "ev-thu", fromDate: "2026-08-27", toDate: "2026-08-29" }];
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: { moved: moves } }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useApplyClientLayout());

    await expect(result.current(moves)).resolves.toEqual({ moved: moves });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/client/training/events/layout");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ moves });
  });
});
