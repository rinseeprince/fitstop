import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import type { ReactNode } from "react";
import type { Exercise } from "@/types/training";
import { LibraryExerciseList } from "./library-exercise-list";

// jsdom never paints and Radix Presence unmounts at once there, so the exit
// frame is not observable. What IS observable is the shape that keeps it
// right: each dialog gets `open` apart from its subject, a close flips `open`
// and leaves the subject, and the next show replaces it (CONVENTIONS §7 →
// "No frame disagrees", rule 5). The dialogs are stubbed to expose exactly
// those props.

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

const catalogMutate = vi.fn();
const exercises: Exercise[] = [
  {
    id: "ex-curl",
    coachId: "coach-1",
    name: "My Custom Curl",
    muscleGroup: "biceps",
    equipment: "dumbbell",
    category: null,
    exerciseType: "strength",
    aliases: [],
    createdAt: "2026-01-02T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
  },
  {
    id: "ex-press",
    coachId: "coach-1",
    name: "My Custom Press",
    muscleGroup: "chest",
    equipment: "dumbbell",
    category: null,
    exerciseType: "holds",
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

// The stub carries the id of its mount: the host keys the form by the opening,
// so each open mounts it fresh on its exercise and a close keeps the mount.
const formMounts = vi.hoisted(() => ({ next: 0 }));
vi.mock("@/components/programs/exercise-form-dialog", async () => {
  const { useState } = await import("react");
  return {
    ExerciseFormDialog: ({
      open,
      onOpenChange,
      exercise,
    }: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      exercise?: Exercise | null;
    }): ReactNode => {
      const [mount] = useState(() => ++formMounts.next);
      return (
        <div
          data-testid="exercise-form"
          data-open={String(open)}
          data-subject={exercise == null ? "" : exercise.id}
          data-mount={mount}
        >
          <button type="button" onClick={() => onOpenChange(false)}>
            Close form
          </button>
        </div>
      );
    },
  };
});

// The action mirrors AlertDialogAction: it runs onConfirm, then Radix closes.
vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: ({
    open,
    onOpenChange,
    description,
    onConfirm,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    description: string;
    onConfirm: () => void;
  }): ReactNode => (
    <div data-testid="confirm" data-open={String(open)} data-description={description}>
      <button type="button" onClick={() => onOpenChange(false)}>
        Cancel confirm
      </button>
      <button
        type="button"
        onClick={() => {
          onConfirm();
          onOpenChange(false);
        }}
      >
        Confirm
      </button>
    </div>
  ),
}));

const form = () => screen.getByTestId("exercise-form");
const confirm = () => screen.getByTestId("confirm");

function renderList() {
  return render(
    <DndContext>
      <LibraryExerciseList editable />
    </DndContext>,
  );
}

describe("LibraryExerciseList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => ({}) }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("each card names its type after its tags", () => {
    renderList();
    expect(screen.getByText("biceps · dumbbell · Strength")).toBeInTheDocument();
    expect(screen.getByText("chest · dumbbell · Holds")).toBeInTheDocument();
  });

  it("the form keeps its exercise through the close, and New exercise replaces it as it opens", () => {
    renderList();
    expect(form()).toHaveAttribute("data-open", "false");

    fireEvent.click(screen.getAllByLabelText("Edit")[0]);
    expect(form()).toHaveAttribute("data-open", "true");
    expect(form()).toHaveAttribute("data-subject", "ex-curl");

    fireEvent.click(screen.getByText("Close form"));
    expect(form()).toHaveAttribute("data-open", "false");
    expect(form()).toHaveAttribute("data-subject", "ex-curl");

    // No subject is the form's create mode.
    fireEvent.click(screen.getByRole("button", { name: /New exercise/ }));
    expect(form()).toHaveAttribute("data-open", "true");
    expect(form()).toHaveAttribute("data-subject", "");

    fireEvent.click(screen.getByText("Close form"));
    fireEvent.click(screen.getAllByLabelText("Edit")[1]);
    expect(form()).toHaveAttribute("data-open", "true");
    expect(form()).toHaveAttribute("data-subject", "ex-press");
  });

  it("each open mounts the form fresh, the same exercise included, and a close keeps its mount", () => {
    renderList();
    fireEvent.click(screen.getAllByLabelText("Edit")[0]);
    const opened = form().getAttribute("data-mount");
    fireEvent.click(screen.getByText("Close form"));
    expect(form()).toHaveAttribute("data-mount", opened);
    fireEvent.click(screen.getAllByLabelText("Edit")[0]);
    expect(form()).toHaveAttribute("data-subject", "ex-curl");
    expect(form().getAttribute("data-mount")).not.toBe(opened);
  });

  it("the delete confirm keeps naming its exercise through the close, and the next show replaces it", () => {
    renderList();

    fireEvent.click(screen.getAllByLabelText("Delete")[0]);
    expect(confirm()).toHaveAttribute("data-open", "true");
    expect(confirm().getAttribute("data-description")).toContain('"My Custom Curl"');

    fireEvent.click(screen.getByText("Cancel confirm"));
    expect(confirm()).toHaveAttribute("data-open", "false");
    expect(confirm().getAttribute("data-description")).toContain('"My Custom Curl"');

    fireEvent.click(screen.getAllByLabelText("Delete")[1]);
    expect(confirm()).toHaveAttribute("data-open", "true");
    expect(confirm().getAttribute("data-description")).toContain('"My Custom Press"');
  });

  it("confirming deletes the subject and the closing card still names it", async () => {
    renderList();

    fireEvent.click(screen.getAllByLabelText("Delete")[0]);
    fireEvent.click(screen.getByText("Confirm"));

    expect(confirm()).toHaveAttribute("data-open", "false");
    expect(confirm().getAttribute("data-description")).toContain('"My Custom Curl"');
    expect(fetch).toHaveBeenCalledWith("/api/training/exercises/ex-curl", {
      method: "DELETE",
    });
    await waitFor(() => expect(catalogMutate).toHaveBeenCalledTimes(1));
  });
});
