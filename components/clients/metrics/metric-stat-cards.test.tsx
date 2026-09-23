import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, screen, within, cleanup } from "@testing-library/react";

import { MetricStatCards, MetricStatCardsPending } from "./metric-stat-cards";
import { usePhysiqueMetrics, useWellnessMetrics } from "./hooks/use-merged-metrics";
import { addDaysToDate } from "@/utils/metric-points";
import type { Client } from "@/types/check-in";
import type {
  MeasurementSeries,
  MeasurementSeriesPoint,
  WellnessSeries,
} from "@/types/coach-overview";

// The three cards, from the series through the pane's hook, one fixture per
// way a client logs. Every card keeps its label and its window whatever the
// data: an empty window says so, and nothing falls back to one entry.

type Goal = {
  type: "lose_weight" | "recomposition";
  targetWeight: number | null;
  targetBodyFatPercentage: number | null;
  deadline: null;
  startReadings: { weight: number | null; bodyFat: number | null };
};
type GoalsState = { current: Goal | null; isLoading: boolean; isError: boolean };

let measurements: MeasurementSeries;
let wellness: WellnessSeries;
let goals: GoalsState;

vi.mock("@/hooks/use-measurement-series", () => ({
  useMeasurementSeries: () => ({ series: measurements, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/use-wellness-series", () => ({
  useWellnessSeries: () => ({ series: wellness, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/use-client-goals", () => ({ useClientGoals: () => goals }));
// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));
// The device is a day ahead of the client; the cards never read it.
vi.mock("@/lib/date-helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/date-helpers")>()),
  getTodayDateString: () => "2026-09-18",
}));

// The client's today. The last 7 days are 11–17 Sep and the 7 before them
// 4–10 Sep; the last 30 days 19 Aug–17 Sep and the 30 before them 20 Jul–18 Aug.
const TODAY = "2026-09-17";
const client = { id: "client-1", startDate: null } as unknown as Client;

const reading = (date: string, value: number): MeasurementSeriesPoint => ({
  date,
  value,
  source: "coach_entry",
  note: null,
  id: `m-${date}`,
  recordedAt: `${date}T07:00:00+00:00`,
});

function measurementSeries(overrides: Partial<MeasurementSeries>): MeasurementSeries {
  return {
    weight: [],
    bodyFat: [],
    waist: [],
    hips: [],
    chest: [],
    arms: [],
    thighs: [],
    baseline: {},
    startDate: null,
    readings: [],
    clientToday: TODAY,
    ...overrides,
  };
}

const logged = (date: string, value: number) => ({
  date,
  value,
  id: `w-${date}`,
  recordedAt: `${date}T21:00:00+00:00`,
});

/** The cards of one metric of a pane, as the pane renders them. */
function renderCards(pane: "physique" | "wellness", metricId: string) {
  const { result } = renderHook(() =>
    pane === "physique" ? usePhysiqueMetrics(client) : useWellnessMetrics(client.id)
  );
  const metric = result.current.metrics.find((m) => m.id === metricId)!;
  const { container } = render(<MetricStatCards metric={metric} />);
  const [first, second, third] = Array.from(container.firstElementChild!.children) as HTMLElement[];
  return { first, second, third };
}

// The goal in force: a cut to 76.5 kg, begun at 91.3
const CUT: Goal = {
  type: "lose_weight",
  targetWeight: 76.5,
  targetBodyFatPercentage: null,
  deadline: null,
  startReadings: { weight: 91.3, bodyFat: null },
};

beforeEach(() => {
  cleanup();
  goals = { current: CUT, isLoading: false, isError: false };
  wellness = { mood: [], energy: [], sleep: [], stress: [], soreness: [], clientToday: TODAY };
});

describe("MetricStatCards — the same three cards for every way a client logs", () => {
  it("a client who weighs in daily", () => {
    // Every day from 20 Jul to 17 Sep, 91.0 falling 0.2 a day to 79.2
    const weight = Array.from({ length: 60 }, (_, i) =>
      reading(addDaysToDate("2026-07-20", i), Number((91 - 0.2 * i).toFixed(1)))
    );
    measurements = measurementSeries({ weight });

    const { first, second, third } = renderCards("physique", "weight");

    expect(within(first).getByText("Last 7 days")).toBeInTheDocument();
    expect(within(first).getByText("79.8")).toBeInTheDocument();
    expect(within(first).getByText("-1.4")).toBeInTheDocument();
    expect(within(first).getByText("vs 81.2 the 7 days before")).toBeInTheDocument();
    expect(within(first).getByText("from 7 entries")).toBeInTheDocument();

    expect(within(second).getByText("Last 30 days")).toBeInTheDocument();
    expect(within(second).getByText("82.1")).toBeInTheDocument();
    expect(within(second).getByText("-6.0")).toBeInTheDocument();
    expect(within(second).getByText("vs 88.1 the 30 days before")).toBeInTheDocument();
    expect(within(second).getByText("from 30 entries")).toBeInTheDocument();

    expect(within(third).getByText("Goal")).toBeInTheDocument();
    expect(within(third).getByText("76.5")).toBeInTheDocument();
    expect(within(third).getByText("2.7 kg to go")).toBeInTheDocument();
  });

  it("a client who weighs in two or three times a week", () => {
    measurements = measurementSeries({
      weight: [
        reading("2026-07-21", 86.4),
        reading("2026-07-25", 86.1),
        reading("2026-07-29", 85.9),
        reading("2026-08-01", 85.5),
        reading("2026-08-05", 85.8),
        reading("2026-08-08", 85.3),
        reading("2026-08-12", 85.0),
        reading("2026-08-15", 84.7),
        reading("2026-08-19", 84.9),
        reading("2026-08-22", 84.4),
        reading("2026-08-26", 84.6),
        reading("2026-08-29", 84.2),
        reading("2026-09-02", 83.5),
        reading("2026-09-05", 83.9),
        reading("2026-09-09", 83.3),
        reading("2026-09-12", 83.1),
        reading("2026-09-14", 82.7),
        reading("2026-09-16", 82.6),
      ],
    });

    const { first, second, third } = renderCards("physique", "weight");

    // (83.1 + 82.7 + 82.6) / 3 = 82.8, against (83.9 + 83.3) / 2 = 83.6
    expect(within(first).getByText("Last 7 days")).toBeInTheDocument();
    expect(within(first).getByText("82.8")).toBeInTheDocument();
    expect(within(first).getByText("-0.8")).toBeInTheDocument();
    expect(within(first).getByText("vs 83.6 the 7 days before")).toBeInTheDocument();
    expect(within(first).getByText("from 3 entries")).toBeInTheDocument();

    // 837.2 / 10 = 83.72, shown 83.7, against 684.7 / 8 = 85.59, shown 85.6
    expect(within(second).getByText("Last 30 days")).toBeInTheDocument();
    expect(within(second).getByText("83.7")).toBeInTheDocument();
    expect(within(second).getByText("-1.9")).toBeInTheDocument();
    expect(within(second).getByText("vs 85.6 the 30 days before")).toBeInTheDocument();
    expect(within(second).getByText("from 10 entries")).toBeInTheDocument();

    expect(within(third).getByText("Goal")).toBeInTheDocument();
    expect(within(third).getByText("6.1 kg to go")).toBeInTheDocument();
  });

  it("a client who stopped logging: two stragglers after a gap, nothing this fortnight", () => {
    measurements = measurementSeries({
      weight: [
        reading("2026-05-04", 88.3),
        reading("2026-05-11", 87.9),
        reading("2026-06-01", 87.4),
        reading("2026-06-08", 87.1),
        reading("2026-08-15", 86.2),
        reading("2026-08-28", 86.8),
      ],
    });

    const { first, second, third } = renderCards("physique", "weight");

    expect(within(first).getByText("Last 7 days")).toBeInTheDocument();
    expect(within(first).getByText("No entries in the last 7 days")).toBeInTheDocument();
    expect(within(first).queryByText(/entr(y|ies)$/)).not.toBeInTheDocument();

    // One entry each side: an average of one, and it says so
    expect(within(second).getByText("Last 30 days")).toBeInTheDocument();
    expect(within(second).getByText("86.8")).toBeInTheDocument();
    expect(within(second).getByText("+0.6")).toBeInTheDocument();
    expect(within(second).getByText("vs 86.2 the 30 days before")).toBeInTheDocument();
    expect(within(second).getByText("from 1 entry")).toBeInTheDocument();

    expect(within(third).getByText("Goal")).toBeInTheDocument();
    expect(within(third).getByText("10.3 kg to go")).toBeInTheDocument();
    expect(screen.queryByText("Latest")).not.toBeInTheDocument();
  });

  it("a client with less than 30 days of history", () => {
    measurements = measurementSeries({
      weight: [
        reading("2026-09-05", 84.3),
        reading("2026-09-08", 84.9),
        reading("2026-09-11", 83.8),
        reading("2026-09-14", 83.4),
        reading("2026-09-16", 83.2),
      ],
    });

    const { first, second, third } = renderCards("physique", "weight");

    // (83.8 + 83.4 + 83.2) / 3 = 83.47, shown 83.5, against (84.3 + 84.9) / 2 = 84.6
    expect(within(first).getByText("Last 7 days")).toBeInTheDocument();
    expect(within(first).getByText("83.5")).toBeInTheDocument();
    expect(within(first).getByText("-1.1")).toBeInTheDocument();
    expect(within(first).getByText("vs 84.6 the 7 days before")).toBeInTheDocument();
    expect(within(first).getByText("from 3 entries")).toBeInTheDocument();

    // 419.6 / 5 = 83.92, shown 83.9 — nothing the 30 days before to compare with
    expect(within(second).getByText("Last 30 days")).toBeInTheDocument();
    expect(within(second).getByText("83.9")).toBeInTheDocument();
    expect(within(second).getByText("no entries the 30 days before")).toBeInTheDocument();
    expect(within(second).getByText("from 5 entries")).toBeInTheDocument();
    expect(within(second).queryByText(/^vs /)).not.toBeInTheDocument();

    expect(within(third).getByText("Goal")).toBeInTheDocument();
    expect(within(third).getByText("6.7 kg to go")).toBeInTheDocument();
    expect(screen.queryByText("Latest")).not.toBeInTheDocument();
  });
});

describe("MetricStatCards — card 3 is fixed per metric", () => {
  it("a wellness score: its lowest of the last 30 days, and the day it was logged", () => {
    wellness = {
      ...wellness,
      // 17 Aug's 1 is before the window; the best, 9, is not the card
      sleep: [
        logged("2026-08-17", 1),
        logged("2026-08-24", 7),
        logged("2026-09-03", 4),
        logged("2026-09-10", 9),
        logged("2026-09-15", 6),
      ],
    };

    const { third } = renderCards("wellness", "sleep");

    expect(within(third).getByText("Lowest in 30 days")).toBeInTheDocument();
    expect(within(third).getByText("4")).toBeInTheDocument();
    expect(within(third).getByText("on 3 Sept")).toBeInTheDocument();
    expect(screen.queryByText("Best")).not.toBeInTheDocument();
  });

  it("stress and soreness: the highest of the last 30 days", () => {
    wellness = {
      ...wellness,
      stress: [logged("2026-08-21", 5), logged("2026-09-06", 8), logged("2026-09-13", 2)],
    };

    const { third } = renderCards("wellness", "stress");

    expect(within(third).getByText("Highest in 30 days")).toBeInTheDocument();
    expect(within(third).getByText("8")).toBeInTheDocument();
    expect(within(third).getByText("on 6 Sept")).toBeInTheDocument();
  });

  it("a wellness score with nothing logged in the last 30 days says so", () => {
    wellness = { ...wellness, energy: [logged("2026-07-02", 3)] };

    const { third } = renderCards("wellness", "energy");

    expect(within(third).getByText("Lowest in 30 days")).toBeInTheDocument();
    expect(within(third).getByText("No entries in the last 30 days")).toBeInTheDocument();
  });

  it("a girth: the last 90 days against the 90 before", () => {
    measurements = measurementSeries({
      waist: [reading("2026-04-11", 92.6), reading("2026-07-04", 90.3), reading("2026-08-30", 89.1)],
    });

    const { third } = renderCards("physique", "waist");

    // (90.3 + 89.1) / 2 = 89.7, against 92.6 — the last 90 days are 20 Jun–17 Sep
    expect(within(third).getByText("Last 90 days")).toBeInTheDocument();
    expect(within(third).getByText("89.7")).toBeInTheDocument();
    expect(within(third).getByText("-2.9")).toBeInTheDocument();
    expect(within(third).getByText("vs 92.6 the 90 days before")).toBeInTheDocument();
    expect(within(third).getByText("from 2 entries")).toBeInTheDocument();
  });

  it("body fat with a goal that sets no target for it: No target", () => {
    measurements = measurementSeries({ bodyFat: [reading("2026-09-09", 21.4)] });

    const { third } = renderCards("physique", "bodyFat");

    expect(within(third).getByText("Goal")).toBeInTheDocument();
    expect(within(third).getByText("No target")).toBeInTheDocument();
  });

  it("body fat with a target: the percent binds to the number", () => {
    goals = {
      current: {
        type: "recomposition",
        targetWeight: null,
        targetBodyFatPercentage: 18.5,
        deadline: null,
        startReadings: { weight: null, bodyFat: 23.7 },
      },
      isLoading: false,
      isError: false,
    };
    measurements = measurementSeries({ bodyFat: [reading("2026-09-09", 21.4)] });

    const { third } = renderCards("physique", "bodyFat");

    expect(within(third).getByText("18.5")).toBeInTheDocument();
    expect(within(third).getByText("2.9% to go")).toBeInTheDocument();
  });

  it("a weight past its target says so, as the Overview's goal card does", () => {
    measurements = measurementSeries({ weight: [reading("2026-09-12", 77.4), reading("2026-09-16", 75.9)] });

    const { third } = renderCards("physique", "weight");

    expect(within(third).getByText("76.5")).toBeInTheDocument();
    expect(within(third).getByText("0.6 kg under goal")).toBeInTheDocument();
  });

  it("the goal card claims nothing while the goals read is in flight, and says when it failed", () => {
    measurements = measurementSeries({ weight: [reading("2026-09-09", 80.7)] });
    goals = { current: null, isLoading: true, isError: false };

    const pending = renderCards("physique", "weight").third;
    expect(within(pending).getByText("Goal")).toBeInTheDocument();
    expect(within(pending).queryByText("No target")).not.toBeInTheDocument();
    expect(pending.querySelector("[data-slot='skeleton']")).not.toBeNull();

    cleanup();
    goals = { current: null, isLoading: false, isError: true };
    const failed = renderCards("physique", "weight").third;
    expect(within(failed).getByText("Couldn't load the goal")).toBeInTheDocument();
    expect(within(failed).queryByText("No target")).not.toBeInTheDocument();
  });
});

describe("MetricStatCardsPending — before the series lands", () => {
  it("draws the three cards with their labels and claims nothing", () => {
    const { container } = render(<MetricStatCardsPending cardThree="highest" />);

    expect(screen.getByText("Last 7 days")).toBeInTheDocument();
    expect(screen.getByText("Last 30 days")).toBeInTheDocument();
    expect(screen.getByText("Highest in 30 days")).toBeInTheDocument();
    expect(screen.queryByText(/No entries|No target|from \d/)).not.toBeInTheDocument();
    // A value and two lines under it on every card, each pending
    expect(container.querySelectorAll("[data-slot='skeleton']")).toHaveLength(9);
  });
});
