import { describe, it, expect } from "vitest";
import { isSessionUnchanged } from "./plan-edit-same-day";
import type { PlanEditSession } from "./plan-edit-service";
import type { TrainingExercise, TrainingExerciseGroup } from "@/types/training";
import { STRAIGHT_SETS, type GroupSettings } from "@/utils/exercise-groups";

// A session the editor saves as it was laid keeps its entry's edited mark; a
// session the coach changed in the editor loses it. Every field the save writes
// counts, and nothing else: the editor's own renumbering and tidying of an
// untouched session must not read as a change.

const exercise = (overrides: Partial<TrainingExercise> = {}): TrainingExercise => ({
  id: "row-ex-1",
  sessionId: "row-1",
  groupId: "grp-1",
  exerciseId: null,
  name: "Bench press",
  orderIndex: 0,
  sets: 3,
  repsMin: 8,
  repsMax: 10,
  isWarmup: false,
  setSpecs: null,
  videoUrl: null,
  prescribedFields: ["set_type", "reps", "load", "rpe", "rest"],
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  ...overrides,
});

/** A laid group: the settings and exercises given, straight sets by default. */
const group = (
  exercises: TrainingExercise[],
  overrides: Partial<TrainingExerciseGroup> = {},
): TrainingExerciseGroup => ({
  id: `grp-${exercises[0]?.id ?? "empty"}`,
  sessionId: "row-1",
  orderIndex: 0,
  ...STRAIGHT_SETS,
  exercises,
  ...overrides,
});

/** A lone exercise: a straight-sets group of one. */
const lone = (ex: TrainingExercise): TrainingExerciseGroup => group([ex]);

type LaidSession = PlanEditSession;

const laidDay = (overrides: Partial<LaidSession> = {}): LaidSession => ({
  eventId: "e0000000-0000-4000-8000-000000000001",
  name: "Upper B",
  focus: "Shoulders and arms",
  estimatedDurationMinutes: 60,
  notes: null,
  calorieSurplusPercentage: 10,
  groups: [
    lone(exercise()),
    lone(exercise({ id: "row-ex-2", name: "Pull-up", orderIndex: 1, repsMin: 6, repsMax: 8 })),
  ],
  ...overrides,
});

const CIRCUIT: GroupSettings = {
  format: "circuit",
  rounds: 3,
  timeCapSeconds: 600,
  intervalSeconds: null,
  restBetweenExercisesSeconds: 15,
  restBetweenRoundsSeconds: 90,
  notes: "Minimal rest between moves",
};

const facePull = () => exercise({ id: "row-ex-3", name: "Face pull", repsMin: 12, repsMax: 15 });

/** A day of two groups: a circuit of bench press and pull-up, then a lone face pull. */
const circuitDay = (overrides: Partial<LaidSession> = {}): LaidSession =>
  laidDay({
    groups: [
      group(
        [exercise(), exercise({ id: "row-ex-2", name: "Pull-up", orderIndex: 1, repsMin: 6, repsMax: 8 })],
        { id: "grp-circuit", ...CIRCUIT },
      ),
      group([facePull()], { id: "grp-lone", orderIndex: 1 }),
    ],
    ...overrides,
  });

