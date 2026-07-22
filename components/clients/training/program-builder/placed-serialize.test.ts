import { describe, it, expect } from "vitest";
import type {
  PlacedPlanForBuilder,
  PlacedSlotRead,
} from "@/services/plan-amendment-service";
import type { TrainingExercise } from "@/types/training";
import { placedPlanToDraft, draftToAmendBody } from "./placed-serialize";
import { draftToSessionInputs } from "./program-builder-serialize";
import { DAYS_PER_WEEK } from "./program-builder-types";

const isTrainingPos = (i: number) => i % 7 === 0 || i % 7 === 2 || i % 7 === 4;

function makeExercise(overrides: Partial<TrainingExercise> = {}): TrainingExercise {
  return {
    id: "row-ex-1",
    sessionId: "cur-0",
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
    setSpecs: [
      { set_number: 1, set_type: "warmup" },
      { set_number: 2, set_type: "working", reps_min: 6, reps_max: 8 },
    ],
    videoUrl: "https://example.com/bench",
    createdAt: "2026-07-15T00:00:00Z",
    updatedAt: "2026-07-15T00:00:00Z",
    ...overrides,
  };
}

function makeSlot(position: number, overrides: Partial<PlacedSlotRead> = {}): PlacedSlotRead {
  const training = isTrainingPos(position);
  return {
    id: `cur-${position}`,
    name: training ? `Session ${position}` : "Rest",
    focus: training ? "strength" : null,
    weekIndex: Math.floor(position / 7),
    orderIndex: position,
    isRest: !training,
    estimatedDurationMinutes: training ? 60 : null,
    calorieSurplusPercentage: training ? 15 : null,
    notes: training ? "note" : null,
    sessionType: "training",
    createdAt: "2026-07-15T00:00:00Z",
    exercises: training && position === 0 ? [makeExercise()] : [],
    events: [],
    ...overrides,
  };
}

function makeRead(overrides: Partial<PlacedPlanForBuilder> = {}): PlacedPlanForBuilder {
  return {
    plan: {
      id: "plan-1",
      name: "PPL Block",
      splitType: "Push/Pull",
      programDurationWeeks: 2,
      frequencyPerWeek: 3,
      effectiveFrom: "2026-07-15",
      phaseId: null,
      savedPlanId: null,
      status: "active",
      updatedAt: "2026-07-20T00:00:00Z",
    },
    clientToday: "2026-07-22",
    windowEnd: "2026-07-28",
    isFullyPast: false,
    amendmentToken: "tok-1",
    sessions: Array.from({ length: 14 }, (_, i) => makeSlot(i)),
    futureModifiedEvents: [],
    ...overrides,
  };
}

