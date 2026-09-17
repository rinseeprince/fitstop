import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { PlanForEditing } from "@/services/plan-edit-service";

const mutateMock = vi.fn();
type SubscribeResult = { data: unknown; error: unknown; isLoading: boolean; mutate: () => void };
const swrSubscribeMock = vi.fn(
  (..._args: unknown[]): SubscribeResult => ({
    data: undefined,
    error: undefined,
    isLoading: false,
    mutate: vi.fn(),
  }),
);

vi.mock("swr", () => ({
  __esModule: true,
  default: (...args: unknown[]) => swrSubscribeMock(...args),
  useSWRConfig: () => ({ mutate: mutateMock }),
}));

vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

import { planEditKey, usePlanEdit } from "./use-plan-edit";

const KEY = "/api/clients/client-1/training/plan-1/edit";

function makeRead(): PlanForEditing {
  return {
    plan: {
      id: "plan-1",
      name: "PPL Block",
      splitType: null,
      effectiveFrom: "2026-07-15",
      effectiveUntil: "2026-07-21",
    },
    clientToday: "2026-07-17",
    firstEditableDate: "2026-07-17",
    limit: null,
    days: Array.from({ length: 7 }, (_, i) => ({
      date: `2026-07-${15 + i}`,
      sessions: [],
    })),
    version: "v-1",
  };
}

beforeEach(() => {
  mutateMock.mockClear();
  swrSubscribeMock.mockClear();
});

describe("usePlanEdit", () => {
  it("keys the read on the client and the plan", () => {
    expect(planEditKey("client-1", "plan-1")).toBe(KEY);
    renderHook(() => usePlanEdit("client-1", "plan-1"));
    expect(swrSubscribeMock.mock.calls[0][0]).toBe(KEY);
  });

  it("keys nothing without both ids, and drops nothing when it goes", () => {
    const noClient = renderHook(() => usePlanEdit(null, "plan-1"));
    const noPlan = renderHook(() => usePlanEdit("client-1", null));
    expect(swrSubscribeMock.mock.calls.map((call) => call[0])).toEqual([null, null]);
    noClient.unmount();
    noPlan.unmount();
    expect(mutateMock).not.toHaveBeenCalled();
  });

  // A cleanup is not always a close: StrictMode runs it on every mount in
  // development, and a coach can close and reopen before the first read lands.
  // Clearing with a revalidate makes an editor still reading fetch its own copy
  // while, with nothing reading, nothing is fetched.
  it("on unmount, clears the entry and revalidates, so the next open reads the calendar afresh", () => {
    const { unmount } = renderHook(() => usePlanEdit("client-1", "plan-1"));
    expect(mutateMock).not.toHaveBeenCalled();

    unmount();
    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock).toHaveBeenCalledWith(KEY, undefined, { revalidate: true });
  });

  it("hands back the response's data as planForEditing, and null before it lands", () => {
    const pending = renderHook(() => usePlanEdit("client-1", "plan-1"));
    expect(pending.result.current.planForEditing).toBeNull();
    pending.unmount();

    const read = makeRead();
    swrSubscribeMock.mockReturnValueOnce({
      data: { success: true, data: read },
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });
    const { result } = renderHook(() => usePlanEdit("client-1", "plan-1"));
    expect(result.current.planForEditing).toBe(read);
  });
});
