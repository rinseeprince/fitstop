import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { mockUseSWR, mutate } = vi.hoisted(() => ({ mockUseSWR: vi.fn(), mutate: vi.fn() }));
vi.mock("swr", () => ({ default: mockUseSWR, useSWRConfig: () => ({ mutate }) }));
vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

import {
  useClearClientGoalHistory,
  useClientGoalHistory,
  useClientGoals,
  useRefreshClientGoalHistory,
  useSeedClientGoals,
} from "./use-client-goals";
import { swrFetcher } from "@/lib/swr-fetcher";
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

describe("the goals table read", () => {
  // A write lands its own answer in the goals read, so only the table beside
  // it is dropped — the next open of it starts from loading, never on the rows
  // the write changed — and the read just seeded is never refetched.
  it("clears the table's read alone and refetches it, leaving the goals read as seeded", () => {
    renderHook(() => useClientGoalHistory("client-6"));
    const historyKey = mockUseSWR.mock.calls[0][0] as string;

    const { result } = renderHook(() => useClearClientGoalHistory());
    void result.current("client-6");

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(historyKey, undefined, { revalidate: true });
    expect(historyKey).toBe("/api/clients/client-6/goals/history");
  });

  // From the table itself: its rows stay until the new ones land, and a
  // refetch that fails says so rather than passing for a refresh.
  it("refreshes the table's read in place, keeping what it holds, and rejects when the refetch fails", async () => {
    const refetch = Promise.resolve({ success: true, data: [] });
    vi.mocked(swrFetcher).mockReturnValue(refetch);
    const { result } = renderHook(() => useRefreshClientGoalHistory());
    await result.current("client-6");

    expect(swrFetcher).toHaveBeenCalledWith("/api/clients/client-6/goals/history");
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith("/api/clients/client-6/goals/history", refetch, { revalidate: false });

    mutate.mockRejectedValueOnce(new Error("timeout"));
    await expect(result.current("client-6")).rejects.toThrow("timeout");
  });

  it("reports a failure only with no rows to show", () => {
    mockUseSWR.mockReturnValue({ data: { success: true, data: [] }, error: new Error("timeout"), isLoading: false, mutate: vi.fn() });
    expect(renderHook(() => useClientGoalHistory("client-6")).result.current.isError).toBe(false);

    mockUseSWR.mockReturnValue({ data: undefined, error: new Error("timeout"), isLoading: false, mutate: vi.fn() });
    expect(renderHook(() => useClientGoalHistory("client-6")).result.current.isError).toBe(true);
  });
});

/**
 * The goals table lists, beside the goals, the programs placed, replaced or
 * ended and the nutrition versions during each, and the habits added,
 * changed, stopped or started again. So every writer of a program's or a
 * version's window clears the table, and so do every goal write made where
 * the table is not on screen and every habit write (CONVENTIONS §7 — the area
 * that owes a clearer is the one that READS what you wrote).
 */
describe("every writer of what the goals table lists clears it", () => {
  const ROOT = join(__dirname, "..");
  // Placement, the plan editor, a start moved, a program deleted, every
  // program deleted, the drawer's save, the nutrition delete, and the Blocks
  // pane's trims and deletes.
  const PLAN_WRITERS = [
    "components/training-library/apply-to-client-dialog.tsx",
    "components/clients/training/calendar/training-calendar-view.tsx",
    "components/clients/training/builder/plan-editor-overlay.tsx",
    "components/clients/training/plan-hero-line.tsx",
    "components/clients/training/training-plan-hero.tsx",
    "components/clients/training/builder/training-builder-right-panel.tsx",
    "hooks/use-nutrition-builder.ts",
    "components/clients/nutrition/builder/nutrition-plan-builder.tsx",
    "components/clients/metrics/blocks/blocks-subtab.tsx",
  ];
  const GOAL_AND_HABIT_WRITERS = [
    "components/clients/goals/use-goal-writes.ts",
    // Sync metrics may set a first goal, from the intake review and its floating panel
    "components/coach/intake-review-actions.tsx",
    "components/coach/floating-intake-panel.tsx",
    // Every coach habit write goes through `useHabitWrites`, whose writes clear
    // the table as each saved answer arrives: the scan in
    // `hooks/use-client-habits.test.ts` fails a screen that writes a habit by itself.
    "hooks/use-client-habits.ts",
  ];

  /** The clearer is not merely taken but CALLED past its declaration. */
  function callsTheClearer(source: string): boolean {
    const bound = /const (\w+) = useClearClientGoalHistory\(\)/.exec(source);
    if (!bound) return false;
    return new RegExp(`\\b${bound[1]}\\(`).test(source.slice(bound.index + bound[0].length));
  }

  it.each(PLAN_WRITERS)("holds for the plan writer %s", (rel) => {
    expect(callsTheClearer(readFileSync(join(ROOT, rel), "utf8"))).toBe(true);
  });

  it.each(GOAL_AND_HABIT_WRITERS)("holds for the goal and habit writer %s", (rel) => {
    expect(callsTheClearer(readFileSync(join(ROOT, rel), "utf8"))).toBe(true);
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
