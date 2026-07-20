import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TrainingSummaryHero } from "./training-summary-hero";

// Mutable holders (hoisted so the mock factories can read them).
const state = vi.hoisted(() => ({
  swrData: undefined as unknown,
  swrLoading: false,
  plan: undefined as unknown,
}));

vi.mock("swr", () => ({
  default: () => ({ data: state.swrData, isLoading: state.swrLoading }),
}));

vi.mock("@/contexts/training-builder-context", () => ({
  useTrainingBuilderContext: () => ({ plan: state.plan }),
}));

describe("TrainingSummaryHero", () => {
  beforeEach(() => {
    cleanup();
    state.swrLoading = false;
    state.swrData = {
      success: true,
      data: { completed: 3, totalPlanned: 8, plannedUpToToday: 5, missed: 1 },
    };
    state.plan = {
      name: "Jane's Program",
      description: "A solid split",
      splitType: "push_pull_legs",
      frequencyPerWeek: 4,
      programDurationWeeks: 6,
    };
  });

  it("renders the accurate week summary from the /summary endpoint + program-info row", () => {
    const { container } = render(<TrainingSummaryHero clientId="client-1" />);

    // Completed / planned (session_logs vs planned events — the truthful source).
    expect(screen.getByText("Sessions Completed")).toBeInTheDocument();
    expect(screen.getByText("of 8 planned")).toBeInTheDocument();
    // Adherence = completed / plannedUpToToday = 3/5 = 60%.
    expect(screen.getByText("3/5 sessions")).toBeInTheDocument();
    expect(container.textContent).toContain("60%");
    // Missed this week.
    expect(screen.getByText("Missed This Week")).toBeInTheDocument();

    // Program-info row from TrainingBuilderContext.
    expect(screen.getByText("Jane's Program")).toBeInTheDocument();
    expect(screen.getByText("4x/week")).toBeInTheDocument();
    expect(screen.getByText("6 weeks")).toBeInTheDocument();
  });

  it("shows loading skeletons (no stat values) while the summary loads", () => {
    state.swrLoading = true;
    state.swrData = undefined;
    render(<TrainingSummaryHero clientId="client-1" />);

    // Labels + the program-info row render; the numbers do not yet.
    expect(screen.getByText("Sessions Completed")).toBeInTheDocument();
    expect(screen.getByText("Jane's Program")).toBeInTheDocument();
    expect(screen.queryByText(/planned/)).toBeNull();
  });
});
