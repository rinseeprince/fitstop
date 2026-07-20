import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ProgramsTable } from "./programs-table";
import type { SavedPlanListItem } from "@/types/training";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// The table now drives server-side pagination — the hook is called with the
// live search/segment/sort/page params (captured here) and returns lean rows.
const mockMutate = vi.fn();
let mockPlans: SavedPlanListItem[] = [];
let mockTotal = 0;
const lastParams: { current: Record<string, unknown> | null } = { current: null };
vi.mock("@/hooks/use-saved-plans-page", () => ({
  useSavedPlansPage: (params: Record<string, unknown>) => {
    lastParams.current = params;
    return {
      plans: mockPlans,
      total: mockTotal,
      isLoading: false,
      isValidating: false,
      mutate: mockMutate,
    };
  },
}));

function makeItem(overrides: Partial<SavedPlanListItem>): SavedPlanListItem {
  return {
    id: "plan-1",
    name: "PPL Program",
    description: null,
    splitType: "push_pull_legs",
    source: "manual",
    status: "saved",
    frequencyPerWeek: 3,
    weekCount: 1,
    totalSlots: 7,
    restCount: 0,
    trainingCount: 7,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

describe("ProgramsTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastParams.current = null;
    mockPlans = [
      makeItem({ id: "plan-1", name: "PPL Program", source: "manual" }),
      makeItem({ id: "plan-2", name: "Glute Focus", source: "ai" }),
      makeItem({ id: "plan-3", name: "Old Draft", status: "draft" }),
    ];
    mockTotal = 3;
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the page rows including a Draft badge + the server total", () => {
    render(<ProgramsTable />);
    expect(screen.getByText("PPL Program")).toBeDefined();
    expect(screen.getByText("Old Draft")).toBeDefined();
    expect(screen.getByText("Draft")).toBeDefined();
    expect(screen.getByText("Showing 3 of 3 programs")).toBeDefined();
  });

  it("threads the source segment to the server hook", () => {
    render(<ProgramsTable />);
    fireEvent.click(screen.getByRole("button", { name: "AI generated" }));
    expect(lastParams.current?.segment).toBe("ai");
  });

  it("debounces the search into the server hook", async () => {
    render(<ProgramsTable />);
    fireEvent.change(screen.getByPlaceholderText("Search programs"), {
      target: { value: "glute" },
    });
    await waitFor(() => {
      expect(lastParams.current?.search).toBe("glute");
    });
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

  it("the + button opens the create modal without creating anything", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ProgramsTable />);

    fireEvent.click(screen.getByLabelText("New program"));

    // The modal is open (its submit button is present) ...
    expect(screen.getByRole("button", { name: "Create program" })).toBeDefined();
    // ... and merely opening it neither POSTs nor navigates.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("shows the empty state when there are no programs", () => {
    mockPlans = [];
    mockTotal = 0;
    render(<ProgramsTable />);
    expect(screen.getByText("No programs yet")).toBeDefined();
  });
});
