import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SessionEditorBody } from "./session-editor-body";
import { applySetSpecEdit } from "@/utils/set-spec-edits";
import type { ExerciseDraft, SessionDraft } from "./program-builder-types";

// The picker fetches the catalog on mount — irrelevant to these tests.
vi.mock("./exercise-picker", () => ({
  ExercisePicker: () => <div data-testid="exercise-picker" />,
}));

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars. Any
// test rendering a component that calls useUnits() must stub this module.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
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
    prescribedFields: null,
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

describe("SessionEditorBody — identity editability", () => {
  beforeEach(() => cleanup());

  it("keeps name + focus editable by default (the program builder)", () => {
    render(<SessionEditorBody session={makeSession("s-1", [])} {...bodyProps} />);
    expect(screen.getByLabelText("Session name")).not.toBeDisabled();
    expect(screen.getByLabelText("Focus")).not.toBeDisabled();
  });

  it("locks name + focus (not the training) when identityEditable is false — the client editor", () => {
    render(
      <SessionEditorBody
        session={makeSession("s-1", [])}
        {...bodyProps}
        identityEditable={false}
      />,
    );
    expect(screen.getByLabelText("Session name")).toBeDisabled();
    expect(screen.getByLabelText("Focus")).toBeDisabled();
    // The training itself stays editable — the surplus field is not disabled.
    expect(screen.getByLabelText(/Calorie surplus/)).not.toBeDisabled();
  });
});

describe("SessionEditorBody — accordion", () => {
  beforeEach(() => cleanup());

  // Stateful host: edits write through to the draft exactly as the builder's
  // provider does, which is what makes collapsing non-destructive.
  function Host({ chrome }: { chrome?: "hero" | "inline" }) {
    const [session, setSession] = useState(
      makeSession("s-1", [makeExercise("ex-1", 2), makeExercise("ex-2", 2)]),
    );
    return (
      <SessionEditorBody
        {...bodyProps}
        chrome={chrome}
        session={session}
        onSpecEdit={(_uid, exercise, edit) => {
          const result = applySetSpecEdit(exercise, edit);
          if (!result.ok) return;
          setSession((s) => ({
            ...s,
            exercises: s.exercises.map((e) =>
              e.uid === exercise.uid ? result.exercise : e,
            ),
          }));
        }}
      />
    );
  }

  it("opens one exercise at a time — opening the second collapses the first", () => {
    render(<Host />);
    // Both start collapsed; open the first.
    fireEvent.click(screen.getAllByLabelText("Expand sets")[0]);
    expect(screen.getByLabelText("Set 1 reps")).toBeInTheDocument();

    // Now open the second — the only remaining "Expand sets" chevron.
    fireEvent.click(screen.getByLabelText("Expand sets"));
    // Still exactly one grid on screen, not two.
    expect(screen.getAllByLabelText("Set 1 reps")).toHaveLength(1);
  });

  it("collapsing keeps the edit — the draft is the source of truth, not the inputs", () => {
    render(<Host />);
    const chevrons = screen.getAllByLabelText("Expand sets");
    fireEvent.click(chevrons[0]);

    const reps = screen.getByLabelText("Set 1 reps");
    fireEvent.change(reps, { target: { value: "6-9" } });
    fireEvent.blur(reps);

    // Collapse, then reopen the same exercise.
    fireEvent.click(screen.getByLabelText("Collapse sets"));
    expect(screen.queryByLabelText("Set 1 reps")).toBeNull();
    fireEvent.click(screen.getAllByLabelText("Expand sets")[0]);

    expect(screen.getByLabelText("Set 1 reps")).toHaveValue("6-9");
  });

  it("hero chrome leaves the session name and surplus to the hero", () => {
    render(<Host chrome="hero" />);
    expect(screen.queryByLabelText("Session name")).toBeNull();
    expect(screen.queryByLabelText(/Calorie surplus/)).toBeNull();
    // Focus and duration stay in the body.
    expect(screen.getByLabelText("Focus")).toBeInTheDocument();
  });
});
