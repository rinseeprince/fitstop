import { describe, it, expect } from "vitest";
import {
  buildLogPayload,
  emptySet,
  prescribedRowsForView,
  seedDefaultValues,
} from "./log-form-types";
import type {
  LogFormValues,
  LogPayloadResult,
  PrescribedRowsByIndex,
  SetRowValues,
} from "./log-form-types";
import type { PrescribedExerciseView } from "./exercise-tracker-block";
import type { ExerciseLog, SessionLog, SetLog } from "@/types/training";
import type { SetSpec } from "@/utils/exercise-set-specs";
import {
  emptyLoggedActuals,
  type LoggedActuals,
  type LoggedBox,
} from "@/utils/set-log-measures";

const KG_PER_LB = 0.45359237;
const ISO = "2026-05-01T00:00:00.000Z";
const EX_A = "11111111-1111-4111-8111-111111111111";

/**
 * A row as the form holds it: what is in each box, and the canonical value each
 * was seeded from. `reps` / `weight` / `rpe` are the strings in those boxes;
 * `weightKg` the weight box's seed.
 */
function row(over: {
  reps?: string;
  weight?: string;
  rpe?: string;
  weightKg?: number | null;
  completed?: boolean;
  entries?: Partial<Record<LoggedBox, string>>;
  seeds?: Partial<LoggedActuals>;
} = {}): SetRowValues {
  const base = emptySet();
  return {
    completed: over.completed ?? true,
    entries: {
      ...base.entries,
      ...(over.reps != null && { reps: over.reps }),
      ...(over.weight != null && { load: over.weight }),
      ...(over.rpe != null && { rpe: over.rpe }),
      ...over.entries,
    },
    seeds: {
      ...base.seeds,
      ...(over.weightKg !== undefined && { weight: over.weightKg }),
      ...over.seeds,
    },
  };
}

/** A ticked row carrying values — what a client who logged numbers produces. */
const ticked = (over: Parameters<typeof row>[0] = {}) => row({ ...over, completed: true });

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
/** The payload a save that records work produces. A refusal is its own test, below. */
const saved = (result: LogPayloadResult) => {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.payload;
};
const setsOf = (result: LogPayloadResult) => saved(result).exercises![0].sets;

