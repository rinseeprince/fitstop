import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { AddSessionPopover, type AddSessionTarget } from "./add-session-popover";
import type { SavedSession } from "@/types/training";

let mockSessions: SavedSession[] = [];
vi.mock("@/hooks/use-standalone-sessions", () => ({
  useStandaloneSessions: () => ({
    sessions: mockSessions,
    isLoading: false,
    mutate: vi.fn(),
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
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  } as SavedSession;
}

function makeTarget(): AddSessionTarget {
  return {
    slotUid: "slot-1",
    weekIndex: 1,
    dayIndex: 2,
    anchorEl: document.createElement("div"),
  };
}

describe("AddSessionPopover", () => {
  const onClose = vi.fn();
  const onPickSession = vi.fn();
  const onCreateBlank = vi.fn();

  const renderPopover = (target: AddSessionTarget | null = makeTarget()) =>
    render(
      <AddSessionPopover
        target={target}
        onClose={onClose}
        onPickSession={onPickSession}
        onCreateBlank={onCreateBlank}
      />,
    );

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockSessions = [
      makeSession({ id: "s1", name: "Push Day A", focus: "push" }),
      makeSession({ id: "s2", name: "Leg Day A", focus: "legs" }),
    ];
  });

  it("renders nothing without a target", () => {
    renderPopover(null);
    expect(screen.queryByText("Add session")).toBeNull();
  });

  it("shows the week/day context and the session list", () => {
    renderPopover();
    expect(screen.getByText("Add session")).toBeInTheDocument();
    expect(screen.getByText("Week 2 · Day 3")).toBeInTheDocument();
    expect(screen.getByText("Push Day A")).toBeInTheDocument();
    expect(screen.getByText("Leg Day A")).toBeInTheDocument();
  });

  it("filters via search and picks a session for the target slot", () => {
    renderPopover();
    fireEvent.change(screen.getByPlaceholderText("Search sessions"), {
      target: { value: "leg" },
    });
    expect(screen.queryByText("Push Day A")).toBeNull();

    fireEvent.click(screen.getByText("Leg Day A"));
    expect(onPickSession).toHaveBeenCalledWith(
      expect.objectContaining({ slotUid: "slot-1" }),
      expect.objectContaining({ id: "s2" }),
    );
  });

  it("hands off to the create-blank flow with the target", () => {
    renderPopover();
    fireEvent.click(screen.getByText("Create blank session"));
    expect(onCreateBlank).toHaveBeenCalledWith(
      expect.objectContaining({ slotUid: "slot-1", weekIndex: 1, dayIndex: 2 }),
    );
  });

  it("closes on window scroll (anchor cell scrolls away)", () => {
    renderPopover();
    fireEvent.scroll(window);
    expect(onClose).toHaveBeenCalled();
  });
});
