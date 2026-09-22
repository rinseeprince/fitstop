import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Exercise } from "@/types/training";
import { EXERCISE_CATALOG_KEY } from "@/hooks/use-exercise-catalog";
import { AddExercisePopover } from "./add-exercise-popover";

// The picker and the form are stubbed so nothing but this component decides
// what is open. The real form's focus trap would close the popover on its own
// a commit later — the frame with both open that this pins away (CONVENTIONS
// §7 → "No frame disagrees", rule 2: one click, one commit).
const fixtures = vi.hoisted(() => ({
  created: {
    id: "ex-zone2",
    coachId: "coach-1",
    name: "Zone 2 Run",
    muscleGroup: null,
    equipment: null,
    category: null,
    exerciseType: "endurance",
    aliases: [],
    createdAt: "2026-09-22T00:00:00Z",
    updatedAt: "2026-09-22T00:00:00Z",
  } satisfies Exercise,
  catalogMutate: vi.fn(),
}));

vi.mock("swr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("swr")>()),
  useSWRConfig: () => ({ mutate: fixtures.catalogMutate }),
}));

vi.mock("./exercise-picker", () => ({
  ExercisePicker: ({ onCreate }: { onCreate: (name: string) => void }) => (
    <button type="button" onClick={() => onCreate("Zone 2 Run")}>
      Use Zone 2 Run
    </button>
  ),
}));

vi.mock("@/components/programs/exercise-form-dialog", () => ({
  ExerciseFormDialog: ({
    open,
    onOpenChange,
    initialName,
    onSaved,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initialName?: string;
    onSaved: (exercise: Exercise) => void;
  }): ReactNode => (
    <div data-testid="exercise-form" data-open={String(open)} data-name={initialName ?? ""}>
      {/* A save as the real form finishes one: the saved exercise to the host, then the close. */}
      <button
        type="button"
        onClick={() => {
          onSaved(fixtures.created);
          onOpenChange(false);
        }}
      >
        Save form
      </button>
    </div>
  ),
}));

const form = () => screen.getByTestId("exercise-form");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AddExercisePopover — a name the catalog doesn't have", () => {
  it("Use … closes the popover and opens New exercise on the name, in one click", () => {
    render(<AddExercisePopover onPick={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add exercise" }));
    expect(form()).toHaveAttribute("data-open", "false");

    fireEvent.click(screen.getByRole("button", { name: "Use Zone 2 Run" }));

    expect(screen.queryByRole("button", { name: "Use Zone 2 Run" })).toBeNull();
    expect(form()).toHaveAttribute("data-open", "true");
    expect(form()).toHaveAttribute("data-name", "Zone 2 Run");
  });

  it("the exercise the form creates is picked with its id and type, and the catalog reloads", () => {
    const onPick = vi.fn();
    render(<AddExercisePopover onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: "Add exercise" }));
    fireEvent.click(screen.getByRole("button", { name: "Use Zone 2 Run" }));

    fireEvent.click(screen.getByText("Save form"));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith({
      name: "Zone 2 Run",
      exerciseId: "ex-zone2",
      exerciseType: "endurance",
    });
    expect(fixtures.catalogMutate).toHaveBeenCalledWith(EXERCISE_CATALOG_KEY);
    expect(form()).toHaveAttribute("data-open", "false");
    // The form keeps its name through the close; the next Use replaces it.
    expect(form()).toHaveAttribute("data-name", "Zone 2 Run");
  });
});
