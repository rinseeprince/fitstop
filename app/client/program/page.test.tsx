import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import ProgramPage from "./page";
import type { ClientProgram } from "@/types/client-program";

const swrCall = vi.fn();

vi.mock("swr", () => ({
  __esModule: true,
  default: (key: unknown, _fetcher: unknown, _opts: unknown) => swrCall(key),
}));

function setSWR({
  isLoading = false,
  error,
  data,
  mutate = vi.fn(),
}: {
  isLoading?: boolean;
  error?: unknown;
  data?: unknown;
  mutate?: () => unknown;
} = {}) {
  // Program page now makes two SWR calls (program + training-plan). The
  // training-plan call defaults to no-data / no-loading so legacy tests keep
  // passing without setting it explicitly.
  swrCall.mockImplementation((key: string) => {
    if (key === "/api/client/training-plan") {
      return { data: undefined, error: undefined, isLoading: false, mutate: vi.fn() };
    }
    return {
      data: data ?? undefined,
      error,
      isLoading,
      mutate,
    };
  });
}

function makeProgram(overrides: Partial<ClientProgram> = {}): ClientProgram {
  return {
    roadmap: {
      id: "r1",
      name: "Spring Block",
      longTermGoal: "Lean to 78kg",
      goalWeight: null,
      goalBodyFatPercentage: null,
      status: "active",
      startedAt: "2025-09-01",
      targetEndDate: "2026-12-31",
    },
    phases: [
      {
        id: "p1",
        name: "Cut Phase 1",
        description: "Initial cut",
        objectives: "Lose 4kg",
        orderIndex: 0,
        status: "completed",
        startDate: "2025-09-01",
        endDate: "2025-11-30",
        durationWeeks: 12,
        phaseGoalWeight: null,
        phaseGoalBodyFatPercentage: null,
        coachReflection: null,
        milestones: [
          { id: "m1", text: "Hit calorie target", completed: true, completed_at: "2025-11-01" },
        ],
      },
      {
        id: "p2",
        name: "Build Phase",
        description: "Maintenance and rebuild",
        objectives: "Gain 1kg lean",
        orderIndex: 1,
        status: "active",
        startDate: "2025-12-01",
        endDate: "2026-06-30",
        durationWeeks: 30,
        phaseGoalWeight: null,
        phaseGoalBodyFatPercentage: null,
        coachReflection: null,
        milestones: [
          { id: "m2", text: "Hit protein target weekly", completed: false, completed_at: null },
        ],
      },
      {
        id: "p3",
        name: "Cut Phase 2",
        description: "Second cut",
        objectives: "Drop another 3kg",
        orderIndex: 2,
        status: "planned",
        startDate: "2026-07-01",
        endDate: null,
        durationWeeks: 12,
        phaseGoalWeight: null,
        phaseGoalBodyFatPercentage: null,
        coachReflection: null,
        milestones: [
          { id: "m3", text: "Maintain training volume", completed: false, completed_at: null },
        ],
      },
    ],
    activePhaseId: "p2",
    weightUnit: "lbs",
    metrics: { startingWeight: null, currentWeight: null },
    ...overrides,
  };
}

describe("ProgramPage", () => {
  beforeEach(() => {
    swrCall.mockReset();
    setSWR();
    cleanup();
  });

  it("highlights the active phase and keeps future phases collapsed", () => {
    setSWR({ data: { success: true, data: makeProgram() } });
    const { container } = render(<ProgramPage />);

    expect(screen.getByText("Spring Block")).toBeInTheDocument();

    const activeElements = container.querySelectorAll('[data-active="true"]');
    expect(activeElements).toHaveLength(1);
    expect(activeElements[0]).toHaveTextContent("Build Phase");

    expect(screen.getByText("Maintenance and rebuild")).toBeInTheDocument();

    expect(screen.queryByText("Second cut")).toBeNull();
    expect(screen.queryByText("Initial cut")).toBeNull();

    expect(screen.getByText(/Week \d+ of \d+/)).toBeInTheDocument();
  });

  it("renders the empty state when no roadmap exists", () => {
    setSWR({ data: { success: true, data: null } });
    const { container } = render(<ProgramPage />);

    expect(screen.getByText("No roadmap yet")).toBeInTheDocument();
    expect(container.querySelector('[data-active="true"]')).toBeNull();
  });

  it("hides week progress for an active phase missing startDate", () => {
    const program = makeProgram({
      phases: [
        {
          id: "p2",
          name: "Build Phase",
          description: "Maintenance and rebuild",
          objectives: null,
          orderIndex: 0,
          status: "active",
          startDate: null,
          endDate: null,
          durationWeeks: 30,
          phaseGoalWeight: null,
          phaseGoalBodyFatPercentage: null,
          coachReflection: null,
          milestones: [],
        },
      ],
      activePhaseId: "p2",
    });
    setSWR({ data: { success: true, data: program } });
    render(<ProgramPage />);

    expect(screen.getByText("Build Phase")).toBeInTheDocument();
    expect(screen.queryByText(/Week \d+ of \d+/)).toBeNull();
  });

  it("derives total weeks from date span when durationWeeks is null", () => {
    const program = makeProgram({
      phases: [
        {
          id: "p2",
          name: "Build Phase",
          description: null,
          objectives: null,
          orderIndex: 0,
          status: "active",
          startDate: "2026-01-01",
          endDate: "2026-01-28",
          durationWeeks: null,
          phaseGoalWeight: null,
          phaseGoalBodyFatPercentage: null,
          coachReflection: null,
          milestones: [],
        },
      ],
      activePhaseId: "p2",
    });
    setSWR({ data: { success: true, data: program } });
    render(<ProgramPage />);

    expect(screen.getByText(/of 4$/)).toBeInTheDocument();
  });

  it("renders roadmap summary strip with start, current, and goal weight values", () => {
    const program = makeProgram({
      roadmap: {
        id: "r1",
        name: "Spring Block",
        longTermGoal: "Lean to 78kg",
        goalWeight: 75,
        goalBodyFatPercentage: 10,
        status: "active",
        startedAt: "2025-09-01",
        targetEndDate: "2026-12-31",
      },
      weightUnit: "kg",
      metrics: { startingWeight: 85.5, currentWeight: 80 },
    });
    setSWR({ data: { success: true, data: program } });
    render(<ProgramPage />);

    expect(screen.getByText("85.5")).toBeInTheDocument();
    expect(screen.getByText("80.0")).toBeInTheDocument();
    expect(screen.getByText("75.0")).toBeInTheDocument();
    expect(screen.getByText(/Target: 75\.0 kg/)).toBeInTheDocument();
  });

  it("renders phase goal chip for a phase with goals set", () => {
    const program = makeProgram({
      phases: [
        {
          id: "p1",
          name: "Build Phase",
          description: null,
          objectives: null,
          orderIndex: 0,
          status: "active",
          startDate: "2026-01-01",
          endDate: "2026-03-31",
          durationWeeks: 12,
          phaseGoalWeight: 78,
          phaseGoalBodyFatPercentage: 12,
          coachReflection: null,
          milestones: [],
        },
      ],
      activePhaseId: "p1",
      weightUnit: "kg",
    });
    setSWR({ data: { success: true, data: program } });
    const { container } = render(<ProgramPage />);

    const activeContainer = container.querySelector('[data-active="true"]');
    expect(activeContainer).not.toBeNull();
    expect(activeContainer!).toHaveTextContent(/78\.0 kg/);
    expect(activeContainer!).toHaveTextContent(/12% BF/);
  });
});