describe("placedPlanToDraft", () => {
  it("maps a week-shaped read positionally with full session fidelity", () => {
    const seed = placedPlanToDraft(makeRead());

    expect(seed.draft.id).toBe("plan-1");
    expect(seed.draft.name).toBe("PPL Block");
    expect(seed.draft.splitType).toBe("Push/Pull");
    expect(seed.draft.status).toBe("saved");
    // Absolute surplus semantics — there is no plan default to inherit.
    expect(seed.draft.defaultSurplusPercentage).toBeNull();
    expect(seed.draft.weeks).toHaveLength(2);
    for (const week of seed.draft.weeks) {
      expect(week.days).toHaveLength(DAYS_PER_WEEK);
    }

    const day0 = seed.draft.weeks[0].days[0];
    expect(day0.isRest).toBe(false);
    expect(day0.session).toMatchObject({
      name: "Session 0",
      focus: "strength",
      calorieSurplusPercentage: 15,
      notes: "note",
      sessionType: "training",
    });
    expect(day0.session!.exercises[0]).toMatchObject({
      name: "Bench Press",
      exerciseId: "cat-1",
      videoUrl: "https://example.com/bench",
    });
    expect(day0.session!.exercises[0].setSpecs).toEqual([
      { set_number: 1, set_type: "warmup" },
      { set_number: 2, set_type: "working", reps_min: 6, reps_max: 8 },
    ]);
    expect(seed.draft.weeks[0].days[1].isRest).toBe(true);
    expect(seed.amendmentToken).toBe("tok-1");
  });

  it("maps every non-rest slot's fresh session uid to its DB row id", () => {
    const seed = placedPlanToDraft(makeRead());
    const trainingSlots = seed.draft.weeks.flatMap((w) => w.days).filter((d) => d.session);
    expect(trainingSlots).toHaveLength(6);
    for (const slot of trainingSlots) {
      expect(seed.sessionIdByUid.get(slot.session!.uid)).toBeDefined();
    }
    expect(seed.sessionIdByUid.get(seed.draft.weeks[0].days[0].session!.uid)).toBe("cur-0");
    expect(seed.sessionIdByUid.get(seed.draft.weeks[1].days[0].session!.uid)).toBe("cur-7");
    // Fresh uids every call — two seeds never share identity.
    const again = placedPlanToDraft(makeRead());
    expect(again.draft.weeks[0].days[0].session!.uid).not.toBe(
      seed.draft.weeks[0].days[0].session!.uid,
    );
  });

  it("locks elapsed positions (and computes fullyLocked) via the shared lock model", () => {
    const seed = placedPlanToDraft(makeRead());
    // Positions 0..6 (07-15..07-21) locked; 07-22 IS today → open.
    const slots = seed.draft.weeks.flatMap((w) => w.days);
    expect(seed.lockedSlotUids).toEqual(slots.slice(0, 7).map((s) => s.uid));
    expect(seed.fullyLocked).toBe(false);

    const ended = placedPlanToDraft(makeRead({ clientToday: "2026-09-01", isFullyPast: true }));
    expect(ended.fullyLocked).toBe(true);
    expect(ended.lockedSlotUids).toHaveLength(14);
  });

  it("locks a future slot whose event already completed (early log)", () => {
    const read = makeRead();
    read.sessions[11] = makeSlot(11, {
      events: [{ id: "ev-11", date: "2026-07-26", status: "completed", isModified: false }],
    });
    const seed = placedPlanToDraft(read);
    const slots = seed.draft.weeks.flatMap((w) => w.days);
    expect(seed.lockedSlotUids).toContain(slots[11].uid);
  });

  it("diverged plans take the flat path: 1:1 slots in canonical order + tail rest padding", () => {
    // 9 rows all weekIndex 0 (colliding coords / legacy shape): not groupable
    // into exact weeks → flat repack into 2 weeks with 5 rest-padding slots.
    const read = makeRead({
      sessions: Array.from({ length: 9 }, (_, i) =>
        makeSlot(i, { weekIndex: 0, orderIndex: i % 7 }),
      ),
    });
    const seed = placedPlanToDraft(read);

    expect(seed.draft.weeks).toHaveLength(2);
    const slots = seed.draft.weeks.flatMap((w) => w.days);
    expect(slots).toHaveLength(14);
    // Position i still maps read.sessions[i]: position 7 is training (7%7===0).
    expect(slots[7].session).not.toBeNull();
    expect(seed.sessionIdByUid.get(slots[7].session!.uid)).toBe("cur-7");
    // Padding tail is rest.
    for (const pad of slots.slice(9)) {
      expect(pad.isRest).toBe(true);
      expect(pad.session).toBeNull();
    }
    // Locks still positional: 0..6 elapsed.
    expect(seed.lockedSlotUids).toEqual(slots.slice(0, 7).map((s) => s.uid));
  });

  it("a legacy flat plan (no rest rows, weekIndex 0) pads to a whole week", () => {
    const read = makeRead({
      sessions: [0, 2, 4].map((p, i) =>
        makeSlot(p, { weekIndex: 0, orderIndex: i }),
      ),
    });
    const seed = placedPlanToDraft(read);
    expect(seed.draft.weeks).toHaveLength(1);
    const slots = seed.draft.weeks[0].days;
    expect(slots.filter((s) => s.session)).toHaveLength(3);
    expect(slots.slice(3).every((s) => s.isRest)).toBe(true);
  });
});

describe("draftToAmendBody", () => {
  it("serializes the canonical grid through the shared draftToSessionInputs", () => {
    const seed = placedPlanToDraft(makeRead());
    const body = draftToAmendBody(seed.draft, { name: "Renamed", splitType: "Upper/Lower" }, "tok-1");

    expect(body.expectedToken).toBe("tok-1");
    expect(body.plan).toEqual({ name: "Renamed", splitType: "Upper/Lower" });
    expect(body.sessions).toEqual(draftToSessionInputs(seed.draft));
    expect(body.sessions).toHaveLength(14);
    body.sessions.forEach((s, i) => {
      expect(s.orderIndex).toBe(i);
      expect(s.weekIndex).toBe(Math.floor(i / DAYS_PER_WEEK));
      expect(s.isRest).toBe(!isTrainingPos(i));
    });
    // Per-set fidelity survives the round trip verbatim.
    expect(body.sessions[0].exercises[0].setSpecs).toEqual([
      { set_number: 1, set_type: "warmup" },
      { set_number: 2, set_type: "working", reps_min: 6, reps_max: 8 },
    ]);
    expect(body.sessions[0].exercises[0].videoUrl).toBe("https://example.com/bench");
  });

  it("omits the plan patch when none is given", () => {
    const seed = placedPlanToDraft(makeRead());
    const body = draftToAmendBody(seed.draft, undefined, "tok-1");
    expect(body.plan).toBeUndefined();
  });
});
