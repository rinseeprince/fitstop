import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig, type Cache } from "swr";

import { MetricsTabContent } from "./metrics-tab-content";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { Client } from "@/types/check-in";
import type { MeasurementSeries } from "@/types/coach-overview";

// Real SWR, not the mocked hooks the sibling tests use: what this file pins is
// which requests each Journey pane makes, and what a pane shows between the
// Log measurement save and the settled screen — SWR's own behaviour, which a
// mocked hook cannot show.

vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));
// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

let search = new URLSearchParams("journey=body");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => search,
}));

// Presentational and read-free — the chart (recharts) and the log table. The
// hero stays real: its Current cell is how a frame is read below.
vi.mock("./metric-progression-section", () => ({ MetricProgressionSection: () => null }));
vi.mock("./measurement-log-section", () => ({ MeasurementLogSection: () => null }));

const CLIENT_ID = "client-1";
const client = { id: CLIENT_ID, name: "Sam Kalepa", startDate: "2026-03-01" } as Client;

function series(weights: { date: string; value: number; id: string }[]): MeasurementSeries {
  const points = weights.map((w) => ({
    date: w.date,
    value: w.value,
    source: "coach_entry" as const,
    note: null,
    id: w.id,
    recordedAt: `${w.date}T08:00:00Z`,
  }));
  return {
    weight: points,
    bodyFat: [],
    waist: [],
    hips: [],
    chest: [],
    arms: [],
    thighs: [],
    baseline: {},
    startDate: "2026-03-01",
    readings: [],
  };
}

const GOAL = {
  id: "goal-1",
  clientId: CLIENT_ID,
  name: "Lose weight",
  type: "lose_weight",
  targetWeight: 88,
  targetBodyFatPercentage: null,
  description: null,
  startsOn: "2026-09-01",
  source: "coach",
  setBy: null,
  createdAt: "2026-09-01T08:00:00Z",
  updatedAt: "2026-09-01T08:00:00Z",
};

const OLD_SERIES = series([{ date: "2026-09-20", value: 90, id: "m-1" }]);
const NEW_SERIES = series([
  { date: "2026-09-20", value: 90, id: "m-1" },
  { date: "2026-09-21", value: 89.5, id: "m-2" },
]);

/** Every read the tree requested, in order. */
let requested: string[] = [];
/** The series' next answer — swapped by a test for one it resolves by hand. */
let answerSeries: () => Promise<unknown> = () => Promise.resolve({ success: true, data: OLD_SERIES });
/** The goals read and the goals table: none, unless a test sets one. */
let goalsData: { current: unknown; planned: unknown[] } = { current: null, planned: [] };
let historyData: unknown[] = [];

function answer(url: string): Promise<unknown> {
  const path = url.split("?")[0];
  if (path.endsWith("/measurement-series")) return answerSeries();
  if (path.endsWith("/goals")) return Promise.resolve({ success: true, data: goalsData });
  if (path.endsWith("/goals/history")) return Promise.resolve({ success: true, data: historyData });
  if (path.endsWith("/blocks/facts")) return Promise.resolve({ success: true, data: { facts: [] } });
  if (path.endsWith("/blocks")) {
    return Promise.resolve({
      success: true,
      data: { blocks: [], clientToday: "2026-09-21", planStartFloor: "2026-09-21" },
    });
  }
  if (path.endsWith("/check-ins")) {
    return Promise.resolve({ checkIns: [], nextCursor: null, hasMore: false, total: 0 });
  }
  if (path.endsWith("/metric-entries")) return Promise.resolve({ success: true, data: [] });
  if (path.endsWith("/exercise-history")) return Promise.resolve({ success: true, data: [] });
  return Promise.reject(new Error(`unexpected read ${url}`));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// A fresh SWR cache per test, kept across a `rerender` — a pane switch.
function tree(cache: Cache) {
  return (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
      <MetricsTabContent client={client} />
    </SWRConfig>
  );
}

/**
 * The hero's Current cell, as a coach reads it: "90kg"; null while the pane
 * loads (the pending hero has no switcher). `hidden`, because an open modal
 * hides the page behind it from the accessibility tree, and the page behind
 * the dialog is exactly what a frame test reads.
 */
function heroCurrent(): string | null {
  if (!screen.queryByRole("button", { name: "Metric Weight", hidden: true })) return null;
  return screen.getByText("Current").nextElementSibling?.textContent ?? null;
}

const seriesReads = () => requested.filter((url) => url.endsWith("/measurement-series")).length;

async function logWeight(value: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Log measurement" }));
  await user.type(await screen.findByLabelText("Value"), value);
  await user.click(screen.getByRole("button", { name: /log entry/i }));
}

beforeEach(() => {
  cleanup();
  requested = [];
  answerSeries = () => Promise.resolve({ success: true, data: OLD_SERIES });
  goalsData = { current: null, planned: [] };
  historyData = [];
  vi.mocked(swrFetcher).mockImplementation((url: string) => {
    requested.push(url);
    return answer(url) as never;
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }))
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MetricsTabContent — each pane requests only its own reads", () => {
  const PANES: [string, string[]][] = [
    [
      "body",
      [
        `/api/clients/${CLIENT_ID}/blocks`,
        `/api/clients/${CLIENT_ID}/goals`,
        `/api/clients/${CLIENT_ID}/measurement-series`,
      ],
    ],
    [
      "goals",
      [
        `/api/clients/${CLIENT_ID}/goals`,
        `/api/clients/${CLIENT_ID}/goals/history`,
        `/api/clients/${CLIENT_ID}/measurement-series`,
      ],
    ],
    [
      "wellness",
      [
        `/api/clients/${CLIENT_ID}/blocks`,
        `/api/clients/${CLIENT_ID}/check-ins?limit=20`,
        `/api/clients/${CLIENT_ID}/metric-entries`,
      ],
    ],
    ["training", [`/api/clients/${CLIENT_ID}/training/exercise-history?metric=list`]],
    ["blocks", [`/api/clients/${CLIENT_ID}/blocks`, `/api/clients/${CLIENT_ID}/blocks/facts`]],
  ];

  it.each(PANES)("the %s pane", async (pane, reads) => {
    search = new URLSearchParams(`journey=${pane}`);
    render(tree(new Map()));

    await waitFor(() => expect(requested.length).toBeGreaterThanOrEqual(reads.length));
    // Anything a settled pane would request after its first answers lands here
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect([...requested].sort()).toEqual(reads);
  });
});

