import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import ProgramPage from "./page";
import type { ClientTrainingPlan } from "@/types/client-training-plan";

const swrCall = vi.fn();

vi.mock("swr", () => ({
  __esModule: true,
  default: (key: unknown, _fetcher: unknown, _opts: unknown) => swrCall(key),
}));

// The cards have their own tests — stub them so this file only pins the page's
// gating (loading / error / empty / which cards render). Stubbing the goal
// card also severs its units-context → auth-context import chain, which
// constructs the browser Supabase client at module load and throws without
// env vars.
vi.mock("@/components/client-portal/program/training-plan-card", () => ({
  TrainingPlanCard: ({ plan }: { plan: ClientTrainingPlan }) => (
    <div data-testid="training-plan-card">{plan.planName}</div>
  ),
}));

vi.mock("@/components/client-portal/program/training-week-layout", () => ({
  TrainingWeekLayout: () => <div data-testid="training-week-layout" />,
}));

vi.mock("@/components/client-portal/program/nutrition-plan-card", () => ({
  NutritionPlanCard: () => <div data-testid="nutrition-plan-card" />,
}));

vi.mock("@/components/client-portal/program/goal-card", () => ({
  GoalCard: ({
    goal,
    current,
  }: {
    goal?: { name?: string | null };
    current?: { weightKg: number | null; bodyFatPercentage: number | null };
  }) => (
    <div
      data-testid="goal-card"
      data-current-weight={current?.weightKg ?? ""}
      data-current-body-fat={current?.bodyFatPercentage ?? ""}
    >
      {goal?.name}
    </div>
  ),
}));

// The profile the client layout loaded before rendering the page; its newest
// readings are what the goal card's progress runs to.
vi.mock("@/hooks/use-client-profile", () => ({
  useClientProfile: () => ({
    client: { currentWeight: 80.2, currentBodyFatPercentage: 18.4 },
    error: undefined,
    isLoading: false,
    mutate: vi.fn(),
  }),
}));

type SWRState = {
  data?: unknown;
  error?: unknown;
  isLoading?: boolean;
  mutate?: () => unknown;
};

function setSWR(states: Record<string, SWRState> = {}) {
  swrCall.mockImplementation((key: string) => {
    const s = states[key] ?? {};
    return {
      data: s.data ?? undefined,
      error: s.error,
      isLoading: s.isLoading ?? false,
      mutate: s.mutate ?? vi.fn(),
    };
  });
}

function makeTrainingPlan(): ClientTrainingPlan {
  return {
    planId: "tp1",
    planName: "Push Pull Legs",
    sessions: [],
    state: "active",
    startsOn: "2026-07-01",
    endsOn: "2026-08-11",
  };
}

