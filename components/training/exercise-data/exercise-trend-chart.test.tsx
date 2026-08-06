import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExerciseTrendChart } from "./exercise-trend-chart";
import type { ExerciseProgressionPoint } from "@/types/training";

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars. Any
// test rendering a component that calls useUnits() must stub this module.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));


// Recharts needs ResizeObserver
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

  it("renders chart card with title for weight metric", () => {
    const data = [
      makePoint({ date: "2026-03-01", topSetWeight: 80 }),
      makePoint({ date: "2026-03-08", topSetWeight: 85 }),
      makePoint({ date: "2026-03-15", topSetWeight: 87.5 }),
    ];

    render(
      <ExerciseTrendChart data={data} metric="weight" isLoading={false} />,
    );

    expect(screen.getByText("Top set weight over time")).toBeInTheDocument();
    // The subtitle carries the unit: the axis is 40-50px wide and this chart
    // previously had NO unit label anywhere — axis, tooltip or legend.
    expect(
      screen.getByText("Heaviest weight lifted per session · kg"),
    ).toBeInTheDocument();
  });

  it("renders chart card with title for volume metric", () => {
    const data = [
      makePoint({ date: "2026-03-01", totalVolume: 2400 }),
      makePoint({ date: "2026-03-08", totalVolume: 2600 }),
    ];

    render(
      <ExerciseTrendChart data={data} metric="volume" isLoading={false} />,
    );

    expect(screen.getByText("Session volume")).toBeInTheDocument();
  });

  it("renders compliance summary as chart subtitle", () => {
    const data = [
      makePoint({ date: "2026-03-01", prescribedSets: 3, actualSets: 3 }),
      makePoint({ date: "2026-03-08", prescribedSets: 3, actualSets: 2 }),
      makePoint({ date: "2026-03-15", prescribedSets: 4, actualSets: 4 }),
    ];

    render(
      <ExerciseTrendChart data={data} metric="compliance" isLoading={false} />,
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
      <ExerciseTrendChart data={data} metric="compliance" isLoading={false} />,
    );

    expect(
      screen.getByText(/No prescribed data available/),
    ).toBeInTheDocument();
  });

  it("renders compliance legend items", () => {
    const data = [
      makePoint({ date: "2026-03-01", prescribedSets: 3, actualSets: 3 }),
      makePoint({ date: "2026-03-08", prescribedSets: 3, actualSets: 3 }),
    ];

    render(
      <ExerciseTrendChart data={data} metric="compliance" isLoading={false} />,
    );

    expect(screen.getByText("Prescribed")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });
});
