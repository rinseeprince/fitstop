import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TrainingEventDetail } from "@/types/training";
import { SetTracker } from "./set-tracker";

const mockUseSWR = vi.fn();
vi.mock("swr", () => ({
  default: (...args: unknown[]) => mockUseSWR(...args),
}));

const ISO = "2026-05-01T00:00:00.000Z";

const baseFixture: TrainingEventDetail = {
  event: {
    id: "evt-1",
    clientId: "c-1",
    trainingPlanId: "p-1",
    trainingSessionId: "s-1",
    date: "2026-05-06",
    sessionName: "Push Day A",
    sessionFocus: "Chest + triceps",
    estimatedCalories: null,
    status: "scheduled",
    sessionLogId: null,
    isModified: false,
    calorieSurplusPercentage: null,
    createdAt: ISO,
    updatedAt: ISO,
  },
  session: {
    source: "live",
    session: {
      id: "s-1",
      planId: "p-1",
      name: "Push Day A",
      orderIndex: 0,
      focus: "Chest + triceps",
      estimatedDurationMinutes: 45,
      calorieSurplusPercentage: null,
      exercises: [],
      createdAt: ISO,
      updatedAt: ISO,
    },
  },
  exercises: [
    {
      source: "live",
      exercise: {
        id: "e-1",
        sessionId: "s-1",
        exerciseId: null,
        name: "Bench Press",
        orderIndex: 0,
        sets: 3,
        repsTarget: "8-12",
        rpeTarget: 8,
        isWarmup: false,
        createdAt: ISO,
        updatedAt: ISO,
      },
    },
    {
      source: "live",
      exercise: {
        id: "e-2",
        sessionId: "s-1",
        exerciseId: null,
        name: "Overhead Press",
        orderIndex: 1,
        sets: 4,
        repsTarget: "6-10",
        isWarmup: false,
        createdAt: ISO,
        updatedAt: ISO,
      },
    },
  ],
  sessionLog: null,
  exerciseLogs: [],
};

describe("SetTracker", () => {
  beforeEach(() => {
    mockUseSWR.mockReset();
  });

  it("shows skeleton while loading", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
    });
    render(<SetTracker eventId="evt-1" />);
    expect(screen.getByTestId("set-tracker-skeleton")).toBeInTheDocument();
  });

  it("shows error state on fetch failure", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: new Error("boom"),
      isLoading: false,
    });
    render(<SetTracker eventId="evt-1" />);
    expect(screen.getByText(/failed to load workout/i)).toBeInTheDocument();
  });

  it("renders header and one block per exercise on happy path", () => {
    mockUseSWR.mockReturnValue({
      data: { success: true, data: baseFixture },
      error: undefined,
      isLoading: false,
    });
    render(<SetTracker eventId="evt-1" date="2026-05-06" />);
    expect(screen.getByText("Push Day A")).toBeInTheDocument();
    expect(screen.getByText("Chest + triceps")).toBeInTheDocument();
    expect(screen.getAllByTestId("exercise-tracker-block")).toHaveLength(2);
  });
});
