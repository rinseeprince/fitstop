import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import type { SavedSession, Exercise } from "@/types/training";
import { BuilderLibraryPanel } from "./builder-library-panel";

// -- mocks --------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const sessionMutate = vi.fn();
const sessions: SavedSession[] = [
  {
    id: "sess-1",
    name: "Push Day A",
    focus: "Chest",
    exercises: [{}, {}, {}],
    estimatedDurationMinutes: 60,
  } as unknown as SavedSession,
  {
    id: "sess-2",
    name: "Pull Day A",
    focus: null,
    exercises: [{}],
    estimatedDurationMinutes: null,
  } as unknown as SavedSession,
];
vi.mock("@/hooks/use-standalone-sessions", () => ({
  useStandaloneSessions: () => ({
    sessions,
    isLoading: false,
    error: null,
    mutate: sessionMutate,
  }),
}));

const catalogMutate = vi.fn();
const exercises: Exercise[] = [
  {
    id: "ex-custom",
    coachId: "coach-1",
    name: "My Custom Curl",
    muscleGroup: "biceps",
    equipment: "dumbbell",
    category: null,
    aliases: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "ex-global",
    coachId: null,
    name: "Back Squat",
    muscleGroup: "quads",
    equipment: "barbell",
    category: "compound",
    aliases: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];
vi.mock("@/hooks/use-exercise-catalog", () => ({
  useExerciseCatalog: () => ({
    exercises,
    isLoading: false,
    error: null,
    mutate: catalogMutate,
  }),
}));

function renderPanel(mode: "view" | "edit" = "edit") {
  return render(
    <DndContext>
      <BuilderLibraryPanel mode={mode} />
    </DndContext>,
  );
}

// -- tests --------------------------------------------------------------------

describe("BuilderLibraryPanel", () => {
  beforeEach(() => {
    cleanup();
  });

  it("shows the Sessions tab by default with the breadcrumb + session cards", () => {
    renderPanel();
    expect(screen.getByRole("link", { name: /All programs/ })).toHaveAttribute(
      "href",
      "/dashboard/programs",
    );
    expect(screen.getByText("Push Day A")).toBeInTheDocument();
    expect(screen.getByText("Pull Day A")).toBeInTheDocument();
    // Grip handles present (drag source).
    expect(screen.getByLabelText("Drag Push Day A")).toBeInTheDocument();
    // Per-card CRUD + a create affordance.
    expect(screen.getAllByLabelText("Edit").length).toBe(2);
    expect(screen.getAllByLabelText("Duplicate").length).toBe(2);
    expect(screen.getAllByLabelText("Delete").length).toBe(2);
    expect(screen.getByRole("button", { name: /New session/ })).toBeInTheDocument();
  });

  it("switches to the Exercises tab and lists the catalog", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Exercises" }));
    expect(screen.getByText("My Custom Curl")).toBeInTheDocument();
    expect(screen.getByText("Back Squat")).toBeInTheDocument();
    expect(screen.getByLabelText("Drag My Custom Curl")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New exercise/ })).toBeInTheDocument();
    // Session cards are gone (only the active tab renders).
    expect(screen.queryByText("Push Day A")).toBeNull();
  });

  it("shows Edit/Delete only on coach-owned exercises (global rows are read-only)", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Exercises" }));
    // Exactly one Edit + one Delete — the custom row; the global row has none.
    expect(screen.getAllByLabelText("Edit").length).toBe(1);
    expect(screen.getAllByLabelText("Delete").length).toBe(1);
  });

  it("renders in view mode with grips still present", () => {
    renderPanel("view");
    expect(screen.getByText("Push Day A")).toBeInTheDocument();
    expect(screen.getByLabelText("Drag Push Day A")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New session/ })).toBeInTheDocument();
  });
});
