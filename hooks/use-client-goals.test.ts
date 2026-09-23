import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const { mockUseSWR, mutate } = vi.hoisted(() => ({ mockUseSWR: vi.fn(), mutate: vi.fn() }));
vi.mock("swr", () => ({ default: mockUseSWR, useSWRConfig: () => ({ mutate }) }));
vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

import {
  useClearClientGoalHistory,
  useClientGoalHistory,
  useClientGoals,
  useSeedClientGoals,
} from "./use-client-goals";
import type { ClientGoalsOverview } from "@/types/client-goals";

const OVERVIEW: ClientGoalsOverview = {
  current: null,
  planned: [],
  clientToday: "2026-10-12",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseSWR.mockReturnValue({ data: undefined, error: undefined, isLoading: true, mutate: vi.fn() });
});

describe("useSeedClientGoals", () => {
  // A goal write's own answer lands in the read in the same tick its surface
  // closes (CONVENTIONS §7): written with no refetch, under the key the read
  // subscribes with.
  it("writes the answer under the goals read's own key, with no refetch", () => {
    renderHook(() => useClientGoals("client-6"));
    const readKey = mockUseSWR.mock.calls[0][0] as string;

    const { result } = renderHook(() => useSeedClientGoals());
    void result.current("client-6", OVERVIEW);

    expect(mutate).toHaveBeenCalledWith(readKey, { success: true, data: OVERVIEW }, { revalidate: false });
    expect(readKey).toBe("/api/clients/client-6/goals");
  });
});

describe("useClearClientGoalHistory", () => {
  // A write lands its own answer in the goals read, so only the history beside
  // it is dropped — the next open of it starts from loading, never on the list
  // the write changed — and the read just seeded is never refetched.
  it("drops the history read alone and refetches it, leaving the goals read as seeded", () => {
    renderHook(() => useClientGoalHistory("client-6", true));
    const historyKey = mockUseSWR.mock.calls[0][0] as string;

    const { result } = renderHook(() => useClearClientGoalHistory());
    void result.current("client-6");

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(historyKey, undefined, { revalidate: true });
    expect(historyKey).toBe("/api/clients/client-6/goals/history");
  });
});

describe("useClientGoals", () => {
  // A refetch that fails over goals already on screen leaves them there; the
  // read has failed only when there is nothing to show.
  it("reports a failure only with no goals to show", () => {
    mockUseSWR.mockReturnValue({
      data: { success: true, data: OVERVIEW },
      error: new Error("timeout"),
      isLoading: false,
      mutate: vi.fn(),
    });
    expect(renderHook(() => useClientGoals("client-6")).result.current.isError).toBe(false);

    mockUseSWR.mockReturnValue({ data: undefined, error: new Error("timeout"), isLoading: false, mutate: vi.fn() });
    expect(renderHook(() => useClientGoals("client-6")).result.current.isError).toBe(true);
  });

  it("hands over the client's today once the read lands", () => {
    mockUseSWR.mockReturnValue({
      data: { success: true, data: OVERVIEW },
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });
    const { result } = renderHook(() => useClientGoals("client-6"));

    expect(result.current.clientToday).toBe("2026-10-12");
  });

  it("claims nothing while the read is in flight", () => {
    const { result } = renderHook(() => useClientGoals("client-6"));

    expect(result.current).toMatchObject({ current: null, clientToday: null, isLoading: true });
  });
});
