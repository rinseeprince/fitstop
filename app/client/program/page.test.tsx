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
// gating (loading / error / empty / which cards render). Stubbing the journey
// section also severs its units-context → auth-context import chain, which
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

vi.mock("@/components/client-portal/program/journey-section", () => ({
  JourneySection: () => <div data-testid="journey-section" />,
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

  it("mounts the journey section above the plan cards when the journey loads", () => {
    setSWR({
      "/api/client/training-plan": {
        data: { success: true, data: makeTrainingPlan() },
      },
      "/api/client/nutrition-plan": { data: { success: true, data: null } },
      "/api/client/journey": {
        data: { success: true, data: { clientToday: "2026-08-12", blocks: [] } },
      },
    });
    render(<ProgramPage />);

    const section = screen.getByTestId("journey-section");
    const card = screen.getByTestId("training-plan-card");
    expect(
      section.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders the journey section beside the empty state when blocks exist but no plans", () => {
    setSWR({
      "/api/client/training-plan": { data: { success: true, data: null } },
      "/api/client/nutrition-plan": { data: { success: true, data: null } },
      "/api/client/journey": {
        data: { success: true, data: { clientToday: "2026-08-12", blocks: [] } },
      },
    });
    render(<ProgramPage />);

    expect(screen.getByTestId("journey-section")).toBeInTheDocument();
    expect(screen.getByText("No program yet")).toBeInTheDocument();
  });

  it("a journey fetch failure drops only the section — the plan cards stay", () => {
    setSWR({
      "/api/client/training-plan": {
        data: { success: true, data: makeTrainingPlan() },
      },
      "/api/client/nutrition-plan": { data: { success: true, data: null } },
      "/api/client/journey": { error: new Error("boom") },
    });
    render(<ProgramPage />);

    expect(screen.queryByTestId("journey-section")).toBeNull();
    expect(screen.getByTestId("training-plan-card")).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load your program/i)).toBeNull();
  });

  it("the journey fetch participates in the initial-load skeleton gate", () => {
    setSWR({
      "/api/client/training-plan": { data: { success: true, data: null } },
      "/api/client/nutrition-plan": { data: { success: true, data: null } },
      "/api/client/journey": { isLoading: true },
    });
    const { container } = render(<ProgramPage />);

    expect(
      container.querySelectorAll("[class*='animate-pulse']").length,
    ).toBeGreaterThan(0);
  });
});