describe("MetricsTabContent — Log measurement never shows an old reading", () => {
  it("off Physique, it drops the series: Physique then opens loading and shows the new weight, never the old", async () => {
    const cache: Cache = new Map();
    search = new URLSearchParams("journey=body");
    const { rerender } = render(tree(cache));
    await waitFor(() => expect(heroCurrent()).toBe("90kg"));

    // The coach moves to Training and logs a weight there
    search = new URLSearchParams("journey=training");
    rerender(tree(cache));
    await logWeight("89.5");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Nothing on screen reads the series, so nothing refetched it
    expect(seriesReads()).toBe(1);

    const refetch = deferred<unknown>();
    answerSeries = () => refetch.promise;
    search = new URLSearchParams("journey=body");
    rerender(tree(cache));

    // Loading — the pane's own pending hero — and never the 90 it held before
    expect(heroCurrent()).toBeNull();
    expect(screen.getByText("Current").nextElementSibling?.textContent).not.toContain("90");
    await act(async () => {
      refetch.resolve({ success: true, data: NEW_SERIES });
      await refetch.promise;
    });
    await waitFor(() => expect(heroCurrent()).toBe("89.5kg"));
  });

  it("on Goals, it refreshes the pane in place: the old result stays until the new reading lands, then the dialog closes", async () => {
    // Today's goal: lose weight to 88 kg, from 91 kg on its start day
    goalsData = {
      current: { ...GOAL, deadline: null, startReadings: { weight: 91, bodyFat: null } },
      planned: [],
    };
    historyData = [{ ...GOAL, deadline: null, endsOn: null, status: "current", lines: [] }];
    search = new URLSearchParams("journey=goals");
    render(tree(new Map()));
    await waitFor(() => expect(screen.getByText("2.0 kg to go")).toBeInTheDocument());

    const refetch = deferred<unknown>();
    answerSeries = () => refetch.promise;
    await logWeight("89.5");

    // The save has landed and the refetch is in flight: the result as it was,
    // no loading frame, the dialog still open on its spinner
    await waitFor(() => expect(seriesReads()).toBe(2));
    expect(screen.getByText("2.0 kg to go")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await act(async () => {
      refetch.resolve({ success: true, data: NEW_SERIES });
      await refetch.promise;
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("1.5 kg to go")).toBeInTheDocument();
  });

  it("on Physique, it refreshes the pane in place: the old weight stays until the new lands, then the dialog closes", async () => {
    search = new URLSearchParams("journey=body");
    render(tree(new Map()));
    await waitFor(() => expect(heroCurrent()).toBe("90kg"));

    const refetch = deferred<unknown>();
    answerSeries = () => refetch.promise;
    await logWeight("89.5");

    // The save has landed and the refetch is in flight: no loading frame, the
    // dialog still open on its spinner
    await waitFor(() => expect(seriesReads()).toBe(2));
    expect(heroCurrent()).toBe("90kg");
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await act(async () => {
      refetch.resolve({ success: true, data: NEW_SERIES });
      await refetch.promise;
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(heroCurrent()).toBe("89.5kg");
  });
});
