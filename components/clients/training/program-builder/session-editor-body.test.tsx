import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SessionEditorBody } from "./session-editor-body";
import type { ExerciseDraft, SessionDraft } from "./program-builder-types";

// The picker fetches the catalog on mount — irrelevant to these tests.
vi.mock("./exercise-picker", () => ({
  ExercisePicker: () => <div data-testid="exercise-picker" />,
}));

function makeExercise(uid: string, sets: number): ExerciseDraft {
  return {
    uid,
    exerciseId: null,
    name: `Exercise ${uid}`,
    setSpecs: null,
    sets,
    repsMin: 8,
    repsMax: 12,
    repsTarget: null,
    rpeTarget: null,
    percentage1rm: null,
    tempo: null,
    restSeconds: null,
    supersetGroup: null,
    isWarmup: false,
    notes: null,
    videoUrl: null,
  };
}

function makeSession(uid: string, exercises: ExerciseDraft[]): SessionDraft {
  return {
    uid,
    name: "Push Day",
    focus: null,
    estimatedDurationMinutes: null,
    calorieSurplusPercentage: null,
    notes: null,
    sessionType: "training",
    exercises,
  };
}

const noop = () => undefined;
const bodyProps = {
  mode: "edit" as const,
  defaultSurplusPercentage: null,
  onUpdateSession: noop,
  onAddExercise: noop,
  onRemoveExercise: noop,
  onEditExercise: noop,
  onReorderExercise: noop,
  onSpecEdit: noop,
};

describe("SessionEditorBody — expand-on-add", () => {
  beforeEach(() => cleanup());

  it("exercises present at open stay compact; ones added during the session mount expanded", () => {
    const existing = makeExercise("ex-1", 4);
    const { rerender } = render(
      <SessionEditorBody session={makeSession("s-1", [existing])} {...bodyProps} />,
    );
    // Nothing expanded at open.
    expect(screen.queryByLabelText("Set 1 type")).toBeNull();

    // The coach picks an exercise → it appends to the same session.
    const added = makeExercise("ex-2", 2);
    rerender(
      <SessionEditorBody
        session={makeSession("s-1", [existing, added])}
        {...bodyProps}
      />,
    );
    // The new card opened into per-set authoring (2 rows — ex-2's)…
    expect(screen.getByLabelText("Set 1 type")).toBeInTheDocument();
    expect(screen.getByLabelText("Set 2 type")).toBeInTheDocument();
    // …while the pre-existing 4-set card stayed compact.
    expect(screen.queryByLabelText("Set 4 type")).toBeNull();
  });

  it("switching to a different session resets newness — its exercises open compact", () => {
    const { rerender } = render(
      <SessionEditorBody
        session={makeSession("s-1", [makeExercise("ex-1", 4)])}
        {...bodyProps}
      />,
    );
    // A different session with entirely fresh uids: none of them are "new".
    rerender(
      <SessionEditorBody
        session={makeSession("s-2", [makeExercise("ex-9", 3)])}
        {...bodyProps}
      />,
    );
    expect(screen.queryByLabelText("Set 1 type")).toBeNull();
  });
});
