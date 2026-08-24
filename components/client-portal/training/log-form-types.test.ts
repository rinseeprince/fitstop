import { describe, it, expect } from "vitest";
import {
  buildLogPayload,
  emptySet,
  prescribedRowsForView,
  seedDefaultValues,
} from "./log-form-types";
import type {
  LogFormValues,
  PrescribedRowsByIndex,
  SetRowValues,
} from "./log-form-types";
import type { PrescribedExerciseView } from "./exercise-tracker-block";
import type { ExerciseLog, SessionLog, SetLog } from "@/types/training";
import type { SetSpec } from "@/utils/exercise-set-specs";

const KG_PER_LB = 0.45359237;
const ISO = "2026-05-01T00:00:00.000Z";
const EX_A = "11111111-1111-4111-8111-111111111111";

/** A ticked row carrying values — what a client who logged numbers produces. */
function ticked(over: Partial<SetRowValues> = {}): SetRowValues {
  return { reps: "", weight: "", rpe: "", weightKg: null, completed: true, ...over };
}

function values(sets: SetRowValues[]): LogFormValues {
  return {
    notes: "",
    exercises: [
      {
        trainingExerciseId: EX_A,
        exerciseId: undefined,
        exerciseName: "Bench Press",
        prescribedName: "Bench Press",
        isSwapped: false,
        notes: "",
        sets,
        isUnplanned: false,
      },
    ],
  };
}

/** N prescribed working sets for the single exercise the fixtures use. */
function working(n: number): PrescribedRowsByIndex {
  return [prescribedRowsForView({ id: EX_A, name: "Bench Press", sets: n, isWarmup: false })];
}

const NOTHING_DIRTY = () => false;
const ALL_DIRTY = () => true;
const setsOf = (payload: ReturnType<typeof buildLogPayload>) =>
  payload.exercises![0].sets;

