import { describe, it, expect } from "vitest";
import type { PlanEditDay, PlanEditSession, PlanForEditing } from "@/services/plan-edit-service";
import type { TrainingExercise, TrainingExerciseGroup } from "@/types/training";
import type { SetSpec } from "@/utils/exercise-set-specs";
import {
  STRAIGHT_SETS,
  groupSettingsOf,
  sessionExercises,
  type GroupSettings,
} from "@/utils/exercise-groups";
import { planEditSaveSchema, replaceSessionSchema } from "@/lib/validations/training";
import { addDaysToDateString } from "@/lib/date-helpers";
import {
  planForEditingToDraft,
  draftToPlanEditBody,
  sessionDraftToPlacedPayload,
  trainingSessionToDraft,
} from "./placed-serialize";
import { cloneWeek, normalizeDraft } from "./program-builder-model";
import { DAYS_PER_WEEK, type ProgramDraft } from "./program-builder-types";

const PLAN_START = "2026-07-15";
const isTrainingPos = (i: number) => i % 7 === 0 || i % 7 === 2 || i % 7 === 4;
const dateAt = (position: number) => addDaysToDateString(PLAN_START, position);

const BENCH_SPECS: SetSpec[] = [
  { set_number: 1, set_type: "warmup" },
  { set_number: 2, set_type: "working", reps_min: 6, reps_max: 8 },
];

function makeExercise(overrides: Partial<TrainingExercise> = {}): TrainingExercise {
  return {
    id: "row-ex-1",
    sessionId: "row-sess-0",
    groupId: "row-grp-1",
    exerciseId: "cat-1",
    name: "Bench Press",
    orderIndex: 0,
    sets: 4,
    repsMin: 8,
    repsMax: 12,
    repsTarget: undefined,
    rpeTarget: 8,
    percentage1rm: undefined,
    tempo: undefined,
    restSeconds: 90,
    notes: undefined,
    isWarmup: false,
    setSpecs: BENCH_SPECS,
    videoUrl: "https://example.com/bench",
    prescribedFields: ["set_type", "reps", "load", "rpe", "rest"],
    createdAt: "2026-07-15T00:00:00Z",
    updatedAt: "2026-07-15T00:00:00Z",
    ...overrides,
  };
}

/** A placed group row at `orderIndex`, holding `exercises` in order. */
function makeGroup(
  id: string,
  orderIndex: number,
  settings: GroupSettings,
  exercises: TrainingExercise[],
): TrainingExerciseGroup {
  return {
    id,
    sessionId: "row-sess-0",
    orderIndex,
    ...settings,
    exercises: exercises.map((e, i) => ({ ...e, groupId: id, orderIndex: i })),
  };
}

/** A lone exercise: a straight-sets group of one. */
function lone(exercise: TrainingExercise, orderIndex = 0): TrainingExerciseGroup {
  return makeGroup(`row-grp-${exercise.id}`, orderIndex, STRAIGHT_SETS, [exercise]);
}

/** The calendar entry of the session at `place` on the day at `position`. */
const eventAt = (position: number, place = 1) =>
  `e0000000-0000-4000-8000-${String(position * 10 + place).padStart(12, "0")}`;

/** The session at `place` (1, 2, …) on the day at `position`, read from its entry. */
function makeSession(position: number, groups: TrainingExerciseGroup[], place = 1): PlanEditSession {
  const suffix = place === 1 ? "" : `-${place}`;
  return {
    eventId: eventAt(position, place),
    name: `Session ${position}${suffix}`,
    focus: "strength",
    estimatedDurationMinutes: 60,
    notes: "note",
    calorieSurplusPercentage: 15,
    groups,
  };
}

/** The plan's day at `position`: training on days 1, 3 and 5 of each week. */
function makeDay(
  position: number,
  groups: TrainingExerciseGroup[] = position === 0 ? [lone(makeExercise())] : [],
): PlanEditDay {
  if (!isTrainingPos(position)) return { date: dateAt(position), sessions: [] };
  return { date: dateAt(position), sessions: [makeSession(position, groups)] };
}

/** A two-week plan from 2026-07-15; today is 07-22 (position 7), and a
 *  workout logged today makes 07-23 the first editable day. */