// The form seeds every box from a canonical value, formatted for reading, and
// submits canonical values. Both halves of that round trip can be lossy (a
// weight converts, a distance converts, a duration reformats), so an untouched
// box must resubmit the value it came from rather than being re-parsed from the
// string it was shown as.
describe("buildLogPayload", () => {
  it("always tags the wire canonical, whatever the client sees", () => {
    const result = buildLogPayload(
      values([ticked({ reps: "10", weight: "225" })]),
      "imperial",
      ALL_DIRTY,
      working(1),
    );
    expect(saved(result).exercises![0].weightUnit).toBe("kg");
  });

  it("converts an edited weight from the client's unit to kilograms, to a hundredth", () => {
    const result = buildLogPayload(
      values([ticked({ reps: "10", weight: "225" })]),
      "imperial",
      ALL_DIRTY,
      working(1),
    );
    expect(setsOf(result)[0].weight).toBe(Math.round(225 * KG_PER_LB * 100) / 100);
  });

  it("stores a metric edit verbatim", () => {
    const result = buildLogPayload(
      values([ticked({ reps: "10", weight: "102.5" })]),
      "metric",
      ALL_DIRTY,
      working(1),
    );
    expect(setsOf(result)[0].weight).toBe(102.5);
  });

  it("resubmits a wholly untouched log byte-identical", () => {
    // 100 kg seeds as "220.5" for an imperial client; re-parsing that string
    // would store 100.02 kg.
    const result = buildLogPayload(
      values([ticked({ reps: "10", weight: "220.5", rpe: "8", weightKg: 100 })]),
      "imperial",
      NOTHING_DIRTY,
      working(1),
    );
    expect(setsOf(result)[0].weight).toBe(100);
  });

  // THE case. A row is dirty the moment its reps change, so a row-level guard
  // would let this drift — and the wholly-untouched test above would still pass.
  it("leaves an untouched WEIGHT alone when its row is dirty from a reps edit", () => {
    const dirtyRepsOnly = (_ex: number, _set: number, box: LoggedBox) => box === "reps";
    const result = buildLogPayload(
      values([ticked({ reps: "12", weight: "220.5", rpe: "8", weightKg: 100, seeds: { reps: 10, rpe: 8 } })]),
      "imperial",
      dirtyRepsOnly,
      working(1),
    );

    expect(setsOf(result)[0].reps).toBe(12);
    expect(setsOf(result)[0].weight).toBe(100);
    expect(setsOf(result)[0].rpe).toBe(8);
  });

  it("guards per set, not per exercise", () => {
    const onlySecondSetDirty = (_ex: number, setIndex: number) => setIndex === 1;
    const result = buildLogPayload(
      values([
        ticked({ reps: "10", weight: "220.5", weightKg: 100 }),
        ticked({ reps: "10", weight: "225", weightKg: 100 }),
      ]),
      "imperial",
      onlySecondSetDirty,
      working(2),
    );

    expect(setsOf(result)[0].weight).toBe(100);
    expect(setsOf(result)[1].weight).toBe(Math.round(225 * KG_PER_LB * 100) / 100);
  });

  it("clears the weight when an edited field is emptied", () => {
    const result = buildLogPayload(
      values([ticked({ reps: "10", weight: "", weightKg: 100 })]),
      "imperial",
      ALL_DIRTY,
      working(1),
    );
    expect(setsOf(result)[0].weight).toBeUndefined();
  });

  // ---- Every box, through its own grammar ----------------------------------

  it("parses each box through the entry grammar into its canonical unit", () => {
    const result = buildLogPayload(
      values([
        ticked({
          entries: {
            distance: "5 km",
            duration: "120",
            pace: "4:45",
            split: "1:52.3",
            heart_rate_zone: "Z3",
            tempo: "3-1-X-0",
            calories: "300",
            rir: "2",
          },
        }),
      ]),
      "metric",
      ALL_DIRTY,
      working(1),
    );
    expect(setsOf(result)[0]).toEqual({
      setNumber: 1,
      distanceMeters: 5000,
      durationSeconds: 7200,
      paceSecondsPerKm: 285,
      splitSecondsPer500m: 112.3,
      heartRateZone: 3,
      tempo: "3-1-X-0",
      calories: 300,
      rir: 2,
    });
  });

  it("reads an imperial client's bare distance and pace as miles, and a typed unit as typed", () => {
    const result = buildLogPayload(
      values([ticked({ entries: { distance: "3.1", pace: "7:39" } }), ticked({ entries: { distance: "800 yd", pace: "4:45 /km" } })]),
      "imperial",
      ALL_DIRTY,
      working(2),
    );
    expect(setsOf(result)[0].distanceMeters).toBe(4988.97);
    expect(setsOf(result)[0].paceSecondsPerKm).toBe(285);
    expect(setsOf(result)[1].distanceMeters).toBe(731.52);
    expect(setsOf(result)[1].paceSecondsPerKm).toBe(285);
  });

  // Amendment 1 to section 4.7: a set with any recorded value counts.
  it("sends a set that carries only a distance, and it counts as logged", () => {
    const result = buildLogPayload(
      values([ticked({ entries: { distance: "5 km" } })]),
      "metric",
      ALL_DIRTY,
      working(1),
    );
    expect(result.ok).toBe(true);
    expect(setsOf(result)).toEqual([{ setNumber: 1, distanceMeters: 5000 }]);
    expect(saved(result).completionQuality).toBe("full");
  });

  it("refuses a box it cannot read, naming the exercise, the set and the box", () => {
    const result = buildLogPayload(
      values([ticked({ entries: { reps: "10" } }), ticked({ entries: { pace: "fast" } })]),
      "metric",
      ALL_DIRTY,
      working(2),
    );
    expect(result).toEqual({ ok: false, reason: "unreadable", exerciseIndex: 0, setIndex: 1, box: "pace" });
  });

  it("refuses a value outside its column's limit or finer than its scale", () => {
    const over = buildLogPayload(values([ticked({ reps: "200" })]), "metric", ALL_DIRTY, working(1));
    expect(over).toMatchObject({ ok: false, reason: "unreadable", box: "reps" });
    const fine = buildLogPayload(values([ticked({ rpe: "8.25" })]), "metric", ALL_DIRTY, working(1));
    expect(fine).toMatchObject({ ok: false, reason: "unreadable", box: "rpe" });
    const tempo = buildLogPayload(values([ticked({ entries: { tempo: "slow" } })]), "metric", ALL_DIRTY, working(1));
    expect(tempo).toMatchObject({ ok: false, reason: "unreadable", box: "tempo" });
  });

  // ---- The tick decides what is sent (locked decisions 1 and 3) ------------

  // Nothing ticked is nothing to save. The form refuses it — and so does the
  // server, through the same rule — rather than storing an empty log.
  it("refuses the save when nothing is ticked", () => {
    const result = buildLogPayload(
      values([emptySet()]),
      "metric",
      ALL_DIRTY,
      working(1),
    );
    expect(result).toEqual({ ok: false, reason: "nothing" });
  });

  // Decision 3: doing the work is the claim; recording numbers is a bonus.
  it("sends a ticked set with every box empty", () => {
    const result = buildLogPayload(
      values([ticked()]),
      "metric",
      ALL_DIRTY,
      working(1),
    );
    expect(setsOf(result)).toEqual([{ setNumber: 1 }]);
  });

  // Decision 1: the tick is the ONLY thing that decides completion. Numbers left
  // in an unticked row are notes to self, not a claim that the set was done.
  it("does NOT send a filled set that was never ticked", () => {
    const result = buildLogPayload(
      values([
        ticked({ reps: "10" }),
        row({ reps: "9", weight: "100", rpe: "8", completed: false }),
      ]),
      "metric",
      ALL_DIRTY,
      working(2),
    );
    expect(setsOf(result)).toEqual([{ setNumber: 1, reps: 10 }]);
  });

  // THE identity case. The form's rows mirror the flattened prescription, so a
  // row's position IS its set number — but only if it is read off the original
  // array. Numbering after selecting collapsed a logged subset down to 1..n, and
  // the server then typed each row from the wrong spec (a lone working set
  // stored as set 1, typed `warmup`, and excluded from every performance metric).
  it("sends each ticked set's own row number, not its position among the ticked rows", () => {
    const result = buildLogPayload(
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

    expect(setsOf(result).map((s) => s.setNumber)).toEqual([2, 4]);
    expect(setsOf(result).map((s) => s.setNumber)).not.toEqual([1, 2]);
  });

  it("numbers a fully ticked exercise 1..n", () => {
    const result = buildLogPayload(
      values([
        ticked({ reps: "10", weight: "100" }),
        ticked({ reps: "10", weight: "100" }),
        ticked({ reps: "8", weight: "100" }),
      ]),
      "metric",
      ALL_DIRTY,
      working(3),
    );
    expect(setsOf(result).map((s) => s.setNumber)).toEqual([1, 2, 3]);
  });

  // ---- The derived completionQuality --------------------------------------
  //
  // The selector that used to ask the client for this is gone, so the payload
  // has to carry the outcome the ticks describe. The server ignores it whenever
  // `exercises` is present and re-derives — but it HONOURS it for a payload with
  // none, which is exactly the all-unticked case below.

  it("derives full when every prescribed working set is ticked", () => {
    const result = buildLogPayload(
      values([ticked(), ticked(), ticked()]),
      "metric",
      ALL_DIRTY,
      working(3),
    );
    expect(saved(result).completionQuality).toBe("full");
  });

  it("derives partial when some are ticked", () => {
    const result = buildLogPayload(
      values([ticked(), emptySet(), emptySet()]),
      "metric",
      ALL_DIRTY,
      working(3),
    );
    expect(saved(result).completionQuality).toBe("partial");
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
    const result = buildLogPayload(
      values([ticked(), ticked(), ticked()]),
      "metric",
      ALL_DIRTY,
      rows,
    );
    expect(saved(result).completionQuality).toBe("full");
    expect(setsOf(result).map((s) => s.setNumber)).toEqual([1, 2, 3]);
  });

  // A warm-up scores nothing, so ticking only it is short of complete —
  // partial, never a skip. The client did some of this workout.
  it("is partial when only the warm-up is ticked", () => {
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
    const result = buildLogPayload(
      values([ticked(), emptySet(), emptySet()]),
      "metric",
      ALL_DIRTY,
      rows,
    );
    expect(saved(result).completionQuality).toBe("partial");
    // Recorded even though it scores nothing — a coach investigating a niggle
    // needs to see it.
    expect(setsOf(result)).toEqual([{ setNumber: 1 }]);
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
    ...emptyLoggedActuals(),
    reps: 10,
    weight: 100,
    rpe: null,
    createdAt: ISO,
    updatedAt: ISO,
    ...over,
  };
}

/** Every measure a set can carry, as a log would hold it. */
const EVERYTHING: Partial<SetLog> = {
  reps: 8,
  weight: 100,
  rpe: 8,
  rir: 2,
  tempo: "3-1-X-0",
  distanceMeters: 5000,
  durationSeconds: 1500.5,
  paceSecondsPerKm: 300,
  splitSecondsPer500m: 112.3,
  calories: 300,
  cadence: 90,
  strokeRate: 28,
  resistance: 7,
  heartRateZone: 3,
  heartRate: 150,
  power: 250,
  ftpPercent: 80,
  restSeconds: 90,
};

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
    expect(sets.map((s) => s.entries.reps)).toEqual(["", "", "10", "10", "10", ""]);
  });

  it("re-saves a restored partial log with its ORIGINAL set numbers", () => {
    const seeded = seedDefaultValues({
      prescribedViews: [view({ sets: 6 })],
      sessionLog: SESSION_LOG,
      exerciseLogs: [exerciseLog([setLog(3), setLog(4), setLog(5)])],
      viewer: "metric",
    });

    const result = buildLogPayload(
      seeded,
      "metric",
      NOTHING_DIRTY,
      working(6),
    );
    expect(setsOf(result).map((s) => s.setNumber)).toEqual([3, 4, 5]);
    expect(saved(result).completionQuality).toBe("partial");
  });

  // Every save full-replaces the log's sets, so a value the form did not
  // restore would be erased on the next save. Every measure a set carries goes
  // into its seed — rest taken included, which has no box — and reads back in
  // the viewer's units.
  it("restores every value a logged set carries and resubmits it untouched, byte-identical", () => {
    const seeded = seedDefaultValues({
      prescribedViews: [view({ sets: 1 })],
      sessionLog: SESSION_LOG,
      exerciseLogs: [exerciseLog([setLog(1, EVERYTHING)])],
      viewer: "metric",
    });

    const set = seeded.exercises[0].sets[0];
    expect(set.completed).toBe(true);
    expect(set.entries).toEqual({
      load: "100",
      reps: "8",
      rpe: "8",
      rir: "2",
      tempo: "3-1-X-0",
      distance: "5 km",
      duration: "25:00.5",
      pace: "5:00 /km",
      split: "1:52.3 /500m",
      calories: "300",
      cadence: "90",
      stroke_rate: "28",
      resistance: "7",
      heart_rate_zone: "Z3",
      heart_rate: "150",
      power: "250",
      ftp_percent: "80",
    });

    const result = buildLogPayload(seeded, "metric", NOTHING_DIRTY, working(1));
    expect(setsOf(result)).toEqual([{ setNumber: 1, ...EVERYTHING }]);
  });

  it("reads a logged set back in an imperial client's units and still resubmits the stored value", () => {
    const seeded = seedDefaultValues({
      prescribedViews: [view({ sets: 1 })],
      sessionLog: SESSION_LOG,
      exerciseLogs: [exerciseLog([setLog(1, { distanceMeters: 5000, paceSecondsPerKm: 300, weight: 100 })])],
      viewer: "imperial",
    });
    const set = seeded.exercises[0].sets[0];
    expect(set.entries.distance).toBe("3.11 mi");
    expect(set.entries.pace).toBe("8:03 /mi");
    expect(set.entries.load).toBe("220.5");

    const result = buildLogPayload(seeded, "imperial", NOTHING_DIRTY, working(1));
    expect(setsOf(result)[0]).toMatchObject({ distanceMeters: 5000, paceSecondsPerKm: 300, weight: 100 });
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
    expect(sets[3]).toMatchObject({ entries: { reps: "6" }, completed: true });

    const result = buildLogPayload(seeded, "metric", NOTHING_DIRTY, working(3));
    expect(setsOf(result).map((s) => s.setNumber)).toEqual([1, 2, 3, 4]);
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
