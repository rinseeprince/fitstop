import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const { swr } = vi.hoisted(() => ({
  swr: vi.fn((..._args: unknown[]) => ({ data: undefined, error: undefined, isLoading: false, mutate: vi.fn() })),
}));
vi.mock("swr", () => ({
  __esModule: true,
  default: (...args: unknown[]) => swr(...args),
  useSWRConfig: () => ({ cache: new Map(), mutate: vi.fn() }),
}));
vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

import { isClientHabitsAreaKey } from "./use-client-habit-entries";
import {
  clientHabitDayKey,
  clientHabitProgressKey,
  useClientHabitDayEntries,
  useClientHabitProgress,
} from "./use-client-portal-habits";
import { clientDaySummaryKey } from "./use-client-training-data";

// The client's habit reads and their area (CONVENTIONS §7: a key builder and
// a matcher for the area). The entry writes run over a real SWR cache in
// `use-client-portal-habits.writes.test.tsx`: what they guard — SWR dropping a
// read a landing overtakes, an answer landing on its own habit — is SWR's own
// behaviour, which a mocked `mutate` cannot show.

const DATE = "2026-09-29";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the keys", () => {
  it("reads the day and the Journey under the client's habit area", () => {
    expect(clientHabitDayKey(DATE)).toBe("/api/client/habits/day?date=2026-09-29");
    expect(clientHabitProgressKey(8)).toBe("/api/client/habits/progress?weeks=8");
    renderHook(() => useClientHabitDayEntries(DATE));
    renderHook(() => useClientHabitProgress(8));
    expect(swr.mock.calls.map((call) => call[0])).toEqual([clientHabitDayKey(DATE), clientHabitProgressKey(8)]);
  });

  it("the area is every habit read of the client and nothing else", () => {
    expect(isClientHabitsAreaKey(clientHabitDayKey(DATE))).toBe(true);
    expect(isClientHabitsAreaKey(clientHabitProgressKey(8))).toBe(true);
    expect(isClientHabitsAreaKey("/api/client/habits/week?start=2026-09-24&end=2026-09-30")).toBe(true);
    expect(isClientHabitsAreaKey(clientDaySummaryKey(DATE))).toBe(false);
    expect(isClientHabitsAreaKey("/api/clients/c1/habits")).toBe(false);
    expect(isClientHabitsAreaKey(undefined)).toBe(false);
  });
});