function makeRead(overrides: Partial<PlanForEditing> = {}): PlanForEditing {
  return {
    plan: {
      id: "plan-1",
      name: "PPL Block",
      splitType: "Push/Pull",
      effectiveFrom: PLAN_START,
      effectiveUntil: dateAt(13),
    },
    clientToday: dateAt(7),
    firstEditableDate: dateAt(8),
    limit: null,
    days: Array.from({ length: 14 }, (_, i) => makeDay(i)),
    version: "v-1",
    ...overrides,
  };
}

describe("planForEditingToDraft", () => {
  it("lays the days as weeks of seven, slot i the plan's day i", () => {
    const { draft } = planForEditingToDraft(makeRead());
    expect(draft.weeks).toHaveLength(2);
    draft.weeks.forEach((week, w) => {
      expect(week.weekIndex).toBe(w);
      expect(week.days).toHaveLength(DAYS_PER_WEEK);
      week.days.forEach((slot, d) => {
        expect(slot.orderIndex).toBe(d);
        expect(slot.isRest).toBe(!isTrainingPos(w * DAYS_PER_WEEK + d));
      });
    });
    expect(draft.weeks[1].days[2].sessions.map((s) => s.name)).toEqual(["Session 9"]);
  });

  it("clones a session day with fresh uids: name, focus, duration, notes, surplus, exercises", () => {
    const read = makeRead();
    const slot = planForEditingToDraft(read).draft.weeks[0].days[0];
    expect(slot.sessions).toHaveLength(1);
    expect(slot.sessions[0]).toMatchObject({
      name: "Session 0",
      focus: "strength",
      estimatedDurationMinutes: 60,
      notes: "note",
      calorieSurplusPercentage: 15,
      sessionType: "training",
    });
    const [exercise] = sessionExercises(slot.sessions[0]);
    expect(exercise).toMatchObject({
      name: "Bench Press",
      exerciseId: "cat-1",
      sets: 4,
      repsMin: 8,
      repsMax: 12,
      rpeTarget: 8,
      restSeconds: 90,
      videoUrl: "https://example.com/bench",
    });
    expect(exercise.setSpecs).toEqual(BENCH_SPECS);
    // The row's id never becomes the draft's identity.
    expect(exercise.uid).not.toBe("row-ex-1");

    // Every seed mints its own uids.
    const again = planForEditingToDraft(read).draft.weeks[0].days[0];
    expect(again.uid).not.toBe(slot.uid);
    expect(again.sessions[0].uid).not.toBe(slot.sessions[0].uid);
    expect(again.sessions[0].groups[0].uid).not.toBe(slot.sessions[0].groups[0].uid);
    expect(sessionExercises(again.sessions[0])[0].uid).not.toBe(exercise.uid);
  });

  it("lays rest days and greyed days as empty slots", () => {
    // The block ends on position 10, and the read lays nothing past it.
    const read = makeRead({
      limit: { endsOn: dateAt(10), source: "block" },
      days: Array.from({ length: 14 }, (_, i): PlanEditDay =>
        i > 10 ? { date: dateAt(i), sessions: [] } : makeDay(i),
      ),
    });
    const slots = planForEditingToDraft(read).draft.weeks.flatMap((w) => w.days);
    // Rest on 1 and 3; 11 is a training day the limit greyed.
    for (const position of [1, 3, 11, 12, 13]) {
      expect(slots[position]).toMatchObject({ isRest: true, sessions: [] });
    }
    expect(slots[9].sessions.map((s) => s.name)).toEqual(["Session 9"]);
  });

  it("counts the editable days from the plan's start", () => {
    const capped = planForEditingToDraft(
      makeRead({ limit: { endsOn: "2026-08-02", source: "next_block" } }),
    );
    expect(capped.editableDays).toEqual({ from: 8, through: 18 });
    // Nothing bounds the plan: no last day.
    expect(planForEditingToDraft(makeRead()).editableDays).toEqual({ from: 8, through: null });
  });

  it("places today on the grid, and nowhere when it falls outside", () => {
    expect(planForEditingToDraft(makeRead()).todayPosition).toBe(7);
    expect(planForEditingToDraft(makeRead({ clientToday: PLAN_START })).todayPosition).toBe(0);
    expect(planForEditingToDraft(makeRead({ clientToday: dateAt(13) })).todayPosition).toBe(13);
    // Before the plan starts, and past the grid's last day.
    expect(planForEditingToDraft(makeRead({ clientToday: dateAt(-1) })).todayPosition).toBeNull();
    expect(planForEditingToDraft(makeRead({ clientToday: dateAt(14) })).todayPosition).toBeNull();
  });

  it("seeds a saved draft of the plan with no surplus default", () => {
    const { draft } = planForEditingToDraft(makeRead());
    expect(draft).toMatchObject({
      id: "plan-1",
      name: "PPL Block",
      description: null,
      splitType: "Push/Pull",
      status: "saved",
      // A placed session's surplus is absolute; there is nothing to inherit.
      defaultSurplusPercentage: null,
      programDurationWeeks: 2,
    });
  });
});

