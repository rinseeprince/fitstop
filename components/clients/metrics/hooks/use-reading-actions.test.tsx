import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";

import { useReadingActions } from "./use-reading-actions";
import { useClientGoals } from "@/hooks/use-client-goals";
import { useNutritionOutOfDate } from "@/hooks/use-nutrition-goal";
import { useOverviewBrief } from "@/hooks/use-overview-brief";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { LogRow } from "../metrics-view-types";

// Real SWR: a row action on a weight or body fat refreshes the goals read too,
// because that reading may be the one a goal's progress runs from.

vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

const CLIENT_ID = "client-4";
const GOALS_KEY = `/api/clients/${CLIENT_ID}/goals`;
let reads: string[] = [];

function row(metricId: string): LogRow {
  return {
    id: "reading-3",
    date: "2026-09-14",
    metricId,
    metricName: metricId,
    value: 83.7,
    unit: "kg",
    canonicalValue: 83.7,
    change: null,
    note: null,
    source: "coach_entry",
    sourceId: null,
  } as LogRow;
}

function wrapper({ children }: { children: ReactNode }) {
  return <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>;
}

beforeEach(() => {
  reads = [];
  vi.mocked(swrFetcher).mockImplementation((url: string) => {
    reads.push(url);
    return Promise.resolve({ success: true, data: { current: null, planned: [] } }) as never;
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }))
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useReadingActions — the goals read", () => {
  it.each([
    ["an edited weight", "weight", "update"],
    ["a removed body fat", "bodyFat", "remove"],
    ["a restored weight", "weight", "restore"],
  ] as const)("is refreshed after %s", async (_label, metricId, action) => {
    const { result } = renderHook(
      () => ({ goals: useClientGoals(CLIENT_ID), actions: useReadingActions(CLIENT_ID) }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.goals.isLoading).toBe(false));
    await act(async () => {
      if (action === "update") await result.current.actions.update(row(metricId), 82.9);
      else await result.current.actions[action](row(metricId));
    });
    await waitFor(() => expect(reads.filter((url) => url === GOALS_KEY)).toHaveLength(2));
  });

  it("is left alone after a girth", async () => {
    const { result } = renderHook(
      () => ({ goals: useClientGoals(CLIENT_ID), actions: useReadingActions(CLIENT_ID) }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.goals.isLoading).toBe(false));
    await act(() => result.current.actions.remove(row("waist")));
    expect(reads.filter((url) => url === GOALS_KEY)).toHaveLength(1);
  });
});

// The Overview's "Since your last visit" lists the coach's readings — a removed
// one leaves it, an edited one changes, a restored one returns — so every row
// action clears its reads, whatever the metric.
describe("useReadingActions — the Overview", () => {
  const BRIEF_KEY = `/api/clients/${CLIENT_ID}/overview-brief`;

  it.each([
    ["an edited girth", "waist", "update"],
    ["a removed weight", "weight", "remove"],
    ["a restored body fat", "bodyFat", "restore"],
  ] as const)("is cleared after %s: it drops what it held while it fetches again", async (_label, metricId, action) => {
    const { result } = renderHook(
      () => ({ overview: useOverviewBrief(CLIENT_ID), actions: useReadingActions(CLIENT_ID) }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.overview.brief).not.toBeNull());

    // Hold the refetch, so the frame between the clear and the answer can be read
    vi.mocked(swrFetcher).mockImplementation((url: string) => {
      reads.push(url);
      return (
        url === BRIEF_KEY
          ? new Promise(() => {})
          : Promise.resolve({ success: true, data: { current: null, planned: [] } })
      ) as never;
    });
    await act(async () => {
      if (action === "update") await result.current.actions.update(row(metricId), 82.4);
      else await result.current.actions[action](row(metricId));
    });

    expect(result.current.overview.brief).toBeNull();
    expect(reads.filter((url) => url === BRIEF_KEY)).toHaveLength(2);
  });
});

// docs/MEASUREMENT-LOG-PLAN.md commit 8d1: the nutrition drawer prices from the
// newest weight and the energy pair, so a weight or body-fat action clears how
// nutrition follows the goal — and a girth leaves it alone.
describe("useReadingActions — how nutrition follows the goal", () => {
  const OUT_OF_DATE_KEY = `/api/clients/${CLIENT_ID}/nutrition/goal/out-of-date`;

  it("is cleared after a weight or body-fat action", async () => {
    const { result } = renderHook(
      () => ({ rule: useNutritionOutOfDate(CLIENT_ID), actions: useReadingActions(CLIENT_ID) }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.rule.isLoading).toBe(false));
    await act(async () => {
      await result.current.actions.update(row("bodyFat"), 21.4);
    });
    await waitFor(() => expect(reads.filter((url) => url === OUT_OF_DATE_KEY)).toHaveLength(2));
  });

  it("is left alone after a girth", async () => {
    const { result } = renderHook(
      () => ({ rule: useNutritionOutOfDate(CLIENT_ID), actions: useReadingActions(CLIENT_ID) }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.rule.isLoading).toBe(false));
    await act(() => result.current.actions.remove(row("hips")));
    expect(reads.filter((url) => url === OUT_OF_DATE_KEY)).toHaveLength(1);
  });
});
