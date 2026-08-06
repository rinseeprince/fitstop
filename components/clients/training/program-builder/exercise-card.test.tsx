import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ExerciseCard } from "./exercise-card";
import { applySetSpecEdit, type SetSpecEdit } from "./use-set-spec-mutations";
import type { ExerciseDraft } from "./program-builder-types";

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars. Any
// test rendering a component that calls useUnits() must stub this module.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));


function makeExercise(overrides: Partial<ExerciseDraft> = {}): ExerciseDraft {
  return {
    uid: "ex-1",
    exerciseId: null,
    name: "Bench Press",
    setSpecs: null,
    sets: 4,
    repsMin: 8,
    repsMax: 12,
    repsTarget: null,
    rpeTarget: 8,
    percentage1rm: null,
    tempo: null,
    restSeconds: 120,
    supersetGroup: "A",
    isWarmup: false,
    notes: null,
    videoUrl: null,
    ...overrides,
  };
}

function Wrapper({
  exercise,
  mode = "edit",
  defaultExpanded,
  onRemove = () => undefined,
}: {
  exercise: ExerciseDraft;
  mode?: "view" | "edit";
  defaultExpanded?: boolean;
  onRemove?: () => void;
}) {
  // Stateful harness standing in for the draft: applies spec edits through
  // the real kernel so the test exercises the re-projection round-trip.
  const [current, setCurrent] = useState(exercise);
  const handleSpecEdit = (edit: SetSpecEdit) => {
    const result = applySetSpecEdit(current, edit);
    if (result.ok) setCurrent(result.exercise);
  };
  return (
    <DndContext>
      <SortableContext items={[current.uid]} strategy={verticalListSortingStrategy}>
        <ExerciseCard
          exercise={current}
          ordinal={1}
          mode={mode}
          defaultExpanded={defaultExpanded}
          onEdit={(patch) => setCurrent((e) => ({ ...e, ...patch }))}
          onSpecEdit={handleSpecEdit}
          onRemove={onRemove}
        />
      </SortableContext>
    </DndContext>
  );
}

describe("ExerciseCard", () => {
  beforeEach(() => cleanup());

  it("compact row shows the projected summary; legacy superset/warm-up fields render nothing", () => {
    // Fixture carries supersetGroup "A" + isWarmup — both retired from the
    // builder UI (warm-ups are a per-set type; supersets never functional).
    render(<Wrapper exercise={makeExercise({ isWarmup: true, videoUrl: "https://x.io/v" })} />);
    expect(screen.getByText("Bench Press")).toBeInTheDocument();
    expect(screen.getByText("4 × 8–12 @ RPE 8")).toBeInTheDocument();
    expect(screen.queryByText("SS A")).toBeNull();
    expect(screen.queryByText("Warm-up")).toBeNull();
    // Sets are hidden until expanded.
    expect(screen.queryByLabelText("Set 1 type")).toBeNull();
  });

  it("the expanded editor exposes no superset or warm-up controls", () => {
    render(<Wrapper exercise={makeExercise()} defaultExpanded />);
    expect(screen.queryByText("Superset group")).toBeNull();
    expect(screen.queryByText("Counts as warm-up work")).toBeNull();
    // The remaining exercise-level fields survive.
    expect(screen.getByText("Video URL")).toBeInTheDocument();
    expect(screen.getByText("Coach note")).toBeInTheDocument();
  });

  it("expanding a compact-only exercise synthesizes per-set rows (expand-on-read)", () => {
    render(<Wrapper exercise={makeExercise()} />);
    fireEvent.click(screen.getByLabelText("Expand sets"));
    // 4 compact sets → 4 working rows.
    expect(screen.getByLabelText("Set 1 type")).toBeInTheDocument();
    expect(screen.getByLabelText("Set 4 type")).toBeInTheDocument();
    expect(screen.queryByLabelText("Set 5 type")).toBeNull();
  });

  it("add-set re-projects the compact summary (5 × after adding to 4 working sets)", () => {
    render(<Wrapper exercise={makeExercise()} />);
    fireEvent.click(screen.getByLabelText("Expand sets"));
    fireEvent.click(screen.getByText("Add set"));
    expect(screen.getByLabelText("Set 5 type")).toBeInTheDocument();
    expect(screen.getByText("5 × 8–12 @ RPE 8")).toBeInTheDocument();
  });

  it("removing a set re-projects the compact summary down", () => {
    render(<Wrapper exercise={makeExercise()} />);
    fireEvent.click(screen.getByLabelText("Expand sets"));
    fireEvent.click(screen.getByLabelText("Remove set 4"));
    expect(screen.getByText("3 × 8–12 @ RPE 8")).toBeInTheDocument();
  });

  it("wires remove; view mode hides all editing affordances", () => {
    const onRemove = vi.fn();
    render(<Wrapper exercise={makeExercise()} onRemove={onRemove} />);
    fireEvent.click(screen.getByLabelText("Remove Bench Press"));
    expect(onRemove).toHaveBeenCalled();

    cleanup();
    render(<Wrapper exercise={makeExercise()} mode="view" />);
    expect(screen.queryByLabelText("Remove Bench Press")).toBeNull();
    expect(screen.queryByLabelText("Drag Bench Press")).toBeNull();
    fireEvent.click(screen.getByLabelText("Expand sets"));
    expect(screen.queryByText("Add set")).toBeNull();
    expect(screen.queryByLabelText("Duplicate set 1")).toBeNull();
  });

  it("defaultExpanded opens straight into per-set authoring", () => {
    render(<Wrapper exercise={makeExercise()} defaultExpanded />);
    // No expand click — the set rows are already there.
    expect(screen.getByLabelText("Set 1 type")).toBeInTheDocument();
    expect(screen.getByLabelText("Set 4 type")).toBeInTheDocument();
  });

  it("duplicate-set clones the row in place (values included) and renumbers", () => {
    render(
      <Wrapper
        exercise={makeExercise({
          sets: 2,
          repsMin: 5,
          repsMax: 10,
          rpeTarget: null,
          setSpecs: [
            { set_number: 1, set_type: "working", reps_min: 5, reps_max: 5 },
            { set_number: 2, set_type: "working", reps_min: 8, reps_max: 10 },
          ],
        })}
        defaultExpanded
      />,
    );
    fireEvent.click(screen.getByLabelText("Duplicate set 1"));
    // Row 2 is the clone of row 1; the old row 2 renumbered to 3.
    expect(screen.getByLabelText("Set 2 min reps")).toHaveValue(5);
    expect(screen.getByLabelText("Set 3 min reps")).toHaveValue(8);
    // Compact summary re-projected across the 3 working sets.
    expect(screen.getByText("3 × 5–10")).toBeInTheDocument();
  });
});
