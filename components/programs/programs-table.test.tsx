import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ProgramsTable } from "./programs-table";
import type { SavedPlan } from "@/types/training";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockMutate = vi.fn();
let mockPlans: SavedPlan[] = [];
vi.mock("@/hooks/use-saved-plans", () => ({
  useSavedPlans: () => ({ plans: mockPlans, isLoading: false, mutate: mockMutate }),
}));

function makePlan(overrides: Partial<SavedPlan>): SavedPlan {
  return {
    id: "plan-1",
    name: "PPL Program",
    description: null,
    splitType: "push_pull_legs",
    frequencyPerWeek: 3,
    status: "saved",
    source: "manual",
    coachPrompt: null,
    cycleLength: 7,
    restPattern: [],
    defaultSurplusPercentage: null,
    programDurationWeeks: null,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    sessions: [
      {
        id: "s1",
        savedPlanId: "plan-1",
        name: "Push",
        focus: null,
        orderIndex: 0,
        weekIndex: 0,
        isRest: false,
        estimatedDurationMinutes: null,
        calorieSurplusPercentage: null,
        notes: null,
        sessionType: "training",
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-01T00:00:00Z",
        exercises: [],
      },
    ],
    ...overrides,
  } as SavedPlan;
}

describe("ProgramsTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlans = [
      makePlan({ id: "plan-1", name: "PPL Program", source: "manual" }),
      makePlan({ id: "plan-2", name: "Glute Focus", source: "ai" }),
      makePlan({ id: "plan-3", name: "Old Draft", status: "draft" }),
    ];
  });

  afterEach(() => {
    cleanup();
  });

  it("shows all plans including drafts with a Draft badge", () => {
    render(<ProgramsTable />);
    expect(screen.getByText("PPL Program")).toBeDefined();
    expect(screen.getByText("Old Draft")).toBeDefined();
    expect(screen.getByText("Draft")).toBeDefined();
    expect(screen.getByText("Showing 3 of 3 programs")).toBeDefined();
  });

  it("filters by search query and updates the count", () => {
    render(<ProgramsTable />);
    fireEvent.change(screen.getByPlaceholderText("Search programs"), {
      target: { value: "glute" },
    });
    expect(screen.queryByText("PPL Program")).toBeNull();
    expect(screen.getByText("Glute Focus")).toBeDefined();
    expect(screen.getByText("Showing 1 of 3 programs")).toBeDefined();
  });

  it("filters by source via the segmented control", () => {
    render(<ProgramsTable />);
    fireEvent.click(screen.getByRole("button", { name: "AI generated" }));
    expect(screen.queryByText("PPL Program")).toBeNull();
    expect(screen.getByText("Glute Focus")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByText("PPL Program")).toBeDefined();
    expect(screen.queryByText("Glute Focus")).toBeNull();
  });

  it("opens the builder on row click", () => {
    render(<ProgramsTable />);
    fireEvent.click(screen.getByText("Glute Focus"));
    expect(mockPush).toHaveBeenCalledWith("/dashboard/programs/plan-2");
  });

  it("duplicates via the row action without navigating", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProgramsTable />);

    fireEvent.click(screen.getAllByRole("button", { name: "Duplicate" })[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/training\/saved-plans\/plan-\d\/duplicate$/),
        { method: "POST" },
      );
    });
    await waitFor(() => expect(mockMutate).toHaveBeenCalled());
    expect(mockPush).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("shows the empty state when there are no programs", () => {
    mockPlans = [];
    render(<ProgramsTable />);
    expect(screen.getByText("No programs yet")).toBeDefined();
  });
});
