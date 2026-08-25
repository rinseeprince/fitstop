import { describe, it, expect } from "vitest";
import type { SetSpec } from "@/utils/exercise-set-specs";
import type { ExerciseDraft } from "./program-builder-types";
import { applySetSpecEdit } from "@/utils/set-spec-edits";
import { MAX_SET_SPECS } from "@/utils/exercise-set-specs";

function makeExercise(overrides: Partial<ExerciseDraft> = {}): ExerciseDraft {
  return {
    uid: "ex-1",
    exerciseId: null,
    name: "Bench",
    setSpecs: null,
    sets: 3,
    repsMin: 8,
    repsMax: 12,
    repsTarget: null,
    rpeTarget: 8,
    percentage1rm: null,
    tempo: null,
    restSeconds: 120,
    supersetGroup: null,
    isWarmup: false,
    notes: null,
    videoUrl: null,
    prescribedFields: null,
    ...overrides,
  };
}

const spec = (set_number: number, set_type: SetSpec["set_type"], extra: Partial<SetSpec> = {}): SetSpec => ({
  set_number,
  set_type,
  reps_min: 8,
  reps_max: 12,
  ...extra,
});

describe("applySetSpecEdit", () => {
  it("materializes specs from the compact columns on first touch (add-set)", () => {
    const result = applySetSpecEdit(makeExercise(), { kind: "add-set" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 3 compact sets expanded + 1 added copy of the last.
    expect(result.exercise.setSpecs).toHaveLength(4);
    expect(result.exercise.setSpecs!.every((s) => s.set_type === "working")).toBe(true);
    expect(result.exercise.setSpecs!.map((s) => s.set_number)).toEqual([1, 2, 3, 4]);
    // Compact re-projected: 4 working sets.
    expect(result.exercise.sets).toBe(4);
  });

  it("add-set copies the set at afterIndex and renumbers", () => {
    const ex = makeExercise({
      setSpecs: [spec(1, "warmup", { reps_min: 12, reps_max: 15 }), spec(2, "working")],
    });
    const result = applySetSpecEdit(ex, { kind: "add-set", afterIndex: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const specs = result.exercise.setSpecs!;
    expect(specs).toHaveLength(3);
    expect(specs[1].set_type).toBe("warmup");
    expect(specs[1].reps_min).toBe(12);
    expect(specs.map((s) => s.set_number)).toEqual([1, 2, 3]);
    // Warmups don't count toward the compact projection: 1 working set.
    expect(result.exercise.sets).toBe(1);
  });

  it("update-set with an unchanged patch is a no-op and never materializes specs", () => {
    const compactOnly = makeExercise(); // setSpecs null; expands to working sets with reps_min 8
    const result = applySetSpecEdit(compactOnly, {
      kind: "update-set",
      index: 0,
      patch: { reps_min: 8 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Same reference: caller skips the commit, tree stays clean, and the
    // exercise's saved shape stays compact-only.
    expect(result.exercise).toBe(compactOnly);
    expect(result.exercise.setSpecs).toBeNull();
  });

  it("rejects growing past the schema cap", () => {
    const ex = makeExercise({
      setSpecs: Array.from({ length: MAX_SET_SPECS }, (_, i) => spec(i + 1, "working")),
    });
    const result = applySetSpecEdit(ex, { kind: "add-set" });
    expect(result.ok).toBe(false);
  });

  it("rejects removing or retyping the last working set (all-warmup guard)", () => {
    const ex = makeExercise({ setSpecs: [spec(1, "warmup"), spec(2, "working")] });

    const removed = applySetSpecEdit(ex, { kind: "remove-set", index: 1 });
    expect(removed.ok).toBe(false);

    const retyped = applySetSpecEdit(ex, {
      kind: "update-set",
      index: 1,
      patch: { set_type: "warmup" },
    });
    expect(retyped.ok).toBe(false);
  });

  it("deleting the final remaining set reverts setSpecs to null (compact fallback)", () => {
    const ex = makeExercise({ setSpecs: [spec(1, "working")], sets: 1 });
    const result = applySetSpecEdit(ex, { kind: "remove-set", index: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.exercise.setSpecs).toBeNull();
  });

  it("remove-set renumbers and re-projects the compact reps range", () => {
    const ex = makeExercise({
      setSpecs: [
        spec(1, "working", { reps_min: 5, reps_max: 5 }),
        spec(2, "working", { reps_min: 8, reps_max: 12 }),
        spec(3, "working", { reps_min: 15, reps_max: 20 }),
      ],
    });
    const result = applySetSpecEdit(ex, { kind: "remove-set", index: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.exercise.setSpecs!.map((s) => s.set_number)).toEqual([1, 2]);
    expect(result.exercise.sets).toBe(2);
    expect(result.exercise.repsMin).toBe(5);
    expect(result.exercise.repsMax).toBe(12);
  });

  it("changing set_type away from drop clears its drops", () => {
    const ex = makeExercise({
      setSpecs: [
        spec(1, "working"),
        spec(2, "drop", { drops: [{ weight: 50, reps: 8 }] }),
      ],
    });
    const result = applySetSpecEdit(ex, {
      kind: "update-set",
      index: 1,
      patch: { set_type: "working" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.exercise.setSpecs![1].drops).toBeNull();
  });

  it("drops CRUD: add, update, remove (removing the last nulls the array)", () => {
    const ex = makeExercise({ setSpecs: [spec(1, "working"), spec(2, "drop")] });

    let result = applySetSpecEdit(ex, { kind: "add-drop", setIndex: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.exercise.setSpecs![1].drops).toEqual([{ weight: null, reps: null }]);

    result = applySetSpecEdit(result.exercise, {
      kind: "update-drop",
      setIndex: 1,
      dropIndex: 0,
      patch: { weight: 40, reps: 10 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.exercise.setSpecs![1].drops).toEqual([{ weight: 40, reps: 10 }]);

    result = applySetSpecEdit(result.exercise, {
      kind: "remove-drop",
      setIndex: 1,
      dropIndex: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.exercise.setSpecs![1].drops).toBeNull();
  });
});