describe("planForEditingToDraft on a day holding several sessions", () => {
  it("lays a day's sessions in its order and remembers each one's calendar entry by uid", () => {
    // Position 2 holds a morning run then an evening lift.
    const read = makeRead({
      days: Array.from({ length: 14 }, (_, i): PlanEditDay =>
        i === 2
          ? {
              date: dateAt(2),
              sessions: [
                { ...makeSession(2, []), name: "AM run" },
                { ...makeSession(2, [lone(makeExercise())], 2), name: "PM lift" },
              ],
            }
          : makeDay(i),
      ),
    });
    const { draft, sessionEvents } = planForEditingToDraft(read);

    const day = draft.weeks[0].days[2];
    expect(day.isRest).toBe(false);
    expect(day.sessions.map((s) => s.name)).toEqual(["AM run", "PM lift"]);
    expect(sessionExercises(day.sessions[1]).map((e) => e.name)).toEqual(["Bench Press"]);
    expect(sessionEvents[day.sessions[0].uid]).toBe(eventAt(2));
    expect(sessionEvents[day.sessions[1].uid]).toBe(eventAt(2, 2));

    // Every seeded session, and only those, has its entry.
    const seeded = draft.weeks.flatMap((w) => w.days.flatMap((d) => d.sessions));
    expect(Object.keys(sessionEvents).sort()).toEqual(seeded.map((s) => s.uid).sort());
    expect(seeded).toHaveLength(7);
  });
});

describe("draftToPlanEditBody", () => {
  // Position 2 holds two sessions; training otherwise on days 1, 3 and 5. The
  // bench's catalog id is a uuid, so the body can pass its schema.
  function openTwoADay() {
    return planForEditingToDraft(
      makeRead({
        days: Array.from({ length: 14 }, (_, i): PlanEditDay =>
          i === 0
            ? makeDay(0, [lone(makeExercise({ exerciseId: BENCH_ID }))])
            : i === 2
              ? { date: dateAt(2), sessions: [makeSession(2, []), makeSession(2, [], 2)] }
              : makeDay(i),
        ),
      }),
    );
  }

  it("sends every day in order, each holding its sessions in order; a rest day holds none", () => {
    const { draft, sessionEvents } = openTwoADay();
    const version = "eyJwbGFuX3VwZGF0ZWRfYXQiOiIyMDI2LTA3LTIwIn0";
    const body = draftToPlanEditBody(draft, version, sessionEvents);

    expect(Object.keys(body).sort()).toEqual(["days", "plan", "version"]);
    expect(body.version).toBe(version);
    expect(body.plan).toEqual({ name: "PPL Block", splitType: "Push/Pull" });
    expect(body.days).toHaveLength(14);
    expect(body.days.map((day) => day.sessions.map((s) => s.name))).toEqual(
      Array.from({ length: 14 }, (_, i) =>
        i === 2 ? ["Session 2", "Session 2-2"] : isTrainingPos(i) ? [`Session ${i}`] : [],
      ),
    );
    expect(body.days[2].sessions.map((s) => s.eventId)).toEqual([eventAt(2), eventAt(2, 2)]);
    // A session's fields and per-set fidelity survive verbatim.
    expect(body.days[0].sessions[0]).toMatchObject({
      eventId: eventAt(0),
      focus: "strength",
      estimatedDurationMinutes: 60,
      calorieSurplusPercentage: 15,
      notes: "note",
    });
    const [bench] = sessionExercises(body.days[0].sessions[0]);
    expect(bench.setSpecs).toEqual(BENCH_SPECS);
    expect(bench.videoUrl).toBe("https://example.com/bench");

    const parsed = planEditSaveSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(body);
  });

  it("claims an entry by uid wherever its session now is; a copy and a new session claim none", () => {
    const { draft, sessionEvents } = openTwoADay();
    const [week0, week1] = draft.weeks;
    const evening = week0.days[2].sessions[1];
    // The evening lift moves to position 3; week 1 is replaced by a copy of week 0.
    const edited: ProgramDraft = normalizeDraft({
      ...draft,
      weeks: [
        {
          ...week0,
          days: week0.days.map((slot, d) =>
            d === 2
              ? { ...slot, sessions: [slot.sessions[0]] }
              : d === 3
                ? { ...slot, sessions: [evening] }
                : d === 6
                  ? { ...slot, sessions: [{ ...evening, uid: "sess-new", name: "New" }] }
                  : slot,
          ),
        },
        { ...cloneWeek(week0), uid: week1.uid },
      ],
    });

    const body = draftToPlanEditBody(edited, "v-1", sessionEvents);
    expect(body.days[2].sessions.map((s) => s.eventId)).toEqual([eventAt(2)]);
    expect(body.days[3].sessions.map((s) => s.eventId)).toEqual([eventAt(2, 2)]);
    expect(body.days[6].sessions.map((s) => s.eventId)).toEqual([null]);
    // Every session of the copied week is new to the calendar.
    expect(body.days.slice(7).flatMap((day) => day.sessions.map((s) => s.eventId))).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(body.days.slice(7).map((day) => day.sessions.length)).toEqual([1, 0, 2, 0, 1, 0, 0]);
  });

  it("with no entries to claim, every session names none", () => {
    const { draft } = openTwoADay();
    const body = draftToPlanEditBody(draft, "v-1", {});
    expect(body.days.every((day) => day.sessions.every((s) => s.eventId === null))).toBe(true);
  });

  it("caps session names, the plan name and focus at 100 characters; no focus stays null", () => {
    const { draft, sessionEvents } = planForEditingToDraft(makeRead());
    const long = "x".repeat(150);
    const renamed = normalizeDraft({
      ...draft,
      name: long,
      splitType: long,
      weeks: draft.weeks.map((week) => ({
        ...week,
        days: week.days.map((slot) => ({
          ...slot,
          sessions: slot.sessions.map((s) => ({ ...s, name: long })),
        })),
      })),
    });
    const body = draftToPlanEditBody(renamed, "v-1", sessionEvents);
    expect(body.plan).toEqual({ name: "x".repeat(100), splitType: "x".repeat(100) });
    expect(body.days[0].sessions[0].name).toBe("x".repeat(100));
    expect(draftToPlanEditBody({ ...draft, splitType: null }, "v-1", sessionEvents).plan.splitType).toBeNull();
  });
});

