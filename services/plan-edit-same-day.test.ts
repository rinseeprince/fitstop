import { describe, it, expect } from "vitest";
import { isDayUnchanged } from "./plan-edit-same-day";
import type { PlanEditDay } from "./plan-edit-service";
import type { TrainingExercise } from "@/types/training";

// A day the editor saves as it was laid keeps its edited mark; a day the coach
// changed in the editor loses it. Every field the save writes counts, and
// nothing else: the editor's own renumbering and tidying of an untouched day
// must not read as a change.

const exercise = (overrides: Partial<TrainingExercise> = {}): TrainingExercise => ({
  id: "row-ex-1",
  sessionId: "row-1",
  exerciseId: null,
  name: "Bench press",
  orderIndex: 0,
  sets: 3,
  repsMin: 8,
  repsMax: 10,
  isWarmup: false,
  setSpecs: null,
  videoUrl: null,
  prescribedFields: null,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  ...overrides,
});

type LaidSession = Extract<PlanEditDay, { isRest: false }>;

const laidDay = (overrides: Partial<LaidSession> = {}): LaidSession => ({
  date: "2026-09-18",
  isRest: false,
  name: "Upper B",
  focus: "Shoulders and arms",
  estimatedDurationMinutes: 60,
  notes: null,
  calorieSurplusPercentage: 10,
  exercises: [
    exercise(),
    exercise({ id: "row-ex-2", name: "Pull-up", orderIndex: 1, repsMin: 6, repsMax: 8 }),
  ],
  ...overrides,
});

describe("isDayUnchanged", () => {
  it("holds for the day as laid", () => {
    const laid = laidDay();
    expect(isDayUnchanged(laid, laidDay())).toBe(true);
  });

  it("never holds for a session on a day laid as rest, or on no day", () => {
    expect(isDayUnchanged({ date: "2026-09-18", isRest: true }, laidDay())).toBe(false);
    expect(isDayUnchanged(undefined, laidDay())).toBe(false);
  });

  it.each<[string, Partial<LaidSession>]>([
    ["the name", { name: "Upper B (heavy)" }],
    ["the focus", { focus: "Arms" }],
    ["the focus cleared", { focus: null }],
    ["the notes", { notes: "Keep it light" }],
    ["the duration", { estimatedDurationMinutes: 45 }],
    ["the surplus", { calorieSurplusPercentage: 12.5 }],
    ["the surplus cleared", { calorieSurplusPercentage: null }],
    ["an exercise added", { exercises: [...laidDay().exercises, exercise({ id: "x3", name: "Face pull" })] }],
    ["an exercise removed", { exercises: [exercise()] }],
    ["the exercises reordered", { exercises: [...laidDay().exercises].reverse() }],
  ])("fails when the coach changed %s", (_label, change) => {
    expect(isDayUnchanged(laidDay(), laidDay(change))).toBe(false);
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
    ["its tempo", { tempo: "3010" }],
    ["its rest", { restSeconds: 90 }],
    ["its note", { notes: "Pause at the bottom" }],
    ["its superset", { supersetGroup: "A" }],
    ["its warm-up flag", { isWarmup: true }],
    ["its video", { videoUrl: "https://example.com/bench" }],
    ["its prescribed fields", { prescribedFields: ["reps", "load"] }],
    [
      "a set's load",
      {
        setSpecs: [
          { set_number: 1, set_type: "working", reps_min: 8, reps_max: 10, load_type: "absolute", load_value: 82.5 },
        ],
      },
    ],
  ])("fails when the coach changed an exercise's %s", (_label, change) => {
    const changed = laidDay({
      exercises: [exercise(change), laidDay().exercises[1]],
    });
    expect(isDayUnchanged(laidDay(), changed)).toBe(false);
  });

  describe("what the editor rewrites on an untouched day", () => {
    it("ignores the exercises' stored order numbers: the list's order is the order", () => {
      const laid = laidDay({
        exercises: [exercise({ orderIndex: 2 }), exercise({ id: "row-ex-2", name: "Pull-up", orderIndex: 7 })],
      });
      const saved = laidDay({
        exercises: [exercise({ orderIndex: 0 }), exercise({ id: "row-ex-2", name: "Pull-up", orderIndex: 1 })],
      });
      expect(isDayUnchanged(laid, saved)).toBe(true);
    });

    it("numbers the sets by position, and reads their keys in any order", () => {
      const laid = laidDay({
        exercises: [
          exercise({
            setSpecs: [
              { set_type: "warmup", set_number: 3, reps_min: 10, reps_max: 10, load_type: "absolute", load_value: 40 },
              { set_type: "working", set_number: 7, reps_min: 8, reps_max: 10, load_type: "absolute", load_value: 80 },
            ],
          }),
        ],
      });
      const saved = laidDay({
        exercises: [
          exercise({
            setSpecs: [
              { set_number: 1, set_type: "warmup", load_type: "absolute", load_value: 40, reps_min: 10, reps_max: 10 },
              { set_number: 2, set_type: "working", load_type: "absolute", load_value: 80, reps_min: 8, reps_max: 10 },
            ],
          }),
        ],
      });
      expect(isDayUnchanged(laid, saved)).toBe(true);
    });

    it("reads an empty set list as none, a padded video link as trimmed and an empty field list as none", () => {
      const laid = laidDay({
        exercises: [
          exercise({ setSpecs: [], videoUrl: "  https://example.com/bench  ", prescribedFields: [] }),
        ],
      });
      const saved = laidDay({
        exercises: [exercise({ setSpecs: null, videoUrl: "https://example.com/bench", prescribedFields: null })],
      });
      expect(isDayUnchanged(laid, saved)).toBe(true);
    });

    it("reads a missing value as an empty one", () => {
      const laid = laidDay({ exercises: [exercise({ tempo: undefined, notes: undefined })] });
      const saved = {
        ...laidDay(),
        exercises: [{ ...exercise(), tempo: null, notes: null, repsTarget: null }],
      };
      expect(isDayUnchanged(laid, saved)).toBe(true);
    });
  });
});