describe("ProgramPage", () => {
  beforeEach(() => {
    swrCall.mockReset();
    setSWR();
    cleanup();
  });

  it("renders the empty state when neither plan exists", () => {
    setSWR({
      "/api/client/training-plan": { data: { success: true, data: null } },
      "/api/client/nutrition-plan": { data: { success: true, data: null } },
    });
    render(<ProgramPage />);

    expect(screen.getByText("No program yet")).toBeInTheDocument();
  });

  it("renders the training plan card when a training plan exists", () => {
    setSWR({
      "/api/client/training-plan": {
        data: { success: true, data: makeTrainingPlan() },
      },
      "/api/client/nutrition-plan": { data: { success: true, data: null } },
    });
    render(<ProgramPage />);

    expect(screen.getByTestId("training-plan-card")).toHaveTextContent(
      "Push Pull Legs",
    );
    expect(screen.getByTestId("training-week-layout")).toBeInTheDocument();
    expect(screen.queryByTestId("nutrition-plan-card")).toBeNull();
    expect(screen.queryByText("No program yet")).toBeNull();
  });

  it("renders the nutrition plan card when nutrition targets exist", () => {
    setSWR({
      "/api/client/training-plan": { data: { success: true, data: null } },
      "/api/client/nutrition-plan": {
        data: { success: true, data: { baselineCalories: 2200 } },
      },
    });
    render(<ProgramPage />);

    expect(screen.getByTestId("nutrition-plan-card")).toBeInTheDocument();
    expect(screen.queryByTestId("training-plan-card")).toBeNull();
    expect(screen.queryByTestId("training-week-layout")).toBeNull();
  });

  it("shows the skeleton while either fetch is still loading", () => {
    setSWR({
      "/api/client/training-plan": { isLoading: true },
      "/api/client/nutrition-plan": { data: { success: true, data: null } },
    });
    const { container } = render(<ProgramPage />);

    expect(screen.queryByText("No program yet")).toBeNull();
    expect(container.querySelectorAll("[class*='animate-pulse']").length).toBeGreaterThan(0);
  });

  it("shows the load error only when both fetches fail", () => {
    setSWR({
      "/api/client/training-plan": { error: new Error("boom") },
      "/api/client/nutrition-plan": { error: new Error("boom") },
    });
    render(<ProgramPage />);

    expect(
      screen.getByText(/couldn't load your program/i),
    ).toBeInTheDocument();
  });

  it("still renders the surviving card when only one fetch fails", () => {
    setSWR({
      "/api/client/training-plan": {
        data: { success: true, data: makeTrainingPlan() },
      },
      "/api/client/nutrition-plan": { error: new Error("boom") },
    });
    render(<ProgramPage />);

    expect(screen.getByTestId("training-plan-card")).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load your program/i)).toBeNull();
  });

  // The goal card reads its own route (SD7, docs/SUNSET-PLAN.md): the goal and
  // the readings its progress is judged from, and nothing about blocks.
  it("mounts the goal card first, above the plan cards, from the goal route", () => {
    setSWR({
      "/api/client/training-plan": {
        data: { success: true, data: makeTrainingPlan() },
      },
      "/api/client/nutrition-plan": { data: { success: true, data: null } },
      "/api/client/goal": {
        data: { success: true, data: { goal: { weightKg: 71.9, deadline: null, name: "Trim down" } } },
      },
    });
    render(<ProgramPage />);

    const card = screen.getByTestId("goal-card");
    expect(card).toHaveTextContent("Trim down");
    expect(
      card.compareDocumentPosition(screen.getByTestId("training-plan-card")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(swrCall).toHaveBeenCalledWith("/api/client/goal");
    expect(swrCall).not.toHaveBeenCalledWith("/api/client/journey");
    // The newest readings come from the profile, not the goal read.
    expect(card).toHaveAttribute("data-current-weight", "80.2");
    expect(card).toHaveAttribute("data-current-body-fat", "18.4");
  });

  it("renders the goal card beside the empty state when there are no plans", () => {
    setSWR({
      "/api/client/training-plan": { data: { success: true, data: null } },
      "/api/client/nutrition-plan": { data: { success: true, data: null } },
      "/api/client/goal": {
        data: { success: true, data: { goal: { weightKg: null, deadline: null, name: "Trim down" } } },
      },
    });
    render(<ProgramPage />);

    expect(screen.getByTestId("goal-card")).toBeInTheDocument();
    expect(screen.getByText("No program yet")).toBeInTheDocument();
  });

  it("a goal fetch failure drops only the goal card — the plan cards stay", () => {
    setSWR({
      "/api/client/training-plan": {
        data: { success: true, data: makeTrainingPlan() },
      },
      "/api/client/nutrition-plan": { data: { success: true, data: null } },
      "/api/client/goal": { error: new Error("boom") },
    });
    render(<ProgramPage />);

    expect(screen.queryByTestId("goal-card")).toBeNull();
    expect(screen.getByTestId("training-plan-card")).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load your program/i)).toBeNull();
  });

  it("the goal fetch participates in the initial-load skeleton gate", () => {
    setSWR({
      "/api/client/training-plan": { data: { success: true, data: null } },
      "/api/client/nutrition-plan": { data: { success: true, data: null } },
      "/api/client/goal": { isLoading: true },
    });
    const { container } = render(<ProgramPage />);

    expect(
      container.querySelectorAll("[class*='animate-pulse']").length,
    ).toBeGreaterThan(0);
  });
});
