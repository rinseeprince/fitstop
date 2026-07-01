import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { DraftEditor } from "./draft-editor";
import type { SavedPlan, SavedSession, SavedExercise } from "@/types/training";

// Guard test (builder S2.5, removed in Phase 5 with this editor): programs
// authored in the new Program builder (weekIndex > 0, setSpecs, or videoUrl)
// must not be overwritable from this drawer — its serializer omits those
// fields and overwrite is delete-then-reinsert, so one save would flatten them.

let planFixture: SavedPlan | null = null;
vi.mock("@/hooks/use-saved-plan", () => ({
  useSavedPlan: () => ({
    plan: planFixture,
    isLoading: false,
    mutate: vi.fn(() => Promise.resolve(undefined)),
  }),
}));
vi.mock("@/components/training-library/apply-to-client-dialog", () => ({
  ApplyToClientDialog: () => null,
}));
vi.mock("../library/add-library-exercise-dialog", () => ({
  AddLibraryExerciseDialog: () => null,
}));

function makeExercise(overrides: Partial<SavedExercise> = {}): SavedExercise {
  return {
    id: "ex-1",
    savedSessionId: "sess-1",
    exerciseId: null,
    name: "Bench Press",
    orderIndex: 0,
    sets: 3,
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
    setSpecs: null,
    videoUrl: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makePlan(exercise: SavedExercise): SavedPlan {
  const session: SavedSession = {
    id: "sess-1",
    coachId: "coach-1",
    savedPlanId: "plan-1",
    name: "Push",
    focus: null,
    orderIndex: 0,
    weekIndex: 0,
    isRest: false,
    estimatedDurationMinutes: null,
    calorieSurplusPercentage: null,
    notes: null,
    sessionType: "training",
    exercises: [exercise],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  return {
    id: "plan-1",
    coachId: "coach-1",
    name: "Plan",
    description: null,
    splitType: "custom",
    frequencyPerWeek: 1,
    status: "saved",
    cycleLength: 1,
    restPattern: [],
    defaultSurplusPercentage: null,
    source: "manual",
    coachPrompt: null,
    programDurationWeeks: null,
    sessions: [session],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("DraftEditor builder-authored guard", () => {
  beforeEach(() => cleanup());

  it("keeps Save and Update enabled for plain legacy plans", () => {
    planFixture = makePlan(makeExercise());
    render(<DraftEditor savedPlanId="plan-1" />);
    expect(screen.getByText("Save and Update Plan").closest("button")).toBeEnabled();
    expect(screen.queryByText("Edit this program in Programs")).toBeNull();
  });

  it.each([
    ["setSpecs", makeExercise({ setSpecs: [{ set_number: 1, set_type: "working" }] })],
    // videoUrl-only is the sneaky case: a 1-week builder program with videos
    // but no per-set edits would otherwise pass the guard and lose every
    // video_url on one drawer save.
    ["videoUrl", makeExercise({ videoUrl: "https://example.com/v" })],
  ])("disables Save and Update for builder-authored plans (%s)", (_label, exercise) => {
    planFixture = makePlan(exercise);
    render(<DraftEditor savedPlanId="plan-1" />);
    expect(screen.getByText("Save and Update Plan").closest("button")).toBeDisabled();
    expect(screen.getByText("Edit this program in Programs")).toBeInTheDocument();
  });
});
