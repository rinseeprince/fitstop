import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CheckInComparisonView } from "./check-in-comparison-view";
import type { CheckInComparison, ProgressChartData, CheckIn } from "@/types/check-in";
import type { SessionSummary } from "@/lib/check-in/adherence";

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));


const checkIn = (overrides: Partial<CheckIn>): CheckIn => ({
  id: "c",
  clientId: "cl",
  status: "ai_processed",
  createdAt: "2026-06-01T00:00:00Z",
  updatedAt: "2026-06-01T00:00:00Z",
  weight: 96.2,
  ...overrides,
});

const emptyChartData = (): ProgressChartData => ({
  weight: [],
  bodyFat: [],
  adherence: [],
  mood: [],
  energy: [],
  sleep: [],
  stress: [],
  soreness: [],
});

// 4 of 6 completed -> 67%, matching the hero card.
const adherence: SessionSummary = {
  full: 3,
  partial: 1,
  missed: 2,
  completed: 4,
  prescribed: 6,
  pct: 67,
};

describe("CheckInComparisonView", () => {
  it("shows a clean baseline state on a first check-in", () => {
    const comparison: CheckInComparison = {
      current: checkIn({}),
      previous: null,
      client: { id: "cl", name: "Sam" },
      changes: { weight: { current: 96.2 } },
    };
    const chartData: ProgressChartData = {
      ...emptyChartData(),
      weight: [{ date: "Jun 1", value: 96.2 }],
      // stored snapshot says 100, but the view must show the shared 67%
      adherence: [{ date: "Jun 1", value: 100 }],
    };

    render(<CheckInComparisonView comparison={comparison} chartData={chartData} adherence={adherence} />);

    expect(screen.getByText("Baseline established")).toBeInTheDocument();
    expect(screen.getByText(/trends build next week/i)).toBeInTheDocument();
    expect(screen.getByText(/67%/)).toBeInTheDocument();
    expect(screen.queryByText(/100%/)).not.toBeInTheDocument();
  });

  it("renders week-over-week deltas when a previous check-in exists", () => {
    const comparison: CheckInComparison = {
      current: checkIn({ weight: 95.0 }),
      previous: checkIn({ id: "p", weight: 96.2 }),
      client: { id: "cl", name: "Sam" },
      changes: { weight: { current: 95.0, previous: 96.2, change: -1.2, trend: "down" } },
      timeBetweenCheckIns: 7,
    };
    const chartData: ProgressChartData = {
      ...emptyChartData(),
      weight: [
        { date: "May 25", value: 96.2 },
        { date: "Jun 1", value: 95.0 },
      ],
      adherence: [
        { date: "May 25", value: 80 },
        { date: "Jun 1", value: 100 },
      ],
    };

    render(<CheckInComparisonView comparison={comparison} chartData={chartData} adherence={adherence} />);

    expect(screen.getByText("Progress comparison")).toBeInTheDocument();
    expect(screen.getByText(/Comparing with the check-in from 7 days ago/i)).toBeInTheDocument();
    expect(screen.getByText(/-1\.2/)).toBeInTheDocument();
  });
});