// The form seeds its weight field from canonical kilograms, rounded for
// legibility, and submits in the client's unit. Both halves of that round trip
// are lossy, so an untouched weight must resubmit the kilograms it came from
// rather than being re-parsed from the string it was shown as.
describe("buildLogPayload", () => {
  it("always tags the wire canonical, whatever the client sees", () => {
    const payload = buildLogPayload(
      values([ticked({ reps: "10", weight: "225" })]),
      "imperial",
      ALL_DIRTY,
      working(1),
    );
    expect(payload.exercises![0].weightUnit).toBe("kg");
  });

  it("converts an edited weight from the client's unit to kilograms", () => {
    const payload = buildLogPayload(
      values([ticked({ reps: "10", weight: "225" })]),
      "imperial",
      ALL_DIRTY,
      working(1),
    );
    expect(setsOf(payload)[0].weight).toBeCloseTo(225 * KG_PER_LB, 6);
  });

  it("stores a metric edit verbatim", () => {
    const payload = buildLogPayload(
      values([ticked({ reps: "10", weight: "102.5" })]),
      "metric",
      ALL_DIRTY,
      working(1),
    );
    expect(setsOf(payload)[0].weight).toBe(102.5);
  });

  it("resubmits a wholly untouched log byte-identical", () => {
    // 100 kg seeds as "220.5" for an imperial client; re-parsing that string
    // would store 100.017 kg.
    const payload = buildLogPayload(
      values([ticked({ reps: "10", weight: "220.5", rpe: "8", weightKg: 100 })]),
      "imperial",
      NOTHING_DIRTY,
      working(1),
    );
    expect(setsOf(payload)[0].weight).toBe(100);
  });

  // THE case. A row is dirty the moment its reps change, so a row-level guard
  // would let this drift — and the wholly-untouched test above would still pass.
  it("leaves an untouched WEIGHT alone when its row is dirty from a reps edit", () => {
    const dirtyRepsOnly = (_ex: number, _set: number) => false; // weight not dirty
    const payload = buildLogPayload(
      values([ticked({ reps: "12", weight: "220.5", rpe: "8", weightKg: 100 })]),
      "imperial",
      dirtyRepsOnly,
      working(1),
    );

    expect(setsOf(payload)[0].reps).toBe(12);
    expect(setsOf(payload)[0].weight).toBe(100);
  });

  it("guards per set, not per exercise", () => {
    const onlySecondSetDirty = (_ex: number, setIndex: number) => setIndex === 1;
    const payload = buildLogPayload(
      values([
        ticked({ reps: "10", weight: "220.5", weightKg: 100 }),
        ticked({ reps: "10", weight: "225", weightKg: 100 }),
      ]),
      "imperial",
      onlySecondSetDirty,
      working(2),
    );

    expect(setsOf(payload)[0].weight).toBe(100);
    expect(setsOf(payload)[1].weight).toBeCloseTo(225 * KG_PER_LB, 6);
  });

  it("clears the weight when an edited field is emptied", () => {
    const payload = buildLogPayload(
      values([ticked({ reps: "10", weight: "", weightKg: 100 })]),
      "imperial",
      ALL_DIRTY,
      working(1),
    );
    expect(setsOf(payload)[0].weight).toBeUndefined();
  });

  // ---- The tick decides what is sent (locked decisions 1 and 3) ------------

  it("drops an exercise with nothing ticked", () => {
    const payload = buildLogPayload(
      values([emptySet()]),
      "metric",
      ALL_DIRTY,
      working(1),
    );
    expect(payload.exercises).toBeUndefined();
  });

  // Decision 3: doing the work is the claim; recording numbers is a bonus.
  it("sends a ticked set with every field empty", () => {
    const payload = buildLogPayload(
      values([ticked()]),
      "metric",
      ALL_DIRTY,
      working(1),
    );
    expect(setsOf(payload)).toEqual([{ setNumber: 1 }]);
  });

  // Decision 1: the tick is the ONLY thing that decides completion. Numbers left
  // in an unticked row are notes to self, not a claim that the set was done.
  it("does NOT send a filled set that was never ticked", () => {
    const payload = buildLogPayload(
      values([
        ticked({ reps: "10" }),
        { reps: "9", weight: "100", rpe: "8", weightKg: null, completed: false },
      ]),
      "metric",
      ALL_DIRTY,
      working(2),
    );
    expect(setsOf(payload)).toEqual([{ setNumber: 1, reps: 10 }]);
  });

  // THE identity case. The form's rows mirror the flattened prescription, so a
  // row's position IS its set number — but only if it is read off the original
  // array. Numbering after selecting collapsed a logged subset down to 1..n, and
  // the server then typed each row from the wrong spec (a lone working set
  // stored as set 1, typed `warmup`, and excluded from every performance metric).
  it("sends each ticked set's own row number, not its position among the ticked rows", () => {
    const payload = buildLogPayload(
      values([
        emptySet(),
        ticked({ reps: "10", weight: "100" }),
        emptySet(),
        ticked({ reps: "8", weight: "100" }),
      ]),
      "metric",
      ALL_DIRTY,
      working(4),
    );

    expect(setsOf(payload).map((s) => s.setNumber)).toEqual([2, 4]);
    expect(setsOf(payload).map((s) => s.setNumber)).not.toEqual([1, 2]);
  });

  it("numbers a fully ticked exercise 1..n", () => {
    const payload = buildLogPayload(
      values([
        ticked({ reps: "10", weight: "100" }),
        ticked({ reps: "10", weight: "100" }),
        ticked({ reps: "8", weight: "100" }),
      ]),
      "metric",
      ALL_DIRTY,
      working(3),
    );
    expect(setsOf(payload).map((s) => s.setNumber)).toEqual([1, 2, 3]);
  });

  // ---- The derived completionQuality --------------------------------------
  //
  // The selector that used to ask the client for this is gone, so the payload
  // has to carry the outcome the ticks describe. The server ignores it whenever
  // `exercises` is present and re-derives — but it HONOURS it for a payload with
  // none, which is exactly the all-unticked case below.

  it("derives full when every prescribed working set is ticked", () => {
    const payload = buildLogPayload(
      values([ticked(), ticked(), ticked()]),
      "metric",
      ALL_DIRTY,
      working(3),
    );
    expect(payload.completionQuality).toBe("full");
  });

  it("derives partial when some are ticked", () => {
    const payload = buildLogPayload(
      values([ticked(), emptySet(), emptySet()]),
      "metric",
      ALL_DIRTY,
      working(3),
    );
    expect(payload.completionQuality).toBe("partial");
  });

  it("derives skipped, with no exercises, when nothing is ticked", () => {
    const payload = buildLogPayload(
      values([emptySet(), emptySet(), emptySet()]),
      "metric",
      ALL_DIRTY,
      working(3),
    );
    expect(payload).toEqual({ completionQuality: "skipped" });
  });

  // Decision 5: warm-ups are recorded but never scored. Ticking the warm-up and
  // both working sets is `full`; the warm-up is still on the wire.
  it("excludes warm-ups from the derivation while still sending them", () => {
    const rows = [
      prescribedRowsForView({
        id: EX_A,
        name: "Bench Press",
        sets: 3,
        isWarmup: false,
        setSpecs: [
          { set_number: 1, set_type: "warmup" },
          { set_number: 2, set_type: "working" },
          { set_number: 3, set_type: "working" },
        ] as SetSpec[],
      }),
    ];
    const payload = buildLogPayload(
      values([ticked(), ticked(), ticked()]),
      "metric",
      ALL_DIRTY,
      rows,
    );
    expect(payload.completionQuality).toBe("full");
    expect(setsOf(payload).map((s) => s.setNumber)).toEqual([1, 2, 3]);
  });

  it("is skipped when only the warm-up is ticked", () => {
    const rows = [
      prescribedRowsForView({
        id: EX_A,
        name: "Bench Press",
        sets: 3,
        isWarmup: false,
        setSpecs: [
          { set_number: 1, set_type: "warmup" },
          { set_number: 2, set_type: "working" },
          { set_number: 3, set_type: "working" },
        ] as SetSpec[],
      }),
    ];
    const payload = buildLogPayload(
      values([ticked(), emptySet(), emptySet()]),
      "metric",
      ALL_DIRTY,
      rows,
    );
    expect(payload.completionQuality).toBe("skipped");
    // Recorded even though it scores nothing — a coach investigating a niggle
    // needs to see it.
    expect(setsOf(payload)).toEqual([{ setNumber: 1 }]);
  });
});

