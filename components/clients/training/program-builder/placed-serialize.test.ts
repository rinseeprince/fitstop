import { describe, it, expect } from "vitest";
import type { PlanEditDay, PlanForEditing } from "@/services/plan-edit-service";
import type { TrainingExercise } from "@/types/training";
import type { SetSpec } from "@/utils/exercise-set-specs";
import { addDaysToDateString } from "@/lib/date-helpers";
import { planForEditingToDraft, draftToPlanEditBody } from "./placed-serialize";
import { draftToSessionInputs } from "./program-builder-serialize";
import { DAYS_PER_WEEK } from "./program-builder-types";

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
    supersetGroup: undefined,
    isWarmup: false,
    setSpecs: BENCH_SPECS,
    videoUrl: "https://example.com/bench",
    prescribedFields: null,
    createdAt: "2026-07-15T00:00:00Z",
    updatedAt: "2026-07-15T00:00:00Z",
    ...overrides,
  };
}

/** The plan's day at `position`: training on days 1, 3 and 5 of each week. */
function makeDay(position: number): PlanEditDay {
  if (!isTrainingPos(position)) return { date: dateAt(position), isRest: true };
  return {
    date: dateAt(position),
    isRest: false,
    name: `Session ${position}`,
    focus: "strength",
    estimatedDurationMinutes: 60,
    notes: "note",
    calorieSurplusPercentage: 15,
    exercises: position === 0 ? [makeExercise()] : [],
  };
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
    expect(draft.weeks[1].days[2].session?.name).toBe("Session 9");
  });

  it("clones a session day with fresh uids: name, focus, duration, notes, surplus, exercises", () => {
    const read = makeRead();
    const slot = planForEditingToDraft(read).draft.weeks[0].days[0];
    expect(slot.session).toMatchObject({
      name: "Session 0",
      focus: "strength",
      estimatedDurationMinutes: 60,
      notes: "note",
      calorieSurplusPercentage: 15,
      sessionType: "training",
    });
    const [exercise] = slot.session!.exercises;
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
    expect(again.session!.uid).not.toBe(slot.session!.uid);
    expect(again.session!.exercises[0].uid).not.toBe(exercise.uid);
  });

  it("lays rest days and greyed days as empty slots", () => {
    // The block ends on position 10, and the read lays nothing past it.
    const read = makeRead({
      limit: { endsOn: dateAt(10), source: "block" },
      days: Array.from({ length: 14 }, (_, i): PlanEditDay =>
        i > 10 ? { date: dateAt(i), isRest: true } : makeDay(i),
      ),
    });
    const slots = planForEditingToDraft(read).draft.weeks.flatMap((w) => w.days);
    // Rest on 1 and 3; 11 is a training day the limit greyed.
    for (const position of [1, 3, 11, 12, 13]) {
      expect(slots[position]).toMatchObject({ isRest: true, session: null });
    }
    expect(slots[9].session?.name).toBe("Session 9");
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

describe("draftToPlanEditBody", () => {
  it("sends the whole grid, the plan's name and focus, and the version unchanged", () => {
    const { draft } = planForEditingToDraft(makeRead());
    const version = "eyJwbGFuX3VwZGF0ZWRfYXQiOiIyMDI2LTA3LTIwIn0";
    const body = draftToPlanEditBody(draft, version);

    expect(body.version).toBe(version);
    expect(body.plan).toEqual({ name: "PPL Block", splitType: "Push/Pull" });
    expect(body.sessions).toEqual(draftToSessionInputs(draft));
    expect(body.sessions).toHaveLength(14);
    body.sessions.forEach((s, i) => {
      expect(s.orderIndex).toBe(i);
      expect(s.weekIndex).toBe(Math.floor(i / DAYS_PER_WEEK));
      expect(s.isRest).toBe(!isTrainingPos(i));
    });
    // Per-set fidelity survives verbatim.
    expect(body.sessions[0].exercises[0].setSpecs).toEqual(BENCH_SPECS);
    expect(body.sessions[0].exercises[0].videoUrl).toBe("https://example.com/bench");
  });

  it("caps the name and focus at 100 characters; no focus stays null", () => {
    const { draft } = planForEditingToDraft(makeRead());
    const long = "x".repeat(150);
    expect(draftToPlanEditBody({ ...draft, name: long, splitType: long }, "v-1").plan).toEqual({
      name: "x".repeat(100),
      splitType: "x".repeat(100),
    });
    expect(draftToPlanEditBody({ ...draft, splitType: null }, "v-1").plan.splitType).toBeNull();
  });
});
