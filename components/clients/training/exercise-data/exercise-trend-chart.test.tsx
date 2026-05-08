import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExerciseTrendChart } from "./exercise-trend-chart";
import type { ExerciseProgressionPoint } from "@/types/training";

// Recharts needs ResizeObserver in jsdom
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

function makePoint(
  overrides: Partial<ExerciseProgressionPoint> = {},
): ExerciseProgressionPoint {
  return {
    date: "2026-03-01T00:00:00Z",
    sessionLogId: "sl-1",
    topSetWeight: 80,
    topSetReps: 8,
    estimatedOneRepMax: 100,
    totalVolume: 2400,
    topSetRpe: 7,
    prescribedSets: 3,
    actualSets: 3,
    prescribedRepsMin: 8,
    prescribedRepsMax: 12,
    ...overrides,
  };
}

describe("ExerciseTrendChart", () => {
  it("renders empty state when fewer than 2 data points", () => {
    render(
      <ExerciseTrendChart
        data={[makePoint()]}
        metric="weight"
        isLoading={false}
      />,
    );

    expect(
      screen.getByText(/Not enough data yet/),
    ).toBeInTheDocument();
  });

  it("renders loading skeleton", () => {
    const { container } = render(
      <ExerciseTrendChart
        data={undefined}
        metric="weight"
        isLoading={true}
      />,
    );

    const skeleton = container.querySelector("[data-slot='skeleton']");
    expect(skeleton).toBeInTheDocument();
  });

  it("renders RPE empty state when all RPE values are null", () => {
    const data = [
      makePoint({ date: "2026-03-01", topSetRpe: null }),
      makePoint({ date: "2026-03-08", topSetRpe: null }),
      makePoint({ date: "2026-03-15", topSetRpe: null }),
    ];

    render(
      <ExerciseTrendChart data={data} metric="rpe" isLoading={false} />,
    );

    expect(
      screen.getByText(/No RPE data recorded/),
    ).toBeInTheDocument();
  });

  it("renders chart container for weight metric with sufficient data", () => {
    const data = [
      makePoint({ date: "2026-03-01", topSetWeight: 80 }),
      makePoint({ date: "2026-03-08", topSetWeight: 85 }),
      makePoint({ date: "2026-03-15", topSetWeight: 87.5 }),
    ];

    const { container } = render(
      <ExerciseTrendChart
        data={data}
        metric="weight"
        isLoading={false}
      />,
    );

    // Recharts renders an SVG inside a ResponsiveContainer
    const chartContainer = container.querySelector(".recharts-responsive-container");
    expect(chartContainer).toBeInTheDocument();
  });

  it("renders chart container for volume metric (bar chart)", () => {
    const data = [
      makePoint({ date: "2026-03-01", totalVolume: 2400 }),
      makePoint({ date: "2026-03-08", totalVolume: 2600 }),
    ];

    const { container } = render(
      <ExerciseTrendChart
        data={data}
        metric="volume"
        isLoading={false}
      />,
    );

    const chartContainer = container.querySelector(".recharts-responsive-container");
    expect(chartContainer).toBeInTheDocument();
  });

  it("renders compliance summary stat", () => {
    const data = [
      makePoint({ date: "2026-03-01", prescribedSets: 3, actualSets: 3 }),
      makePoint({ date: "2026-03-08", prescribedSets: 3, actualSets: 2 }),
      makePoint({ date: "2026-03-15", prescribedSets: 4, actualSets: 4 }),
    ];

    render(
      <ExerciseTrendChart
        data={data}
        metric="compliance"
        isLoading={false}
      />,
    );

    expect(
      screen.getByText("Hit prescribed sets in 2/3 sessions"),
    ).toBeInTheDocument();
  });

  it("renders no prescribed data message for compliance when all prescribedSets are null", () => {
    const data = [
      makePoint({ date: "2026-03-01", prescribedSets: null }),
      makePoint({ date: "2026-03-08", prescribedSets: null }),
    ];

    render(
      <ExerciseTrendChart
        data={data}
        metric="compliance"
        isLoading={false}
      />,
    );

    expect(
      screen.getByText(/No prescribed data available/),
    ).toBeInTheDocument();
  });
});
