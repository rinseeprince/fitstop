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
  CheckInReviewSection: ({ onRefresh }: { onRefresh: () => void }) => (
    <div data-testid="rail">
      <button onClick={onRefresh}>regenerate</button>
    </div>
  ),
}));
vi.mock("./check-in-reply-block", () => ({
  CheckInReplyBlock: ({ onSent }: { onSent: () => void }) => (
    <div data-testid="reply">
      <button onClick={onSent}>send</button>
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
vi.mock("./check-in-goal-strip", () => ({
  CheckInGoalStrip: ({ onSetNewGoals }: { onSetNewGoals?: () => void }) => (
    <div data-testid="goals">
      <button onClick={onSetNewGoals}>set new goals</button>
    </div>
  ),
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
    goalProgress: { goalIsCurrent: true },
  },
  isLoadingComparison: false,
  // One day-form row only: the header's count must NOT come from here, since a
  // day the client only trained or only ticked a habit has no such row.
  dailyLogs: [{ date: "2026-08-22" }],
  habitLogs: [],
  // The server's own date lists (lib/logged-days.ts through the adherence
  // kernel): the 24th and 27th are logged days, over a seven-day period.
  periodAdherence: {
    dates: [
      "2026-08-22", "2026-08-23", "2026-08-24", "2026-08-25",
      "2026-08-26", "2026-08-27", "2026-08-28",
    ],
    loggedDates: ["2026-08-24", "2026-08-27"],
    nutrition: { rail: [], onTarget: 0, loggedDays: 0, pct: null },
    habits: { rail: [], avgPct: null, daysBelow50: 0, perHabit: [] },
  },
  dailyContextLoading: false,
  contextStartDate: new Date("2026-08-22T00:00:00"),
  contextEndDate: new Date("2026-08-28T00:00:00"),
  fullWeekTarget: null,
  refreshDetail: vi.fn(),
};

function renderView(
  props: Partial<{ onBack: () => void; onDone: () => void; onTabChange: () => void }> = {},
) {
  const onBack = props.onBack ?? vi.fn();
  const onDone = props.onDone ?? vi.fn();
  const onTabChange = props.onTabChange ?? vi.fn();
  render(
    <CheckInDetailView
      checkInId="ci-9"
      client={client}
      onBack={onBack}
      onDone={onDone}
      onTabChange={onTabChange}
    />,
  );
  return { onBack, onDone, onTabChange };
}

describe("CheckInDetailView", () => {
  beforeEach(() => vi.clearAllMocks());

  it("spins while the detail loads, with no rail", () => {
    mockDetailData.mockReturnValue({ ...loaded, data: null, isLoading: true, contextStartDate: null, contextEndDate: null });
    const { container } = render(
      <CheckInDetailView
        checkInId="ci-9"
        client={client}
        onBack={vi.fn()}
        onDone={vi.fn()}
        onTabChange={vi.fn()}
      />
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
    // The reply is the page's destination and its own section.
    expect(screen.getByTestId("reply")).toBeInTheDocument();
    // Goal progress renders without a click — the whole point of the page.
    expect(screen.getByTestId("goals")).toBeInTheDocument();
    expect(screen.getByText(/2\/7 days logged/)).toBeInTheDocument();
    expect(screen.getByText(/Week of Aug 22 – 28, 2026/)).toBeInTheDocument();
  });

  it("omits the days-logged chip on a legacy row whose period cannot be resolved", () => {
    // `periodAdherence` is null when the server cannot resolve the period. The
    // cells show their empty states; the header shows no fraction rather than
    // one counted a second way.
    mockDetailData.mockReturnValue({ ...loaded, periodAdherence: null });
    renderView();
    expect(screen.queryByText(/days logged/)).not.toBeInTheDocument();
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

  it("Set new goals crosses to the Overview editor and clears the open check-in", async () => {
    // The goal editor is the Overview's details sheet. Cross-tab navigation
    // must go through the handler, and `checkIn: null` stops Back landing on a
    // review the coach has left.
    const user = userEvent.setup();
    mockDetailData.mockReturnValue(loaded);
    const { onTabChange } = renderView();

    await user.click(screen.getByRole("button", { name: "set new goals" }));

    expect(onTabChange).toHaveBeenCalledWith("overview", {
      editProfile: "1",
      checkIn: null,
    });
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
