import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { TrainingPlanCard } from "./training-plan-card";
import type { ClientTrainingPlan } from "@/types/client-training-plan";

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

function makePlan(overrides: Partial<ClientTrainingPlan> = {}): ClientTrainingPlan {
  return {
    planId: "plan-1",
    planName: "PPL+Rest",
    state: "active",
    startsOn: "2026-07-01",
    endsOn: "2026-08-11",
    sessions: [
      {
        id: "s-0",
        name: "Push",
        focus: "Chest",
        orderIndex: 0,
        isRest: false,
        estimatedDurationMinutes: 60,
        exercises: [],
      },
      {
        id: "s-1",
        name: "Pull",
        focus: "Back",
        orderIndex: 1,
        isRest: false,
        estimatedDurationMinutes: 60,
        exercises: [],
      },
      {
        id: "rest-2",
        name: "Recovery Day",
        focus: null,
        orderIndex: 2,
        isRest: true,
        estimatedDurationMinutes: null,
        exercises: [],
      },
      {
        id: "s-3",
        name: "Legs",
        focus: "Quads",
        orderIndex: 3,
        isRest: false,
        estimatedDurationMinutes: 70,
        exercises: [],
      },
      {
        id: "rest-4",
        name: "Active Recovery",
        focus: null,
        orderIndex: 4,
        isRest: true,
        estimatedDurationMinutes: null,
        exercises: [],
      },
    ],
    ...overrides,
  };
}

describe("TrainingPlanCard", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders the plan name and training-session count (excluding rest)", () => {
    render(<TrainingPlanCard plan={makePlan()} />);

    expect(screen.getByText("PPL+Rest")).toBeInTheDocument();
    expect(screen.getByText("3 sessions")).toBeInTheDocument();
  });

  it("says nothing about dates while the program is running", () => {
    render(<TrainingPlanCard plan={makePlan()} />);

    expect(screen.queryByText(/^Starts /)).toBeNull();
    expect(screen.queryByText(/^Ended /)).toBeNull();
  });

  it("names the start date for a program the coach has queued", () => {
    render(
      <TrainingPlanCard plan={makePlan({ state: "upcoming", startsOn: "2026-08-17" })} />,
    );

    expect(screen.getByText("Starts Mon, Aug 17")).toBeInTheDocument();
  });

  it("names the end date for a program that has finished", () => {
    render(
      <TrainingPlanCard plan={makePlan({ state: "ended", endsOn: "2026-08-02" })} />,
    );

    expect(screen.getByText("Ended Sun, Aug 2")).toBeInTheDocument();
  });
});
