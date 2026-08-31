import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheckInDetailView } from "./check-in-detail-view";
import type { Client } from "@/types/check-in";

const { mockDetailData } = vi.hoisted(() => ({ mockDetailData: vi.fn() }));
vi.mock("@/hooks/use-check-in-detail-data", () => ({
  useCheckInDetailData: mockDetailData,
}));
vi.mock("@/components/check-in/check-in-review-section", () => ({
  CheckInReviewSection: ({ onSent, onRefresh }: { onSent: () => void; onRefresh: () => void }) => (
    <div data-testid="rail">
      <button onClick={onSent}>send</button>
      <button onClick={onRefresh}>regenerate</button>
    </div>
  ),
}));
vi.mock("@/components/check-in/kpi-ribbon", () => ({
  KPIRibbon: () => <div data-testid="ribbon" />,
}));
vi.mock("@/components/check-in/wellness-section", () => ({ WellnessSection: () => null }));
vi.mock("@/components/check-in/nutrition-section", () => ({ NutritionSection: () => null }));
vi.mock("@/components/check-in/training-section", () => ({ TrainingSection: () => null }));
vi.mock("@/components/check-in/client-notes-section", () => ({ ClientNotesSection: () => null }));
vi.mock("@/components/check-in/habits-section", () => ({ HabitsSection: () => null }));
vi.mock("@/components/check-in/goal-progress-view", () => ({
  GoalProgressView: () => <div data-testid="goals" />,
}));

const client = { id: "client-1", name: "Jane Doe", email: "j@d.com" } as Client;

const loaded = {
  data: {
    checkIn: {
      id: "ci-9",
      clientId: "client-1",
      status: "ai_processed",
      createdAt: "2026-08-28T10:00:00Z",
      updatedAt: "2026-08-28T10:00:00Z",
      sessionCompletions: [],
    },
    client: { id: "client-1", name: "Jane Doe" },
  },
  isLoading: false,
  isError: false,
  isForeign: false,
  comparisonData: {
    comparison: { client: {}, changes: {}, timeBetweenCheckIns: 7 },
    chartData: {},
    goalProgress: {},
  },
  isLoadingComparison: false,
  dailyLogs: [{ date: "2026-08-22" }, { date: "2026-08-23" }],
  habitLogs: [],
  dailyContextLoading: false,
  contextStartDate: new Date("2026-08-22T00:00:00"),
  contextEndDate: new Date("2026-08-28T00:00:00"),
  fullWeekTarget: null,
  refreshDetail: vi.fn(),
};

function renderView(props: Partial<{ onBack: () => void; onDone: () => void }> = {}) {
  const onBack = props.onBack ?? vi.fn();
  const onDone = props.onDone ?? vi.fn();
  render(<CheckInDetailView checkInId="ci-9" client={client} onBack={onBack} onDone={onDone} />);
  return { onBack, onDone };
}

describe("CheckInDetailView", () => {
  beforeEach(() => vi.clearAllMocks());

  it("spins while the detail loads, with no rail", () => {
    mockDetailData.mockReturnValue({ ...loaded, data: null, isLoading: true, contextStartDate: null, contextEndDate: null });
    const { container } = render(
      <CheckInDetailView checkInId="ci-9" client={client} onBack={vi.fn()} onDone={vi.fn()} />
    );
    expect(container.querySelector(".animate-spin")).not.toBeNull();
    expect(screen.queryByTestId("rail")).not.toBeInTheDocument();
  });

  it("refuses a check-in that belongs to another client — no rail, no context", () => {
    mockDetailData.mockReturnValue({ ...loaded, isForeign: true, contextStartDate: null, contextEndDate: null });
    renderView();
    expect(screen.getByText(/belongs to another client/i)).toBeInTheDocument();
    expect(screen.queryByTestId("rail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ribbon")).not.toBeInTheDocument();
  });

  it("shows the failure state when the detail cannot load", () => {
    mockDetailData.mockReturnValue({ ...loaded, data: null, isError: true, contextStartDate: null, contextEndDate: null });
    renderView();
    expect(screen.getByText(/Failed to load check-in data/i)).toBeInTheDocument();
  });

  it("renders every section on one page — no switcher, nothing behind a click", () => {
    mockDetailData.mockReturnValue(loaded);
    renderView();
    expect(screen.getByTestId("ribbon")).toBeInTheDocument();
    expect(screen.getByTestId("rail")).toBeInTheDocument();
    // Goal progress renders without a click — the whole point of the page.
    expect(screen.getByTestId("goals")).toBeInTheDocument();
    expect(screen.getByText(/2\/7 days logged/)).toBeInTheDocument();
    expect(screen.getByText(/Week of Aug 22 – 28, 2026/)).toBeInTheDocument();
  });

  it("a failed comparison leaves the rest of the page standing", () => {
    mockDetailData.mockReturnValue({
      ...loaded,
      comparisonData: null,
      isLoadingComparison: false,
    });
    renderView();
    // The one comparison-fed section reports its own failure...
    expect(screen.getByText(/Failed to load goal progress data/i)).toBeInTheDocument();
    // ...and everything the DETAIL read feeds still renders.
    expect(screen.getByTestId("ribbon")).toBeInTheDocument();
    expect(screen.getByTestId("rail")).toBeInTheDocument();
    expect(screen.queryByText(/Failed to load check-in data/i)).not.toBeInTheDocument();
  });

  it("the back row returns to the list", async () => {
    const user = userEvent.setup();
    mockDetailData.mockReturnValue(loaded);
    const { onBack } = renderView();
    await user.click(screen.getByRole("button", { name: /back to check-ins/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });


  it("a sent reply reports done; a regenerate refreshes the detail in place", async () => {
    const user = userEvent.setup();
    const refreshDetail = vi.fn();
    mockDetailData.mockReturnValue({ ...loaded, refreshDetail });
    const { onDone } = renderView();

    await user.click(screen.getByRole("button", { name: "regenerate" }));
    expect(refreshDetail).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "send" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