describe("isSessionUnchanged", () => {
  it("holds for the day as laid", () => {
    const laid = laidDay();
    expect(isSessionUnchanged(laid, laidDay())).toBe(true);
  });

  it("never holds for a session with nothing laid to compare it with", () => {
    expect(isSessionUnchanged(undefined, laidDay())).toBe(false);
  });

  it.each<[string, Partial<LaidSession>]>([
    ["the name", { name: "Upper B (heavy)" }],
    ["the focus", { focus: "Arms" }],
    ["the focus cleared", { focus: null }],
    ["the notes", { notes: "Keep it light" }],
    ["the duration", { estimatedDurationMinutes: 45 }],
    ["the surplus", { calorieSurplusPercentage: 12.5 }],
    ["the surplus cleared", { calorieSurplusPercentage: null }],
    ["an exercise added", { groups: [...laidDay().groups, lone(exercise({ id: "x3", name: "Face pull" }))] }],
    ["an exercise removed", { groups: [lone(exercise())] }],
    ["the exercises reordered", { groups: [...laidDay().groups].reverse() }],
  ])("fails when the coach changed %s", (_label, change) => {
    expect(isSessionUnchanged(laidDay(), laidDay(change))).toBe(false);
  });

  it.each<[string, Partial<TrainingExercise>]>([
    ["its name", { name: "Incline press" }],
    ["its catalog exercise", { exerciseId: "c0000000-0000-4000-8000-000000000001" }],
    ["its sets", { sets: 4 }],
    ["its lowest reps", { repsMin: 6 }],
    ["its highest reps", { repsMax: 12 }],
    ["its target reps", { repsTarget: "8-10" }],
    ["its RPE", { rpeTarget: 8 }],
    ["its percentage of 1RM", { percentage1rm: 75 }],
    ["its tempo", { tempo: "3-0-1-0" }],
    ["its rest", { restSeconds: 90 }],
    ["its note", { notes: "Pause at the bottom" }],
    ["its warm-up flag", { isWarmup: true }],
    ["its video", { videoUrl: "https://example.com/bench" }],
    ["its prescribed fields", { prescribedFields: ["reps", "load"] }],
    [
      "a set's load",
      {
        setSpecs: [
          { set_number: 1, set_type: "working", reps_min: 8, reps_max: 10, load_type: "absolute", load_min: 82.5, load_max: 82.5 },
        ],
      },
    ],
  ])("fails when the coach changed an exercise's %s", (_label, change) => {
    const changed = laidDay({
      groups: [lone(exercise(change)), laidDay().groups[1]],
    });
    expect(isSessionUnchanged(laidDay(), changed)).toBe(false);
  });

  describe("a day's groups", () => {
    it("holds for a day of several groups as laid, settings and all", () => {
      expect(isSessionUnchanged(circuitDay(), circuitDay())).toBe(true);
    });

    it.each<[string, Partial<GroupSettings>]>([
      ["its format", { format: "amrap" }],
      ["its rounds", { rounds: 4 }],
      ["its rounds cleared", { rounds: null }],
      ["its time cap", { timeCapSeconds: 900 }],
      ["its interval", { intervalSeconds: 60 }],
      ["its rest between exercises", { restBetweenExercisesSeconds: 30 }],
      ["its rest between rounds", { restBetweenRoundsSeconds: 120 }],
      ["its notes", { notes: "Go unbroken" }],
    ])("fails when the coach changed a group's %s", (_label, change) => {
      const [circuit, loneGroup] = circuitDay().groups;
      const changed = circuitDay({ groups: [{ ...circuit, ...change }, loneGroup] });
      expect(isSessionUnchanged(circuitDay(), changed)).toBe(false);
    });

    it("fails when an exercise moves to another group, even with the exercises in the same order", () => {
      // Laid: [bench, pull-up] then [face pull]. Saved: [bench] then [pull-up,
      // face pull] — every exercise and setting the same, read in the same
      // flattened order, but the pull-up now sits in the second group.
      const [circuit, loneGroup] = circuitDay().groups;
      const [bench, pullUp] = circuit.exercises;
      const moved = circuitDay({
        groups: [
          { ...circuit, exercises: [bench] },
          { ...loneGroup, ...CIRCUIT, exercises: [pullUp, ...loneGroup.exercises] },
        ],
      });
      const laid = circuitDay({
        groups: [circuit, { ...loneGroup, ...CIRCUIT }],
      });
      expect(moved.groups.flatMap((g) => g.exercises.map((e) => e.name))).toEqual(
        laid.groups.flatMap((g) => g.exercises.map((e) => e.name)),
      );
      expect(isSessionUnchanged(laid, moved)).toBe(false);
    });

    it("fails when the groups are reordered", () => {
      const [circuit, loneGroup] = circuitDay().groups;
      expect(isSessionUnchanged(circuitDay(), circuitDay({ groups: [loneGroup, circuit] }))).toBe(false);
    });

    it("fails when two groups of the same exercises swap places, though the exercises read the same", () => {
      // Only the groups' settings tell the two apart, so only their order can
      // have changed.
      const laid = laidDay({
        groups: [
          group([exercise()], { id: "grp-a", ...CIRCUIT }),
          group([exercise()], { id: "grp-b", orderIndex: 1, format: "emom", intervalSeconds: 60 }),
        ],
      });
      const swapped = laidDay({ groups: [...laid.groups].reverse() });
      expect(isSessionUnchanged(laid, swapped)).toBe(false);
    });

    it("holds when the saved groups carry the laid groups' settings with their keys in another order", () => {
      const laid = circuitDay();
      const [circuit, loneGroup] = laid.groups;
      // The save's groups as the editor sends them: no ids or positions, and
      // every key written in a different order from the laid rows'.
      const saved = {
        groups: [
          {
            exercises: circuit.exercises,
            notes: CIRCUIT.notes,
            restBetweenRoundsSeconds: CIRCUIT.restBetweenRoundsSeconds,
            restBetweenExercisesSeconds: CIRCUIT.restBetweenExercisesSeconds,
            intervalSeconds: CIRCUIT.intervalSeconds,
            timeCapSeconds: CIRCUIT.timeCapSeconds,
            rounds: CIRCUIT.rounds,
            format: CIRCUIT.format,
          },
          {
            exercises: loneGroup.exercises,
            restBetweenRoundsSeconds: null,
            notes: null,
            intervalSeconds: null,
            rounds: null,
            restBetweenExercisesSeconds: null,
            timeCapSeconds: null,
            format: "straight_sets" as const,
          },
        ],
        calorieSurplusPercentage: laid.calorieSurplusPercentage,
        estimatedDurationMinutes: laid.estimatedDurationMinutes,
        notes: laid.notes,
        focus: laid.focus,
        name: laid.name,
      };
      expect(isSessionUnchanged(laid, saved)).toBe(true);
    });
  });

  describe("what the editor rewrites on an untouched day", () => {
    it("ignores the stored order numbers of groups and exercises: the lists' order is the order", () => {
      const laid = laidDay({
        groups: [
          group([exercise({ orderIndex: 2 })], { orderIndex: 2 }),
          group([exercise({ id: "row-ex-2", name: "Pull-up", orderIndex: 7 })], { orderIndex: 7 }),
        ],
      });
      const saved = laidDay({
        groups: [
          group([exercise({ orderIndex: 0 })], { orderIndex: 0 }),
          group([exercise({ id: "row-ex-2", name: "Pull-up", orderIndex: 0 })], { orderIndex: 1 }),
        ],
      });
      expect(isSessionUnchanged(laid, saved)).toBe(true);
    });

    it("numbers the sets by position, and reads their keys in any order", () => {
      const laid = laidDay({
        groups: [
          lone(
            exercise({
              setSpecs: [
                { set_type: "warmup", set_number: 3, reps_min: 10, reps_max: 10, load_type: "absolute", load_min: 40, load_max: 40 },
                { set_type: "working", set_number: 7, reps_min: 8, reps_max: 10, load_type: "absolute", load_min: 80, load_max: 80 },
              ],
            }),
          ),
        ],
      });
      const saved = laidDay({
        groups: [
          lone(
            exercise({
              setSpecs: [
                { set_number: 1, set_type: "warmup", load_type: "absolute", load_min: 40, load_max: 40, reps_min: 10, reps_max: 10 },
                { set_number: 2, set_type: "working", load_type: "absolute", load_min: 80, load_max: 80, reps_min: 8, reps_max: 10 },
              ],
            }),
          ),
        ],
      });
      expect(isSessionUnchanged(laid, saved)).toBe(true);
    });

    it("reads an empty set list as none, a padded video link as trimmed and an empty field list as none", () => {
      const laid = laidDay({
        groups: [
          lone(exercise({ setSpecs: [], videoUrl: "  https://example.com/bench  ", prescribedFields: [] })),
        ],
      });
      const saved = laidDay({
        groups: [lone(exercise({ setSpecs: null, videoUrl: "https://example.com/bench", prescribedFields: ["set_type", "reps", "load", "rpe", "rest"] }))],
      });
      expect(isSessionUnchanged(laid, saved)).toBe(true);
    });

    it("reads a missing value as an empty one", () => {
      const laid = laidDay({ groups: [lone(exercise({ tempo: undefined, notes: undefined }))] });
      const saved = {
        ...laidDay(),
        groups: [
          { ...STRAIGHT_SETS, exercises: [{ ...exercise(), tempo: null, notes: null, repsTarget: null }] },
        ],
      };
      expect(isSessionUnchanged(laid, saved)).toBe(true);
    });

    it("reads a group's missing settings as empty ones", () => {
      // A straight-sets group as the save may send it: the format alone.
      const laid = laidDay({ groups: [lone(exercise())] });
      const saved = { ...laidDay(), groups: [{ format: "straight_sets" as const, exercises: [exercise()] }] };
      expect(isSessionUnchanged(laid, saved)).toBe(true);
    });
  });
});
