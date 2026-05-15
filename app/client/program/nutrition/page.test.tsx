import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import ProgramNutritionPage from "./page";
import type { NutritionTargets } from "@/services/client-portal-service";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";

const swrCall = vi.fn();

vi.mock("swr", () => ({
  __esModule: true,
  default: (key: unknown, _fetcher: unknown, _opts: unknown) => swrCall(key),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    back: vi.fn(),
    push: vi.fn(),
  }),
}));

vi.mock("@/components/client-portal/nutrition/vertical-nutrition-view", () => ({
  VerticalNutritionView: ({ targets }: { targets: DailyNutritionTargets[] }) => (
    <div data-testid="vertical-nutrition-view">{`${targets.length} day cards`}</div>
  ),
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
  swrCall.mockImplementation(() => ({
    data: data ?? undefined,
    error,
    isLoading,
    mutate,
  }));
}

function makeDay(
  day: DailyNutritionTargets["day"],
  overrides: Partial<DailyNutritionTargets> = {},
): DailyNutritionTargets {
  return {
    day,
    dayLabel: day.charAt(0).toUpperCase() + day.slice(1),
    isTrainingDay: false,
    calories: 2400,
    baselineCalories: 2400,
    proteinG: 180,
    carbsG: 240,
    fatG: 80,
    proteinPercent: 30,
    carbsPercent: 40,
    fatPercent: 30,
    trainingSessionCalories: 0,
    trainingSessions: [],
    totalCaloriesWithActivities: 2400,
    includeActivityBurn: true,
    calorieSurplusPercentage: null,
    ...overrides,
  };
}

function makeTargets(overrides: Partial<NutritionTargets> = {}): NutritionTargets {
  const dailyTargets: DailyNutritionTargets[] = [
    makeDay("monday", { isTrainingDay: true, calories: 2760, calorieSurplusPercentage: 15 }),
    makeDay("tuesday"),
    makeDay("wednesday", { isTrainingDay: true, calories: 2640, calorieSurplusPercentage: 10 }),
    makeDay("thursday"),
    makeDay("friday", { isTrainingDay: true, calories: 2880, calorieSurplusPercentage: 20 }),
    makeDay("saturday"),
    makeDay("sunday"),
  ];

  return {
    planId: "plan-1",
    calorieTarget: 2400,
    proteinTargetG: 180,
    carbTargetG: 240,
    fatTargetG: 80,
    customMacrosEnabled: false,
    dietType: "balanced",
    unitPreference: "metric",
    baselineCalories: 2400,
    includeActivityBurn: true,
    dailyTargets,
    ...overrides,
  };
}

describe("ProgramNutritionPage", () => {
  beforeEach(() => {
    cleanup();
    swrCall.mockReset();
  });

  it("renders a skeleton while loading", () => {
    setSWR({ isLoading: true });
    const { container } = render(<ProgramNutritionPage />);
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("renders the load-error state on fetch error", () => {
    setSWR({ error: new Error("boom") });
    render(<ProgramNutritionPage />);
    expect(
      screen.getByText("We couldn't load your nutrition plan."),
    ).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();
  });

  it("renders the empty state when no active plan", () => {
    setSWR({ data: { success: true, data: null } });
    render(<ProgramNutritionPage />);
    expect(screen.getByText("No nutrition plan yet")).toBeInTheDocument();
  });

  it("renders the title, diet badge, and 7 day cards when populated", () => {
    setSWR({ data: { success: true, data: makeTargets() } });
    render(<ProgramNutritionPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Nutrition plan" })).toBeInTheDocument();
    expect(screen.getByText("balanced diet")).toBeInTheDocument();
    expect(screen.getByTestId("vertical-nutrition-view")).toHaveTextContent("7 day cards");
    expect(screen.queryByText("Custom macros")).toBeNull();
  });

  it("renders the custom-macros badge when customMacrosEnabled is true", () => {
    setSWR({
      data: { success: true, data: makeTargets({ customMacrosEnabled: true }) },
    });
    render(<ProgramNutritionPage />);
    expect(screen.getByText("Custom macros")).toBeInTheDocument();
  });

  it("renders the empty-targets message when dailyTargets is empty", () => {
    setSWR({
      data: { success: true, data: makeTargets({ dailyTargets: [] }) },
    });
    render(<ProgramNutritionPage />);
    expect(
      screen.getByText("No daily targets configured for this plan yet."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("vertical-nutrition-view")).toBeNull();
  });
});
