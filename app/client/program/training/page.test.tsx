import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import ProgramTrainingPage from "./page";
import type { ClientTrainingPlan } from "@/types/client-training-plan";

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
        name: "Rest",
        focus: null,
        orderIndex: 2,
        isRest: true,
        estimatedDurationMinutes: null,
        exercises: [],
      },
    ],
    ...overrides,
  };
}

describe("ProgramTrainingPage", () => {
  beforeEach(() => {
    swrCall.mockReset();
    setSWR();
    cleanup();
  });

  it("renders the skeleton while loading", () => {
    setSWR({ isLoading: true });
    const { container } = render(<ProgramTrainingPage />);

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByText("PPL+Rest")).toBeNull();
  });

  it("renders the empty state when API returns null data", () => {
    setSWR({ data: { success: true, data: null } });
    render(<ProgramTrainingPage />);

    expect(screen.getByText("No training plan yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your coach hasn't set up your training plan. Check back soon.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the plan name and sessions list when data is present", () => {
    setSWR({ data: { success: true, data: makePlan() } });
    render(<ProgramTrainingPage />);

    expect(screen.getByText("PPL+Rest")).toBeInTheDocument();
    expect(screen.getByText("Push")).toBeInTheDocument();
    expect(screen.getByText("Pull")).toBeInTheDocument();
    expect(screen.getByText("Rest")).toBeInTheDocument();
    // A running program says nothing about its dates.
    expect(screen.queryByText(/^Starts /)).toBeNull();
  });

  it("dates a queued program so it can't be mistaken for the current one", () => {
    setSWR({
      data: {
        success: true,
        data: makePlan({ state: "upcoming", startsOn: "2026-08-17" }),
      },
    });
    render(<ProgramTrainingPage />);

    expect(screen.getByText("Starts Mon, Aug 17")).toBeInTheDocument();
  });

  it("dates a finished program instead of showing it as current", () => {
    setSWR({
      data: {
        success: true,
        data: makePlan({ state: "ended", endsOn: "2026-08-02" }),
      },
    });
    render(<ProgramTrainingPage />);

    expect(screen.getByText("Ended Sun, Aug 2")).toBeInTheDocument();
  });
});
