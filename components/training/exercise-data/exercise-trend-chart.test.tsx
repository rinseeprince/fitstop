import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    rpe: 7,
    rir: null,
    topSetDistanceMeters: null,
    topSetDurationSeconds: null,
    estimatedOneRepMax: 100,
    totalVolume: 2400,
    bestSetReps: null,
    bestPaceSecondsPerKm: null,
    bestPaceDistanceMeters: null,
    totalDistanceMeters: null,
    bestSplitSecondsPer500m: null,
    bestSplitDistanceMeters: null,
    bestPower: null,
    bestTimeSeconds: null,
    bestTimeDistanceMeters: null,
    bestTimeWeight: null,
    longestHoldSeconds: null,
    totalCalories: null,
    maxCadence: null,
    maxStrokeRate: null,
    maxResistance: null,
    maxHeartRateZone: null,
    maxHeartRate: null,
    maxFtpPercent: null,
    averageRestSeconds: null,
    prescribedSets: 3,
    actualSets: 3,
    prescribedRepsMin: 8,
    prescribedRepsMax: 12,
    ...overrides,
  };
}

const two = [makePoint(), makePoint({ date: "2026-03-08T00:00:00Z", sessionLogId: "sl-2" })];

describe("ExerciseTrendChart", () => {
  it("renders empty state when fewer than 2 data points", () => {
    render(<ExerciseTrendChart data={[makePoint()]} metric="weight" exerciseType="strength" isLoading={false} />);
    expect(screen.getByText(/Not enough data yet/)).toBeInTheDocument();
  });

  it("renders a skeleton while loading", () => {
    const { container } = render(
      <ExerciseTrendChart data={undefined} metric="weight" exerciseType="strength" isLoading={true} />,
    );
    expect(container.querySelector("[data-slot='skeleton']")).toBeInTheDocument();
  });

  it("says a failed read failed, never that there isn't enough data", async () => {
    const onRetry = vi.fn();
    render(
      <ExerciseTrendChart data={undefined} metric="weight" exerciseType="strength" isLoading={false} isError onRetry={onRetry} />,
    );
    expect(screen.getByText("Couldn't load the sessions")).toBeInTheDocument();
    expect(screen.queryByText(/Not enough data yet/)).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders the RPE empty state when no set recorded one", () => {
    const data = two.map((p) => ({ ...p, rpe: null }));
    render(<ExerciseTrendChart data={data} metric="rpe" exerciseType="strength" isLoading={false} />);
    expect(screen.getByText("No RPE data recorded for this exercise.")).toBeInTheDocument();
  });

  it("says where the RPE comes from: the top set's, or the highest logged", () => {
    const runs = two.map((p) => ({ ...p, topSetWeight: null, rpe: 7 }));
    render(<ExerciseTrendChart data={runs} metric="rpe" exerciseType="endurance" isLoading={false} />);
    expect(screen.getByText("Top set RPE per session, or the highest logged")).toBeInTheDocument();
  });

  it("keeps Strength's titles and its unit on the subtitle", () => {
    render(<ExerciseTrendChart data={two} metric="weight" exerciseType="strength" isLoading={false} />);
    expect(screen.getByText("Top set weight over time")).toBeInTheDocument();
    expect(screen.getByText("Heaviest weight lifted per session · kg")).toBeInTheDocument();
    expect(screen.getByText("Top set")).toBeInTheDocument();
    expect(screen.getByText("PR")).toBeInTheDocument();
  });

  it("renders the e1RM title", () => {
    render(<ExerciseTrendChart data={two} metric="e1rm" exerciseType="strength" isLoading={false} />);
    expect(screen.getByText("Estimated 1RM over time")).toBeInTheDocument();
  });

  it("summarises compliance on the subtitle", () => {
    render(<ExerciseTrendChart data={two} metric="compliance" exerciseType="strength" isLoading={false} />);
    expect(screen.getByText("Prescribed vs completed sets")).toBeInTheDocument();
    expect(screen.getByText("Hit prescribed sets in 2/2 sessions")).toBeInTheDocument();
  });

  it("renders the no-prescription state for compliance", () => {
    const data = two.map((p) => ({ ...p, prescribedSets: null }));
    render(<ExerciseTrendChart data={data} metric="compliance" exerciseType="strength" isLoading={false} />);
    expect(screen.getByText("No prescribed data available for this exercise.")).toBeInTheDocument();
  });

  it("charts a run's pace with the pace unit and its best starred", () => {
    const data = [
      makePoint({ bestPaceSecondsPerKm: 314, bestPaceDistanceMeters: 5000 }),
      makePoint({ date: "2026-03-08T00:00:00Z", sessionLogId: "sl-2", bestPaceSecondsPerKm: 301, bestPaceDistanceMeters: 5000 }),
    ];
    render(<ExerciseTrendChart data={data} metric="pace" exerciseType="endurance" isLoading={false} />);
    expect(screen.getByText("Pace over time")).toBeInTheDocument();
    expect(screen.getByText("Fastest pace per session · /km")).toBeInTheDocument();
    expect(screen.getByText("Pace")).toBeInTheDocument();
    expect(screen.getByText("Fastest")).toBeInTheDocument();
  });

  it("names a marker the type's way where it leads with it", () => {
    const data = [
      makePoint({ topSetWeight: 60, topSetReps: null, topSetDistanceMeters: 40, topSetDurationSeconds: 38 }),
      makePoint({ date: "2026-03-08T00:00:00Z", sessionLogId: "sl-2", topSetWeight: 64, topSetReps: null, topSetDistanceMeters: 40, topSetDurationSeconds: 35 }),
    ];
    render(<ExerciseTrendChart data={data} metric="weight" exerciseType="carry_sled" isLoading={false} />);
    expect(screen.getByText("Heaviest carry over time")).toBeInTheDocument();
    expect(screen.getByText("Heaviest load carried per session · kg")).toBeInTheDocument();

    const holds = [
      makePoint({ longestHoldSeconds: 90 }),
      makePoint({ date: "2026-03-08T00:00:00Z", sessionLogId: "sl-2", longestHoldSeconds: 120 }),
    ];
    render(<ExerciseTrendChart data={holds} metric="hold" exerciseType="holds" isLoading={false} />);
    expect(screen.getByText("Longest hold over time")).toBeInTheDocument();
    expect(screen.getByText("Longest hold per session · m:ss")).toBeInTheDocument();
  });

  it("names what was never recorded for a marker the type leads with", () => {
    render(<ExerciseTrendChart data={two} metric="reps" exerciseType="bodyweight" isLoading={false} />);
    expect(screen.getByText("No reps without a weight recorded for this exercise.")).toBeInTheDocument();
  });

  it("charts a distance total with the viewer's unit", () => {
    const data = [
      makePoint({ totalDistanceMeters: 5000 }),
      makePoint({ date: "2026-03-08T00:00:00Z", sessionLogId: "sl-2", totalDistanceMeters: 6200 }),
    ];
    render(<ExerciseTrendChart data={data} metric="distance" exerciseType="endurance" isLoading={false} />);
    expect(screen.getByText("Distance per session")).toBeInTheDocument();
    expect(screen.getByText("Total distance logged per session · km")).toBeInTheDocument();
  });
});