// =============================================================================
// Groups (migration 178) — the tray and the plan editor keep every setting
// =============================================================================

const SQUAT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROW_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BENCH_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// A timed group with every setting its format uses set, so a dropped setting
// shows. (A For time: rounds, a cap, both rests and notes — the most any one
// format stores; the write schemas refuse a setting a format doesn't use, so
// no group carries all seven. Its rounds are its exercises' rows.)
const EVERY_SETTING: GroupSettings = {
  format: "for_time",
  rounds: 2,
  timeCapSeconds: 900,
  intervalSeconds: null,
  restBetweenExercisesSeconds: 15,
  restBetweenRoundsSeconds: 90,
  notes: "A",
};

/**
 * A circuit of Back Squat then Bent-over Row, then a lone Bench Press. Catalog
 * ids are uuids, so the write bodies can pass their schemas.
 */
function makeGroupedGroups(): TrainingExerciseGroup[] {
  return [
    makeGroup("row-grp-circuit", 0, EVERY_SETTING, [
      makeExercise({
        id: "row-ex-squat",
        exerciseId: SQUAT_ID,
        name: "Back Squat",
        repsTarget: "8-10",
        percentage1rm: 75,
        tempo: "3-0-1-0",
        notes: "Brace",
        videoUrl: "https://example.com/squat",
        prescribedFields: ["set_type", "reps", "load"],
      }),
      makeExercise({
        id: "row-ex-row",
        exerciseId: ROW_ID,
        name: "Bent-over Row",
        sets: 2,
        repsMin: 10,
        repsMax: 12,
        rpeTarget: undefined,
        restSeconds: undefined,
        setSpecs: null,
        videoUrl: null,
        prescribedFields: ["reps", "rpe"],
      }),
    ]),
    lone(makeExercise({ id: "row-ex-bench", exerciseId: BENCH_ID }), 1),
  ];
}

