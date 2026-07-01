import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ExerciseCard } from "./exercise-card";
import { applySetSpecEdit, type SetSpecEdit } from "./use-set-spec-mutations";
import type { ExerciseDraft } from "./program-builder-types";

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
  onRemove = () => undefined,
}: {
  exercise: ExerciseDraft;
  mode?: "view" | "edit";
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
          mode={mode}
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

  it("compact row shows the projected summary and badges", () => {
    render(<Wrapper exercise={makeExercise({ isWarmup: true, videoUrl: "https://x.io/v" })} />);
    expect(screen.getByText("Bench Press")).toBeInTheDocument();
    expect(screen.getByText("4 × 8–12 @ RPE 8")).toBeInTheDocument();
    expect(screen.getByText("SS A")).toBeInTheDocument();
    expect(screen.getByText("Warm-up")).toBeInTheDocument();
    // Sets are hidden until expanded.
    expect(screen.queryByLabelText("Set 1 type")).toBeNull();
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
  });
});