// ---------------------------------------------------------------------------
// Reopening a logged session
// ---------------------------------------------------------------------------

function view(over: Partial<PrescribedExerciseView> = {}): PrescribedExerciseView {
  return { id: EX_A, name: "Bench Press", sets: 6, isWarmup: false, ...over };
}

function setLog(setNumber: number, over: Partial<SetLog> = {}): SetLog {
  return {
    id: `sl-${setNumber}`,
    exerciseLogId: "elog-1",
    setNumber,
    setType: "working",
    reps: 10,
    weight: 100,
    rpe: null,
    createdAt: ISO,
    updatedAt: ISO,
    ...over,
  };
}

function exerciseLog(sets: SetLog[]): ExerciseLog {
  return {
    id: "elog-1",
    sessionLogId: "log-1",
    trainingExerciseId: EX_A,
    exerciseId: null,
    completed: true,
    notes: null,
    performedName: "Bench Press",
    prescribedExerciseSnapshot: { name: "Bench Press" },
    sets,
    createdAt: ISO,
    updatedAt: ISO,
  };
}

const SESSION_LOG: SessionLog = {
  id: "log-1",
  clientId: "c-1",
  trainingSessionId: "s-1",
  trainingEventId: null,
  completedAt: "2026-05-06",
  completionQuality: "partial",
  notes: null,
  weekStartDate: "2026-05-04",
  prescribedSessionSnapshot: null,
  createdAt: ISO,
  updatedAt: ISO,
};