/** The groups every write body must carry for makeGroupedGroups, in order. */
const GROUPED_INPUT = [
  {
    ...EVERY_SETTING,
    exercises: [
      {
        name: "Back Squat",
        exerciseId: SQUAT_ID,
        sets: 4,
        repsMin: 8,
        repsMax: 12,
        repsTarget: "8-10",
        rpeTarget: 8,
        percentage1rm: 75,
        tempo: "3-0-1-0",
        restSeconds: 90,
        notes: "Brace",
        isWarmup: false,
        setSpecs: BENCH_SPECS,
        videoUrl: "https://example.com/squat",
        prescribedFields: ["set_type", "reps", "load"],
      },
      {
        name: "Bent-over Row",
        exerciseId: ROW_ID,
        sets: 2,
        repsMin: 10,
        repsMax: 12,
        repsTarget: null,
        rpeTarget: null,
        percentage1rm: null,
        tempo: null,
        restSeconds: null,
        notes: null,
        isWarmup: false,
        setSpecs: null,
        videoUrl: null,
        prescribedFields: ["reps", "rpe"],
      },
    ],
  },
  {
    ...STRAIGHT_SETS,
    exercises: [
      {
        name: "Bench Press",
        exerciseId: BENCH_ID,
        sets: 4,
        repsMin: 8,
        repsMax: 12,
        repsTarget: null,
        rpeTarget: 8,
        percentage1rm: null,
        tempo: null,
        restSeconds: 90,
        notes: null,
        isWarmup: false,
        setSpecs: BENCH_SPECS,
        videoUrl: "https://example.com/bench",
        prescribedFields: ["set_type", "reps", "load", "rpe", "rest"],
      },
    ],
  },
];

describe("groups through the placed paths", () => {
  const groupedSource = () => ({
    name: "Push A",
    focus: "strength",
    estimatedDurationMinutes: 60,
    calorieSurplusPercentage: 15,
    notes: "note",
    groups: makeGroupedGroups(),
  });

  it("trainingSessionToDraft keeps a circuit's settings, with fresh grp- uids and exercises in group order", () => {
    const { draft, exerciseIdByUid } = trainingSessionToDraft(groupedSource());

    expect(draft.groups).toHaveLength(2);
    const [circuit, bench] = draft.groups;
    expect(groupSettingsOf(circuit)).toEqual(EVERY_SETTING);
    expect(groupSettingsOf(bench)).toEqual(STRAIGHT_SETS);
    expect(circuit.uid).toMatch(/^grp-/);
    expect(bench.uid).toMatch(/^grp-/);
    expect(circuit.uid).not.toBe(bench.uid);
    expect(circuit.exercises.map((e) => e.name)).toEqual(["Back Squat", "Bent-over Row"]);
    expect(bench.exercises.map((e) => e.name)).toEqual(["Bench Press"]);
    // Each draft exercise maps back to its row.
    expect(sessionExercises(draft).map((e) => exerciseIdByUid.get(e.uid))).toEqual([
      "row-ex-squat",
      "row-ex-row",
      "row-ex-bench",
    ]);
  });

  it("sessionDraftToPlacedPayload emits every group setting and exercise, and passes replaceSessionSchema", () => {
    const payload = sessionDraftToPlacedPayload(trainingSessionToDraft(groupedSource()).draft);

    expect(payload.groups).toEqual(GROUPED_INPUT);
    // A position is an array place: no exercise input carries one, nor a superset label.
    for (const exercise of sessionExercises(payload)) {
      expect(exercise).not.toHaveProperty("orderIndex");
      expect(exercise).not.toHaveProperty("supersetGroup");
    }

    const parsed = replaceSessionSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(payload);
  });

  it("planForEditingToDraft → draftToPlanEditBody carries a day's groups and settings, and passes planEditSaveSchema", () => {
    // Position 9 (week 2, day 3) holds the grouped session; every other day none.
    const read = makeRead({
      days: Array.from({ length: 14 }, (_, i) =>
        i === 9 ? makeDay(9, makeGroupedGroups()) : makeDay(i, []),
      ),
    });
    const { draft, sessionEvents } = planForEditingToDraft(read);
    const day = draft.weeks[1].days[2].sessions[0];
    expect(day.groups.map((g) => groupSettingsOf(g))).toEqual([EVERY_SETTING, STRAIGHT_SETS]);

    const body = draftToPlanEditBody(draft, read.version, sessionEvents);
    expect(body.days[9].sessions[0].groups).toEqual(GROUPED_INPUT);
    expect(body.days.flatMap((d) => d.sessions).filter((s) => s.groups.length > 0)).toHaveLength(1);

    const parsed = planEditSaveSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(body);
  });
});
