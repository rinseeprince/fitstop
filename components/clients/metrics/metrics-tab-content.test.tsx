import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MetricsTabContent } from "./metrics-tab-content";
import { addDaysToDate } from "@/utils/metric-points";
import type { LogRow, MetricSummary } from "./metrics-view-types";
import type { Client } from "@/types/check-in";

// The URL is the state under test (CONVENTIONS §7): the mocked router writes
// it and the mocked reader hands it back, so a test drives the real switcher
// and the real pane bar and reads the page the way a coach would. A rerender
// after a write is the router's own re-render.
let search = new URLSearchParams("journey=body");
const replace = vi.fn((url: string) => {
  search = new URLSearchParams(url.replace(/^\?/, ""));
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => search,
}));

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("./hooks/use-reading-actions", () => ({
  useReadingActions: () => ({ correct: vi.fn(), remove: vi.fn(), restore: vi.fn() }),
}));
vi.mock("./hooks/use-client-blocks", () => ({
  useClientBlocks: () => ({ blocks: [], clientToday: null, isLoading: false, isError: false }),
}));
// The chart section is the sibling under its own tests; the hero's switcher
// and the log are what this file drives.
vi.mock("./metric-progression-section", () => ({
  MetricProgressionSection: () => null,
}));
// Read lazily, at render: the factory is hoisted above the fixtures below.
vi.mock("./hooks/use-merged-metrics", () => ({
  useMergedMetrics: () => ({
    metricsByTab: METRICS_BY_TAB,
    logRowsByTab: LOG_ROWS_BY_TAB,
    isLoading: false,
    isError: false,
    logMeasurement: vi.fn(),
  }),
}));

function metric(id: string, name: string, tab: "body" | "wellness", unit: string): MetricSummary {
  return {
    id,
    name,
    tab,
    unit,
    points: [],
    latest: null,
    first: null,
    entryCount: 0,
    frequencyLabel: null,
    totalChange: null,
    startsOn: null,
    avgRate: null,
    change30d: null,
    week: null,
    goal: null,
    goalToGo: null,
    best: null,
  };
}

function row(
  id: string,
  date: string,
  value: number,
  metricId: string,
  metricName: string,
  unit: string,
  isMeasurement = true
): LogRow {
  return {
    id,
    date,
    metricId,
    metricName,
    value,
    unit,
    canonicalValue: value,
    change: null,
    note: null,
    source: "check_in",
    sourceId: null,
    isMeasurement,
    voided: null,
    isCurrent: false,
    isBaseline: false,
    beforeStart: false,
  };
}

// Sleep is the Wellness pane's DEFAULT_FOCUS and deliberately not its first
// metric, so "derives to the pane default" and "falls to the first" differ.
const METRICS_BY_TAB = {
  body: [metric("weight", "Weight", "body", "kg"), metric("waist", "Waist", "body", "cm")],
  wellness: [metric("mood", "Mood", "wellness", "/5"), metric("sleep", "Sleep", "wellness", "/10")],
};

// Twelve weight readings — a full page and two over — beside three waist ones.
const WEIGHT_ROWS: LogRow[] = Array.from({ length: 12 }, (_, i) => {
  const week = 11 - i;
  return row(`m-${week + 1}`, addDaysToDate("2026-03-01", week * 7), 90 - week * 0.5, "weight", "Weight", "kg");
});
const WAIST_ROWS: LogRow[] = [
  row("w-3", "2026-05-10", 79.1, "waist", "Waist", "cm"),
  row("w-2", "2026-04-12", 79.7, "waist", "Waist", "cm"),
  row("w-1", "2026-03-15", 80.2, "waist", "Waist", "cm"),
];
const LOG_ROWS_BY_TAB = {
  body: [...WEIGHT_ROWS, ...WAIST_ROWS],
  wellness: [
    row("mood|2026-08-14", "2026-08-14", 4, "mood", "Mood", "/5", false),
    row("sleep|2026-08-14", "2026-08-14", 7, "sleep", "Sleep", "/10", false),
  ],
};

const client = { id: "client-1", name: "Sam Kalepa", startDate: "2026-03-01" } as Client;

// The hero's switcher trigger: eyebrow + the selected metric's name.
const switcher = (name: string) => screen.getByRole("button", { name: `Metric ${name}` });

beforeEach(() => {
  cleanup();
  replace.mockClear();
  search = new URLSearchParams("journey=body");
});

// docs/MEASUREMENT-LOG-PLAN.md commit 6: the selected metric is Journey's
// ?metric= param — the subject the hero, the chart and the log all describe.
describe("MetricsTabContent — the selected metric lives in the URL", () => {
  it("resolves ?metric= on the first render: the hero and the log are that metric's", () => {
    search = new URLSearchParams("journey=body&metric=waist");
    render(<MetricsTabContent client={client} />);

    expect(switcher("Waist")).toBeInTheDocument();
    expect(screen.getByText("Showing 3 of 3 waist entries")).toBeInTheDocument();
    expect(screen.queryByText("90")).not.toBeInTheDocument();
  });

  it("derives an unknown value, or the other pane's metric, to the pane default", () => {
    search = new URLSearchParams("journey=body&metric=nope");
    const { rerender } = render(<MetricsTabContent client={client} />);
    expect(switcher("Weight")).toBeInTheDocument();
    expect(screen.getByText("Showing 10 of 12 weight entries")).toBeInTheDocument();

    search = new URLSearchParams("journey=wellness&metric=waist");
    rerender(<MetricsTabContent client={client} />);
    // The pane default, Sleep — not the first metric of the list, Mood.
    expect(switcher("Sleep")).toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 1 sleep entries")).toBeInTheDocument();
  });

  it("the switcher writes ?metric= and nothing else; the log follows the URL", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MetricsTabContent client={client} />);
    expect(screen.getByText("Showing 10 of 12 weight entries")).toBeInTheDocument();

    await user.click(switcher("Weight"));
    await user.click(await screen.findByRole("menuitem", { name: /^Waist/ }));

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("?journey=body&metric=waist", { scroll: false });
    rerender(<MetricsTabContent client={client} />);
    expect(switcher("Waist")).toBeInTheDocument();
    expect(screen.getByText("Showing 3 of 3 waist entries")).toBeInTheDocument();
  });

  it("a pane switch drops the metric in the same navigation", async () => {
    const user = userEvent.setup();
    search = new URLSearchParams("journey=body&metric=waist");
    const { rerender } = render(<MetricsTabContent client={client} />);

    await user.click(screen.getByRole("button", { name: "Wellness" }));

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("?journey=wellness", { scroll: false });
    rerender(<MetricsTabContent client={client} />);
    expect(switcher("Sleep")).toBeInTheDocument();
  });

  it("returns the log to page 1 when the metric changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MetricsTabContent client={client} />);

    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Showing 2 of 12 weight entries")).toBeInTheDocument();

    search = new URLSearchParams("journey=body&metric=waist");
    rerender(<MetricsTabContent client={client} />);
    expect(screen.getByText("Showing 3 of 3 waist entries")).toBeInTheDocument();
  });
});