describe("seedDefaultValues — reopening a logged session", () => {
  it("rebuilds the FULL prescription and ticks only the rows that were logged", () => {
    const seeded = seedDefaultValues({
      prescribedViews: [view({ sets: 6 })],
      sessionLog: SESSION_LOG,
      exerciseLogs: [exerciseLog([setLog(3), setLog(4), setLog(5)])],
      viewer: "metric",
    });

    const sets = seeded.exercises[0].sets;
    // Six prescribed rows, not the three that were logged. Rebuilding only the
    // logged rows is what made sets 3-5 reopen as a 3-row form and re-save as
    // 1-3, typed from the wrong specs.
    expect(sets).toHaveLength(6);
    expect(sets.map((s) => s.completed)).toEqual([
      false,
      false,
      true,
      true,
      true,
      false,
    ]);
    expect(sets.map((s) => s.reps)).toEqual(["", "", "10", "10", "10", ""]);
  });

  it("re-saves a restored partial log with its ORIGINAL set numbers", () => {
    const seeded = seedDefaultValues({
      prescribedViews: [view({ sets: 6 })],
      sessionLog: SESSION_LOG,
      exerciseLogs: [exerciseLog([setLog(3), setLog(4), setLog(5)])],
      viewer: "metric",
    });

    const payload = buildLogPayload(
      seeded,
      "metric",
      NOTHING_DIRTY,
      working(6),
    );
    expect(setsOf(payload).map((s) => s.setNumber)).toEqual([3, 4, 5]);
    expect(payload.completionQuality).toBe("partial");
  });

  // A logged set past the prescription is real and reachable — the client
  // appended rows of their own, or the coach shrank the prescription afterwards.
  // The write path full-replaces, so a row missing from the rebuilt form is
  // DELETED from the database on the next save: reopen, save, gone.
  it("keeps a logged set past the prescription, and still sends it on re-save", () => {
    const seeded = seedDefaultValues({
      prescribedViews: [view({ sets: 3 })],
      sessionLog: SESSION_LOG,
      exerciseLogs: [
        exerciseLog([setLog(1), setLog(2), setLog(3), setLog(4, { reps: 6 })]),
      ],
      viewer: "metric",
    });

    const sets = seeded.exercises[0].sets;
    expect(sets).toHaveLength(4);
    expect(sets[3]).toMatchObject({ reps: "6", completed: true });

    const payload = buildLogPayload(seeded, "metric", NOTHING_DIRTY, working(3));
    expect(setsOf(payload).map((s) => s.setNumber)).toEqual([1, 2, 3, 4]);
  });

  it("seeds a never-logged exercise as the full prescription, unticked", () => {
    const seeded = seedDefaultValues({
      prescribedViews: [view({ sets: 4 })],
      sessionLog: null,
      exerciseLogs: [],
      viewer: "metric",
    });
    expect(seeded.exercises[0].sets).toHaveLength(4);
    expect(seeded.exercises[0].sets.every((s) => !s.completed)).toBe(true);
  });

  it("flattens a drop set into its top set plus one row per drop", () => {
    const seeded = seedDefaultValues({
      prescribedViews: [
        view({
          sets: 1,
          setSpecs: [
            {
              set_number: 1,
              set_type: "drop",
              drops: [{ weight: 60, reps: 8 }, { weight: 40, reps: 8 }],
            },
          ] as SetSpec[],
        }),
      ],
      sessionLog: null,
      exerciseLogs: [],
      viewer: "metric",
    });
    expect(seeded.exercises[0].sets).toHaveLength(3);
  });

  it("restores an orphan (unplanned) log from its logged sets alone", () => {
    const orphan: ExerciseLog = {
      ...exerciseLog([setLog(1), setLog(2)]),
      trainingExerciseId: null,
      performedName: "Calf Raises",
    };
    const seeded = seedDefaultValues({
      prescribedViews: [],
      sessionLog: SESSION_LOG,
      exerciseLogs: [orphan],
      viewer: "metric",
    });
    expect(seeded.exercises).toHaveLength(1);
    expect(seeded.exercises[0].isUnplanned).toBe(true);
    expect(seeded.exercises[0].sets.map((s) => s.completed)).toEqual([
      true,
      true,
    ]);
  });
});
