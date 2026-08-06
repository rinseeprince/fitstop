import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Exercise } from "@/types/training";
import type { SetSpec } from "@/utils/exercise-set-specs";
import { DuplicateWeekDialog } from "./duplicate-week-dialog";
import { makeRestWeek, type ExerciseDraft, type WeekDraft } from "./program-builder-types";

const catalogState: {
  exercises: Exercise[];
  isLoading: boolean;
  error: Error | null;
} = { exercises: [], isLoading: false, error: null };

vi.mock("@/hooks/use-exercise-catalog", () => ({
  useExerciseCatalog: () => ({ ...catalogState, mutate: vi.fn() }),
}));

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars. Any
// test rendering a component that calls useUnits() must stub this module.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));


function catalogEntry(over: Partial<Exercise>): Exercise {
  return {
    id: "e-bench",
    coachId: null,
    name: "Bench Press",
    muscleGroup: null,
    equipment: null,
    category: null,
    aliases: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function draftExercise(over: Partial<ExerciseDraft>): ExerciseDraft {
  return {
    uid: "ex-x",
    exerciseId: null,
    name: "Exercise",
    setSpecs: null,
    sets: 3,
    repsMin: 10,
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
    ...over,
  };
}

const working = (n: number, load: number, reps: [number, number]): SetSpec => ({
  set_number: n,
  set_type: "working",
  load_type: "absolute",
  load_value: load,
  reps_min: reps[0],
  reps_max: reps[1],
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

// Day 1: Push (surplus 12) with a specs-bearing compound Bench + a
// compact-only free-text Curl. Days 2-7 rest. Frozen: any engine/dialog
// mutation of the source throws.
function makeWeek(): WeekDraft {
  const week = makeRestWeek(0);
  week.days[0] = {
    ...week.days[0],
    isRest: false,
    session: {
      uid: "sess-push",
      name: "Push",
      focus: "Chest",
      estimatedDurationMinutes: 60,
      calorieSurplusPercentage: 12,
      notes: null,
      sessionType: "training",
      exercises: [
        draftExercise({
          uid: "ex-bench",
          exerciseId: "e-bench",
          name: "Bench Press",
          setSpecs: [
            { set_number: 1, set_type: "warmup", load_type: "absolute", load_value: 60 },
            working(2, 100, [8, 10]),
            working(3, 90, [8, 10]),
            working(4, 90, [8, 10]),
          ],
        }),
        draftExercise({ uid: "ex-curl", exerciseId: null, name: "Cable Curl" }),
      ],
    },
  };
  return deepFreeze(week);
}

function renderDialog(over: { week?: WeekDraft; canAddWeek?: boolean } = {}) {
  const onCommit = vi.fn();
  const onClose = vi.fn();
  render(
    <DuplicateWeekDialog
      week={over.week ?? makeWeek()}
      canAddWeek={over.canAddWeek ?? true}
      onCommit={onCommit}
      onClose={onClose}
    />,
  );
  return { onCommit, onClose };
}

const commitButton = () => screen.getByRole("button", { name: "Duplicate week" });

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  catalogState.exercises = [
    catalogEntry({ id: "e-bench", name: "Bench Press", category: "Compound" }),
    catalogEntry({ id: "e-curl", name: "Cable Curl", category: "isolation" }),
  ];
  catalogState.isLoading = false;
  catalogState.error = null;
});

describe("DuplicateWeekDialog", () => {
  it("opens on Add load defaults with a live preview and no surplus control", () => {
    renderDialog();
    expect(screen.getByText("Duplicate Week 1")).toBeInTheDocument();
    // kg +2.5 changes only the absolute-loaded bench (compact-only curl has no kg loads)
    expect(screen.getByText("1 of 2 exercises change")).toBeInTheDocument();
    expect(screen.getByText("100 / 90 / 90 kg")).toBeInTheDocument();
    expect(screen.getByText("102.5 / 92.5 / 92.5 kg")).toBeInTheDocument();
    expect(screen.getByText("No change")).toBeInTheDocument(); // curl
    // surplus is deliberately not part of this feature
    expect(screen.queryByLabelText(/surplus/i)).toBeNull();
  });

  it("commits a fresh-uid progressed week; warm-up and surplus pass through; source stays frozen-intact", () => {
    const week = makeWeek();
    const { onCommit } = renderDialog({ week });
    fireEvent.click(commitButton());

    expect(onCommit).toHaveBeenCalledTimes(1);
    const committed = onCommit.mock.calls[0][0] as WeekDraft;
    expect(committed.uid).not.toBe(week.uid);
    const bench = committed.days[0].session!.exercises[0];
    expect(bench.uid).not.toBe("ex-bench");
    expect(bench.setSpecs!.map((s) => s.load_value)).toEqual([60, 102.5, 92.5, 92.5]);
    expect(committed.days[0].session!.calorieSurplusPercentage).toBe(12);
    // the frozen source is untouched
    expect(week.days[0].session!.exercises[0].setSpecs!.map((s) => s.load_value)).toEqual([
      60, 100, 90, 90,
    ]);
  });

  it("compounds-only scope leaves the isolation exercise untouched", () => {
    const { onCommit } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Compounds only" }));
    // switch to reps so the compact-only curl WOULD change if it were in scope
    fireEvent.click(screen.getByRole("button", { name: "Reps" }));
    expect(screen.getByText("1 of 2 exercises change")).toBeInTheDocument();

    fireEvent.click(commitButton());
    const committed = onCommit.mock.calls[0][0] as WeekDraft;
    const [bench, curl] = committed.days[0].session!.exercises;
    expect(bench.setSpecs![1].reps_min).toBe(9);
    expect(curl.setSpecs).toBeNull(); // stayed compact: rule never touched it
  });

  it("pick-exercises checkboxes narrow the scope by identity", () => {
    const { onCommit } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Reps" }));
    fireEvent.click(screen.getByRole("button", { name: "Pick exercises" }));
    expect(screen.getByLabelText("Include Cable Curl (Day 1)")).toBeInTheDocument();
    expect(screen.getByText("2 of 2 exercises change")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Include Bench Press (Day 1)"));
    expect(screen.getByText("1 of 2 exercises change")).toBeInTheDocument();

    fireEvent.click(commitButton());
    const committed = onCommit.mock.calls[0][0] as WeekDraft;
    const [bench, curl] = committed.days[0].session!.exercises;
    expect(bench.setSpecs![1].reps_min).toBe(8); // unchecked: untouched
    // compact-only curl materialized with 10-12 -> 11-13
    expect(curl.setSpecs!.every((s) => s.reps_min === 11 && s.reps_max === 13)).toBe(true);
  });

  it("formats reps and set-count diffs", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Reps" }));
    expect(screen.getByText("11–13")).toBeInTheDocument(); // curl 10–12 -> 11–13
    fireEvent.click(screen.getByRole("button", { name: "Sets" }));
    expect(screen.getAllByText("3 sets").length).toBeGreaterThan(0);
    expect(screen.getAllByText("4 sets").length).toBeGreaterThan(0);
  });

  it("a negative sets rule previews and commits a deload week (last working sets removed, floor 1)", () => {
    const { onCommit } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Sets" }));
    fireEvent.change(screen.getByLabelText("Sets to add or remove"), {
      target: { value: "-1" },
    });
    // bench 3 working -> 2; compact-only curl 3 -> 2 (materializes)
    expect(screen.getByText("2 of 2 exercises change")).toBeInTheDocument();
    expect(screen.getAllByText("3 sets").length).toBe(2);
    expect(screen.getAllByText("2 sets").length).toBe(2);

    fireEvent.click(commitButton());
    const committed = onCommit.mock.calls[0][0] as WeekDraft;
    const [bench, curl] = committed.days[0].session!.exercises;
    // warm-up + first two working sets survive; the LAST working set was removed
    expect(bench.setSpecs!.map((s) => [s.set_type, s.load_value])).toEqual([
      ["warmup", 60],
      ["working", 100],
      ["working", 90],
    ]);
    expect(bench.sets).toBe(2);
    expect(curl.setSpecs).toHaveLength(2);
  });

  it("cancel closes without committing", () => {
    const { onCommit, onClose } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("an all-rest week degrades to a plain exact copy", () => {
    const restWeek = deepFreeze(makeRestWeek(0));
    const { onCommit } = renderDialog({ week: restWeek });
    expect(
      screen.getByText("This week is all rest days — the copy will match it exactly."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Progression")).toBeNull();

    fireEvent.click(commitButton());
    const committed = onCommit.mock.calls[0][0] as WeekDraft;
    expect(committed.uid).not.toBe(restWeek.uid);
    expect(committed.days).toHaveLength(7);
    expect(committed.days.every((d) => d.session === null)).toBe(true);
  });

  it("a rule that changes nothing shows the exact-copy notice and commits an exact copy", () => {
    const { onCommit } = renderDialog();
    fireEvent.change(screen.getByLabelText("Load change per working set"), {
      target: { value: "" },
    });
    expect(
      screen.getByText("This doesn't change anything — you'll get an exact copy."),
    ).toBeInTheDocument();

    fireEvent.click(commitButton());
    const committed = onCommit.mock.calls[0][0] as WeekDraft;
    expect(
      committed.days[0].session!.exercises[0].setSpecs!.map((s) => s.load_value),
    ).toEqual([60, 100, 90, 90]);
  });

  it("disables commit at the 52-week limit", () => {
    const { onCommit } = renderDialog({ canAddWeek: false });
    expect(screen.getByText("This program is at its 52-week limit.")).toBeInTheDocument();
    expect(commitButton()).toBeDisabled();
    fireEvent.click(commitButton());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("disables the compounds scope while the catalog is unavailable", () => {
    catalogState.error = new Error("boom");
    catalogState.exercises = [];
    renderDialog();
    const compounds = screen.getByRole("button", { name: "Compounds only" });
    expect(compounds).toBeDisabled();
    fireEvent.click(compounds);
    // scope stayed on All: the kg rule still changes bench
    expect(screen.getByText("1 of 2 exercises change")).toBeInTheDocument();
  });
});
