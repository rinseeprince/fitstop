import { cloneElement, isValidElement, type ReactElement } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProgressionChart } from "./progression-chart";
import type { EffectiveGoal } from "@/lib/goals/resolve-effective-goal";
import type { MeasurementSeries } from "@/types/coach-overview";

const unitPreference = { value: "metric" as "metric" | "imperial" };

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: unitPreference.value, isLoading: false, error: null }),
}));

// recharts measures its container, and jsdom reports every element as 0x0, so
// ResponsiveContainer hands its child a width of zero and the chart renders
// nothing. Passing a real size lets the chart's own SVG mount, so these assert
// against a real render rather than a stub.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
      isValidElement(children)
        ? cloneElement(children as ReactElement<{ width: number; height: number }>, {
            width: 560,
            height: 104,
          })
        : null,
  };
});

const NO_GOAL: EffectiveGoal = {
  goalWeightKg: null,
  goalBodyFatPercentage: null,
  deadline: null,
  startDate: "2026-07-01",
};

/** A weekly weigh-in series — what a real client actually produces. */
const WEEKLY: MeasurementSeries = {
  weight: [
    { date: "2026-07-06", value: 90 },
    { date: "2026-07-13", value: 89.4 },
    { date: "2026-07-20", value: 88.9 },
    { date: "2026-07-27", value: 88.2 },
  ],
  bodyFat: [
    { date: "2026-07-06", value: 24 },
    { date: "2026-07-27", value: 22.6 },
  ],
};

const PROPS = {
  series: WEEKLY,
  isLoading: false,
  metric: "weight" as const,
  onMetricChange: vi.fn(),
  goal: NO_GOAL,
  windowDays: 30,
};

beforeEach(() => {
  cleanup();
  unitPreference.value = "metric";
});

describe("ProgressionChart", () => {
  it("leads with the latest reading and its unit", () => {
    render(<ProgressionChart {...PROPS} />);

    expect(screen.getByText("88.2")).toBeInTheDocument();
    expect(screen.getByText("kg")).toBeInTheDocument();
  });

  it("states the rate per week from the smoothed series", () => {
    render(<ProgressionChart {...PROPS} />);

    expect(screen.getByText(/kg\/wk/)).toBeInTheDocument();
  });

  it("refuses a rate under two points, rather than extrapolating one", () => {
    render(
      <ProgressionChart
        {...PROPS}
        series={{ weight: [{ date: "2026-07-27", value: 88.2 }], bodyFat: [] }}
      />
    );

    expect(screen.getByText("88.2")).toBeInTheDocument();
    expect(screen.getByText("Not enough logged to state a rate")).toBeInTheDocument();
  });

  it("refuses a rate under a week of span — two readings a day apart are not a trend", () => {
    render(
      <ProgressionChart
        {...PROPS}
        series={{
          weight: [
            { date: "2026-07-26", value: 90 },
            { date: "2026-07-27", value: 88.2 },
          ],
          bodyFat: [],
        }}
      />
    );

    expect(screen.getByText("Not enough logged to state a rate")).toBeInTheDocument();
  });

  it("says the window is empty rather than showing a zero", () => {
    render(<ProgressionChart {...PROPS} series={{ weight: [], bodyFat: [] }} />);

    expect(screen.getByText("Not recorded")).toBeInTheDocument();
    expect(screen.getByText("No measurements in this window")).toBeInTheDocument();
  });

  it("still shows where the goal is when the client has logged nothing", () => {
    render(
      <ProgressionChart
        {...PROPS}
        series={{ weight: [], bodyFat: [] }}
        goal={{ ...NO_GOAL, goalWeightKg: 85 }}
      />
    );

    // The target is a fact about the client, not about the window's contents.
    expect(screen.getByText("goal 85")).toBeInTheDocument();
  });

  it("draws no goal line for a maintenance client", () => {
    const { container } = render(<ProgressionChart {...PROPS} />);

    expect(container.querySelector(".recharts-reference-line")).toBeNull();
    expect(screen.queryByText(/^goal /)).not.toBeInTheDocument();
  });

  it("switches the readout with the metric lens", async () => {
    const user = userEvent.setup();
    const onMetricChange = vi.fn();
    const { rerender } = render(
      <ProgressionChart {...PROPS} onMetricChange={onMetricChange} />
    );

    await user.click(screen.getByRole("button", { name: "Body fat" }));
    expect(onMetricChange).toHaveBeenCalledWith("bodyFat");

    rerender(<ProgressionChart {...PROPS} metric="bodyFat" onMetricChange={onMetricChange} />);
    expect(screen.getByText("22.6")).toBeInTheDocument();
    expect(screen.getByText("%")).toBeInTheDocument();
  });

  it("converts the series for an imperial coach, to ONE decimal", () => {
    unitPreference.value = "imperial";
    render(<ProgressionChart {...PROPS} />);

    // 88.2 kg = 194.4451… lbs. Rendering the raw float is what put fifteen
    // decimal places on the metrics hero once.
    expect(screen.getByText("194.4")).toBeInTheDocument();
    expect(screen.getByText("lbs")).toBeInTheDocument();
  });

  it("converts the GOAL the same way, so the line and the value are comparable", () => {
    unitPreference.value = "imperial";
    const { container } = render(
      <ProgressionChart {...PROPS} goal={{ ...NO_GOAL, goalWeightKg: 85 }} />
    );

    expect(container.textContent).toContain("goal 187.4");
  });

  it("shows a skeleton on the first load, not an empty chart", () => {
    const { container } = render(<ProgressionChart {...PROPS} series={null} isLoading />);

    expect(container.querySelector(".recharts-surface")).toBeNull();
    expect(screen.queryByText("No measurements in this window")).not.toBeInTheDocument();
  });
});
