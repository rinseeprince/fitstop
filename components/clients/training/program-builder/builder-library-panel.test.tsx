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
const BASE_EXERCISES: Exercise[] = [
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
// Reassigned per-test so the catalog-cap test can supply a large catalog.
let exercises: Exercise[] = BASE_EXERCISES;
vi.mock("@/hooks/use-exercise-catalog", () => ({
  useExerciseCatalog: () => ({
    exercises,
    isLoading: false,
    error: null,
    mutate: catalogMutate,
  }),
}));

const onBack = vi.fn();

function renderPanel(mode: "view" | "edit" = "edit") {
  return render(
    <DndContext>
      <BuilderLibraryPanel mode={mode} backLabel="Back to programs" onBack={onBack} />
    </DndContext>,
  );
}

// -- tests --------------------------------------------------------------------

describe("BuilderLibraryPanel", () => {
  beforeEach(() => {
    cleanup();
    exercises = BASE_EXERCISES;
    onBack.mockClear();
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
    // Per-card CRUD + a create affordance (no Duplicate — dragging onto the
    // program already clones the session).
    expect(screen.getAllByLabelText("Edit").length).toBe(2);
    expect(screen.queryByLabelText("Duplicate")).toBeNull();
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

  it("routes a plain click on the back link through the guarded exit, not the href", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("link", { name: /All programs/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("leaves a modified click to the browser — a new tab can't drop the draft", () => {
    renderPanel();
    const link = screen.getByRole("link", { name: /All programs/ });
    // jsdom can't navigate; swallow the default before React sees the click so
    // the assertion is about our handler, not about jsdom's missing navigation.
    link.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(link, { metaKey: true });
    expect(onBack).not.toHaveBeenCalled();
  });

  it("names the CLIENT (not a destination) in the client-scoped remounts, keeping drag sources", () => {
    render(
      <DndContext>
        <BuilderLibraryPanel
          mode="edit"
          clientName="Jane Doe"
          backLabel="Back to calendar"
          onBack={onBack}
        />
      </DndContext>,
    );
    expect(screen.getByText("Editing for")).toBeInTheDocument();
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    // No "All programs" link — it would navigate away from the client page.
    expect(screen.queryByRole("link", { name: /All programs/ })).toBeNull();
    expect(screen.queryByText("Program Builder")).toBeNull();
    // The arrow is the only interactive part of the header, and it exits.
    fireEvent.click(screen.getByLabelText("Back to calendar"));
    expect(onBack).toHaveBeenCalledTimes(1);
    // Drag sources + session CRUD stay reachable in the embedded panel.
    expect(screen.getByLabelText("Drag Push Day A")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New session/ })).toBeInTheDocument();
  });

  it("shows the 'All programs' back row without a client name (library mode)", () => {
    renderPanel();
    expect(screen.getByRole("link", { name: /All programs/ })).toBeInTheDocument();
    expect(screen.queryByText("Editing for")).toBeNull();
    // The title moved to the main column's header band.
    expect(screen.queryByText("Program Builder")).toBeNull();
  });

  it("Exercises tab caps a huge catalog at the 10 most recent; search surfaces the rest", () => {
    // A large catalog is the whole reason for the cap — 30 rows, createdAt
    // increasing so "Exercise 29" is the newest.
    exercises = Array.from({ length: 30 }, (_, i) => ({
      id: `ex-${i}`,
      coachId: null,
      name: `Exercise ${i}`,
      muscleGroup: null,
      equipment: null,
      category: null,
      aliases: [],
      createdAt: `2026-02-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      updatedAt: "2026-01-01T00:00:00Z",
    }));
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Exercises" }));

    // Only 10 draggable cards render by default (not 30 → not 1000+).
    expect(screen.getAllByLabelText(/^Drag /)).toHaveLength(10);
    // Newest-first: the last-created shows, the oldest does not.
    expect(screen.getByText("Exercise 29")).toBeInTheDocument();
    expect(screen.queryByText("Exercise 0")).toBeNull();
    expect(screen.getByText(/search to find any/)).toBeInTheDocument();

    // The search bar is the escape hatch for everything off the recent list.
    fireEvent.change(screen.getByLabelText("Search exercises"), {
      target: { value: "Exercise 0" },
    });
    expect(screen.getByText("Exercise 0")).toBeInTheDocument();
  });
});
