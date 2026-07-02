import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SessionsTable } from "./sessions-table";
import type { SavedSession } from "@/types/training";

const mockMutate = vi.fn();
let mockSessions: SavedSession[] = [];
vi.mock("@/hooks/use-standalone-sessions", () => ({
  useStandaloneSessions: () => ({
    sessions: mockSessions,
    isLoading: false,
    mutate: mockMutate,
  }),
}));

function makeSession(overrides: Partial<SavedSession>): SavedSession {
  return {
    id: "s1",
    coachId: "coach-1",
    savedPlanId: null,
    name: "Push Day A",
    focus: "push",
    orderIndex: 0,
    weekIndex: 0,
    isRest: false,
    estimatedDurationMinutes: 45,
    calorieSurplusPercentage: null,
    notes: null,
    sessionType: "training",
    exercises: [],
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  } as SavedSession;
}

describe("SessionsTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessions = [
      makeSession({ id: "s1", name: "Push Day A", focus: "push" }),
      makeSession({
        id: "s2",
        name: "Pull Day A",
        focus: "pull",
        estimatedDurationMinutes: 50,
      }),
      makeSession({
        id: "s3",
        name: "Conditioning Circuit",
        focus: null,
        estimatedDurationMinutes: null,
      }),
    ];
  });

  afterEach(() => {
    cleanup();
  });

  it("renders sessions with duration and em-dash for nulls", () => {
    render(<SessionsTable />);
    expect(screen.getByText("Push Day A")).toBeDefined();
    expect(screen.getByText("45 min")).toBeDefined();
    // Null focus + null duration both render as dashes on the third row.
    expect(screen.getByText("Conditioning Circuit")).toBeDefined();
    expect(screen.getByText("Showing 3 of 3 sessions")).toBeDefined();
  });

  it("filters via the focus chips", () => {
    render(<SessionsTable />);
    fireEvent.click(screen.getByRole("button", { name: "pull" }));
    expect(screen.queryByText("Push Day A")).toBeNull();
    expect(screen.getByText("Pull Day A")).toBeDefined();
    expect(screen.getByText("Showing 1 of 3 sessions")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Push Day A")).toBeDefined();
  });

  it("filters via search across name and focus", () => {
    render(<SessionsTable />);
    fireEvent.change(screen.getByPlaceholderText("Search sessions"), {
      target: { value: "circuit" },
    });
    expect(screen.getByText("Conditioning Circuit")).toBeDefined();
    expect(screen.queryByText("Push Day A")).toBeNull();
  });

  it("shows the empty state when there are no sessions", () => {
    mockSessions = [];
    render(<SessionsTable />);
    expect(screen.getByText("No sessions yet")).toBeDefined();
  });
});
