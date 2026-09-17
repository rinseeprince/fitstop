import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SessionEditorSheet } from "./session-editor-sheet";
import type { SessionDraft } from "./program-builder-types";

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

const session: SessionDraft = {
  uid: "sess-1",
  name: "Push Day",
  focus: null,
  estimatedDurationMinutes: null,
  calorieSurplusPercentage: null,
  notes: null,
  sessionType: "training",
  groups: [],
};

const noop = () => undefined;
const props = {
  session,
  mode: "edit" as const,
  defaultSurplusPercentage: null,
  onUpdateSession: noop,
  onAddExercise: noop,
  onRemoveExercise: noop,
  onEditExercise: noop,
  onLinkExercises: noop,
  onUnlinkGroup: noop,
  onMoveExercise: noop,
  onMoveGroup: noop,
  onUpdateGroup: noop,
  onSpecEdit: noop,
  onClose: noop,
  onSaveAsWorkout: noop,
  isSavingWorkout: false,
};

// jsdom never paints and Radix unmounts a closing node at once, so the exit
// frame is not observable here: these pin the shape instead — `open` is the
// sheet's own prop, so a closed sheet can still hold the session it showed.
describe("SessionEditorSheet — open is its own prop", () => {
  beforeEach(() => cleanup());

  it("open renders the session's editor", () => {
    render(<SessionEditorSheet {...props} open />);
    expect(screen.getByRole("dialog", { name: "Push Day" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("closed while still holding its session renders no sheet", () => {
    render(<SessionEditorSheet {...props} open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  });
});
