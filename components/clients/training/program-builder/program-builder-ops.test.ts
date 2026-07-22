import { describe, it, expect } from "vitest";
import {
  applyDraftOp,
  applyDraftOps,
  isDestructiveOp,
  type DraftOp,
} from "./program-builder-ops";
import { normalizeDraft } from "./program-builder-model";
import {
  DAYS_PER_WEEK,
  MAX_WEEKS,
  makeRestSlot,
  makeRestWeek,
  newUid,
  type ExerciseDraft,
  type ProgramDraft,
  type SessionDraft,
  type WeekDraft,
} from "./program-builder-types";
import { programDraftSnapshotSchema } from "@/lib/validations/assistant";

const LIB = { target: "library" as const };
const CLIENT = { target: "client-draft" as const };

function makeExercise(overrides: Partial<ExerciseDraft> = {}): ExerciseDraft {
  return {
    uid: newUid("ex"),
    exerciseId: "11111111-1111-4111-8111-111111111111",
    name: "Bench Press",
    setSpecs: null,
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
    videoUrl: null,
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionDraft> = {}): SessionDraft {
  return {
    uid: newUid("sess"),
    name: "Push A",
    focus: "push",
    estimatedDurationMinutes: null,
    calorieSurplusPercentage: null,
    notes: null,
    sessionType: "training",
    exercises: [makeExercise()],
    ...overrides,
  };
}

function makeDraft(weeks: WeekDraft[]): ProgramDraft {
  return normalizeDraft({
    id: "22222222-2222-4222-8222-222222222222",
    name: "Test Program",
    description: null,
    status: "saved",
    splitType: "Push/Pull",
    programDurationWeeks: null,
    defaultSurplusPercentage: null,
    weeks,
  });
}

function weekWithSession(session: SessionDraft, weekIndex = 0): WeekDraft {
  const week = makeRestWeek(weekIndex);
  week.days[0] = { ...makeRestSlot(0), isRest: false, session };
  return week;
}

describe("applyDraftOp", () => {
  it("places a session into a rest slot and skips an occupied one", () => {
    const draft = makeDraft([makeRestWeek(0)]);
    const slotUid = draft.weeks[0].days[2].uid;
    const session = makeSession();

    const placed = applyDraftOp(draft, { type: "place_session", slotUid, session }, LIB);
    expect(placed.skipped).toBeUndefined();
    expect(placed.draft.weeks[0].days[2].session?.uid).toBe(session.uid);

    const normalized = normalizeDraft(placed.draft);
    const again = applyDraftOp(
      normalized,
      { type: "place_session", slotUid, session: makeSession() },
      LIB,
    );
    expect(again.skipped).toMatch(/already has a session/);
    expect(again.draft).toBe(normalized);
  });

  it("skips ops whose target uid vanished, returning the same reference", () => {
    const draft = makeDraft([weekWithSession(makeSession())]);
    const gone = applyDraftOp(
      draft,
      { type: "update_session", sessionUid: "sess-vanished", patch: { notes: "x" } },
      LIB,
    );
    expect(gone.skipped).toMatch(/no longer exists/);
    expect(gone.draft).toBe(draft);
  });

  it("enforces the MAX_WEEKS cap and the min-one-week floor", () => {
    const full = makeDraft(
      Array.from({ length: MAX_WEEKS }, (_, i) => makeRestWeek(i)),
    );
    const capped = applyDraftOp(
      full,
      { type: "insert_week", afterWeekUid: null, week: makeRestWeek(0) },
      LIB,
    );
    expect(capped.skipped).toMatch(/cap/);

    const single = makeDraft([makeRestWeek(0)]);
    const floored = applyDraftOp(
      single,
      { type: "remove_week", weekUid: single.weeks[0].uid },
      LIB,
    );
    expect(floored.skipped).toMatch(/at least one week/);
  });

  it("rejects template-identity edits in client-draft mode but allows them in library mode", () => {
    const draft = makeDraft([weekWithSession(makeSession())]);
    const sessionUid = draft.weeks[0].days[0].session!.uid;

    const metaClient = applyDraftOp(
      draft,
      { type: "set_program_meta", patch: { name: "Renamed" } },
      CLIENT,
    );
    expect(metaClient.skipped).toMatch(/identity/);

    const sessionClient = applyDraftOp(
      draft,
      { type: "update_session", sessionUid, patch: { focus: "legs" } },
      CLIENT,
    );
    expect(sessionClient.skipped).toMatch(/identity/);

    // Non-identity client edits pass; identity edits pass in library mode.
    const surplusClient = applyDraftOp(
      draft,
      { type: "update_session", sessionUid, patch: { calorieSurplusPercentage: 12 } },
      CLIENT,
    );
    expect(surplusClient.skipped).toBeUndefined();
    const metaLib = applyDraftOp(
      draft,
      { type: "set_program_meta", patch: { name: "Renamed" } },
      LIB,
    );
    expect(metaLib.skipped).toBeUndefined();
    expect(metaLib.draft.name).toBe("Renamed");
  });

  it("moves a session (swap when occupied) and reorders exercises by index", () => {
    const a = makeSession({ name: "A" });
    const b = makeSession({ name: "B", exercises: [makeExercise(), makeExercise({ name: "Row" })] });
    const week = makeRestWeek(0);
    week.days[0] = { ...makeRestSlot(0), session: a, isRest: false };
    week.days[3] = { ...makeRestSlot(3), session: b, isRest: false };
    const draft = makeDraft([week]);
    const targetSlotUid = draft.weeks[0].days[3].uid;

    const swapped = applyDraftOp(
      draft,
      { type: "move_session", sessionUid: a.uid, targetSlotUid },
      LIB,
    );
    expect(swapped.draft.weeks[0].days[3].session?.name).toBe("A");
    expect(swapped.draft.weeks[0].days[0].session?.name).toBe("B");

    const reordered = applyDraftOp(
      draft,
      { type: "reorder_exercise", sessionUid: b.uid, exerciseUid: b.exercises[1].uid, toIndex: 0 },
      LIB,
    );
    const session = reordered.draft.weeks[0].days[3].session!;
    expect(session.exercises.map((e) => e.name)).toEqual(["Row", "Bench Press"]);
  });

  it("refuses to double-insert a week or exercise carrying an existing uid", () => {
    const session = makeSession();
    const draft = makeDraft([weekWithSession(session)]);
    const dupWeek = applyDraftOp(
      draft,
      { type: "insert_week", afterWeekUid: null, week: draft.weeks[0] },
      LIB,
    );
    expect(dupWeek.skipped).toMatch(/already/);

    const dupEx = applyDraftOp(
      draft,
      { type: "add_exercise", sessionUid: session.uid, exercise: session.exercises[0] },
      LIB,
    );
    expect(dupEx.skipped).toMatch(/already/);
  });
});

describe("applyDraftOps", () => {
  it("applies sequentially with renumbering, so later ops can address the inserted week's content", () => {
    const session = makeSession();
    const draft = makeDraft([weekWithSession(session)]);
    const newWeek = weekWithSession(makeSession({ name: "Week 2 session" }), 5);
    const insertedSessionUid = newWeek.days[0].session!.uid;

    const result = applyDraftOps(
      draft,
      [
        { type: "insert_week", afterWeekUid: draft.weeks[0].uid, week: newWeek },
        {
          type: "update_session",
          sessionUid: insertedSessionUid,
          patch: { notes: "added this turn" },
        },
      ],
      LIB,
    );
    expect(result.applied).toBe(2);
    expect(result.skipped).toEqual([]);
    // normalizeDraft resynced the payload's stale weekIndex (5 → 1).
    expect(result.draft.weeks[1].weekIndex).toBe(1);
    expect(result.draft.weeks[1].days[0].session?.notes).toBe("added this turn");
  });

  it("collects skips without aborting the rest of the turn", () => {
    const draft = makeDraft([weekWithSession(makeSession())]);
    const result = applyDraftOps(
      draft,
      [
        { type: "remove_exercise", sessionUid: "sess-gone", exerciseUid: "ex-gone" },
        { type: "set_program_meta", patch: { description: "still lands" } },
      ],
      LIB,
    );
    expect(result.applied).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({ index: 0, type: "remove_exercise" });
    expect(result.draft.description).toBe("still lands");
  });
});

describe("isDestructiveOp", () => {
  it("flags week deletes and slot clears only", () => {
    expect(isDestructiveOp({ type: "remove_week", weekUid: "w" })).toBe(true);
    expect(isDestructiveOp({ type: "clear_slot", slotUid: "s" })).toBe(true);
    const benign: DraftOp = { type: "set_program_meta", patch: { name: "x" } };
    expect(isDestructiveOp(benign)).toBe(false);
  });
});

describe("wire-schema round trip (drift belt)", () => {
  it("a maximal draft survives programDraftSnapshotSchema unchanged", () => {
    // Every ProgramDraft field populated — if a future field is added to the
    // type but not the schema, the deep-equal fails here instead of the field
    // silently stripping on every assistant request.
    const maximal = normalizeDraft({
      id: "33333333-3333-4333-8333-333333333333",
      name: "Max Program",
      description: "desc",
      status: "draft",
      splitType: "Push Pull Legs (Hypertrophy Focus)",
      programDurationWeeks: 4,
      defaultSurplusPercentage: 10,
      weeks: [
        weekWithSession(
          makeSession({
            focus: "push",
            estimatedDurationMinutes: 60,
            calorieSurplusPercentage: 12,
            notes: "session note",
            exercises: [
              makeExercise({
                setSpecs: [
                  {
                    set_number: 1,
                    set_type: "warmup",
                    reps_min: 10,
                    reps_max: 12,
                    reps_target: null,
                    load_type: "absolute",
                    load_value: 40,
                    rpe_target: null,
                    tempo: "2010",
                    rest_seconds: 60,
                    drops: null,
                  },
                  {
                    set_number: 2,
                    set_type: "drop",
                    reps_min: 8,
                    reps_max: 8,
                    reps_target: "AMRAP",
                    load_type: "pct_1rm",
                    load_value: 75,
                    rpe_target: 9,
                    tempo: null,
                    rest_seconds: 120,
                    drops: [{ weight: 60, reps: 8 }],
                  },
                ],
                sets: 1,
                repsMin: 8,
                repsMax: 8,
                repsTarget: "AMRAP",
                rpeTarget: 9,
                percentage1rm: 75,
                tempo: "2010",
                restSeconds: 120,
                supersetGroup: "A",
                isWarmup: false,
                notes: "cue: elbows in",
                videoUrl: "https://example.com/v",
              }),
            ],
          }),
        ),
        makeRestWeek(1),
      ],
    });

    const parsed = programDraftSnapshotSchema.parse(maximal);
    expect(normalizeDraft(parsed as ProgramDraft)).toEqual(maximal);
  });

  it("rejects a week that is not exactly 7 slots (uid-minting hazard)", () => {
    const draft = makeDraft([makeRestWeek(0)]);
    const short = {
      ...draft,
      weeks: [{ ...draft.weeks[0], days: draft.weeks[0].days.slice(0, DAYS_PER_WEEK - 1) }],
    };
    expect(programDraftSnapshotSchema.safeParse(short).success).toBe(false);
  });
});

// =============================================================================
// Placed-plan lock enforcement (ctx.lockedSlotUids) — every structural and
// session/exercise op refuses history with PAST_LOCKED; identity stays editable
// (IDENTITY_LOCKED is client-draft-only).
// =============================================================================

describe("applyDraftOp locked slots (placed-plan)", () => {
  // Week 0 = elapsed (all 7 slots locked, session in day 0); week 1+ = future.
  function makeLockedFixture(weekCount = 2) {
    const pastSession = makeSession({ name: "Past Day" });
    const futureSession = makeSession({ name: "Future Day" });
    const weeks = [weekWithSession(pastSession, 0)];
    for (let w = 1; w < weekCount; w++) {
      weeks.push(w === 1 ? weekWithSession(futureSession, 1) : makeRestWeek(w));
    }
    const draft = makeDraft(weeks);
    const lockedSlotUids = new Set(draft.weeks[0].days.map((d) => d.uid));
    const ctx = { target: "placed-plan" as const, lockedSlotUids };
    return { draft, ctx, lockedSlotUids };
  }

  it("place_session into a locked (past rest) slot skips", () => {
    const { draft, ctx } = makeLockedFixture();
    const out = applyDraftOp(
      draft,
      { type: "place_session", slotUid: draft.weeks[0].days[3].uid, session: makeSession() },
      ctx,
    );
    expect(out.skipped).toMatch(/locked/);
    expect(out.draft).toBe(draft);
  });

  it("clear_slot on a locked slot skips", () => {
    const { draft, ctx } = makeLockedFixture();
    const out = applyDraftOp(
      draft,
      { type: "clear_slot", slotUid: draft.weeks[0].days[0].uid },
      ctx,
    );
    expect(out.skipped).toMatch(/locked/);
  });

  it("move_session skips when the SOURCE slot is locked", () => {
    const { draft, ctx } = makeLockedFixture();
    const pastUid = draft.weeks[0].days[0].session!.uid;
    const out = applyDraftOp(
      draft,
      { type: "move_session", sessionUid: pastUid, targetSlotUid: draft.weeks[1].days[2].uid },
      ctx,
    );
    expect(out.skipped).toMatch(/locked/);
  });

  it("move_session skips when the TARGET slot is locked", () => {
    const { draft, ctx } = makeLockedFixture();
    const futureUid = draft.weeks[1].days[0].session!.uid;
    const out = applyDraftOp(
      draft,
      { type: "move_session", sessionUid: futureUid, targetSlotUid: draft.weeks[0].days[3].uid },
      ctx,
    );
    expect(out.skipped).toMatch(/locked/);
  });

  it("move_session between future slots still applies", () => {
    const { draft, ctx } = makeLockedFixture();
    const futureUid = draft.weeks[1].days[0].session!.uid;
    const out = applyDraftOp(
      draft,
      { type: "move_session", sessionUid: futureUid, targetSlotUid: draft.weeks[1].days[4].uid },
      ctx,
    );
    expect(out.skipped).toBeUndefined();
    expect(out.draft.weeks[1].days[4].session?.uid).toBe(futureUid);
  });

  it("session/exercise ops on a locked session skip; on a future session apply", () => {
    const { draft, ctx } = makeLockedFixture();
    const pastUid = draft.weeks[0].days[0].session!.uid;
    const pastExUid = draft.weeks[0].days[0].session!.exercises[0].uid;
    const futureUid = draft.weeks[1].days[0].session!.uid;

    const lockedOps: DraftOp[] = [
      { type: "update_session", sessionUid: pastUid, patch: { notes: "x" } },
      { type: "add_exercise", sessionUid: pastUid, exercise: makeExercise() },
      { type: "update_exercise", sessionUid: pastUid, exerciseUid: pastExUid, patch: { sets: 5 } },
      { type: "remove_exercise", sessionUid: pastUid, exerciseUid: pastExUid },
      { type: "reorder_exercise", sessionUid: pastUid, exerciseUid: pastExUid, toIndex: 0 },
    ];
    for (const op of lockedOps) {
      const out = applyDraftOp(draft, op, ctx);
      expect(out.skipped, op.type).toMatch(/locked/);
      expect(out.draft).toBe(draft);
    }

    const ok = applyDraftOp(
      draft,
      { type: "update_session", sessionUid: futureUid, patch: { notes: "x" } },
      ctx,
    );
    expect(ok.skipped).toBeUndefined();
  });

  it("remove_week refuses a week containing history but deletes a future week", () => {
    const { draft, ctx } = makeLockedFixture(3);
    const lockedOut = applyDraftOp(
      draft,
      { type: "remove_week", weekUid: draft.weeks[0].uid },
      ctx,
    );
    expect(lockedOut.skipped).toMatch(/locked/);

    const futureOut = applyDraftOp(
      draft,
      { type: "remove_week", weekUid: draft.weeks[2].uid },
      ctx,
    );
    expect(futureOut.skipped).toBeUndefined();
    expect(futureOut.draft.weeks).toHaveLength(2);
  });

  it("move_week refuses touching the boundary but reorders future weeks", () => {
    const { draft, ctx } = makeLockedFixture(3);
    const lockedFrom = applyDraftOp(
      draft,
      { type: "move_week", weekUid: draft.weeks[0].uid, toIndex: 2 },
      ctx,
    );
    expect(lockedFrom.skipped).toMatch(/locked/);

    const lockedTo = applyDraftOp(
      draft,
      { type: "move_week", weekUid: draft.weeks[2].uid, toIndex: 0 },
      ctx,
    );
    expect(lockedTo.skipped).toMatch(/locked/);

    const ok = applyDraftOp(
      draft,
      { type: "move_week", weekUid: draft.weeks[2].uid, toIndex: 1 },
      ctx,
    );
    expect(ok.skipped).toBeUndefined();
  });

  it("insert_week is allowed after the boundary week, refused before it", () => {
    // Weeks 0 AND 1 fully locked → boundary index 1.
    const { draft } = makeLockedFixture(3);
    const lockedSlotUids = new Set([
      ...draft.weeks[0].days.map((d) => d.uid),
      ...draft.weeks[1].days.map((d) => d.uid),
    ]);
    const ctx = { target: "placed-plan" as const, lockedSlotUids };

    const before = applyDraftOp(
      draft,
      { type: "insert_week", afterWeekUid: draft.weeks[0].uid, week: makeRestWeek(0) },
      ctx,
    );
    expect(before.skipped).toMatch(/locked/);

    const after = applyDraftOp(
      draft,
      { type: "insert_week", afterWeekUid: draft.weeks[1].uid, week: makeRestWeek(0) },
      ctx,
    );
    expect(after.skipped).toBeUndefined();

    const append = applyDraftOp(
      draft,
      { type: "insert_week", afterWeekUid: null, week: makeRestWeek(0) },
      ctx,
    );
    expect(append.skipped).toBeUndefined();
  });

  it("identity stays editable on placed-plan (IDENTITY_LOCKED is client-draft-only)", () => {
    const { draft, ctx } = makeLockedFixture();
    const meta = applyDraftOp(
      draft,
      { type: "set_program_meta", patch: { name: "Renamed", splitType: "Upper/Lower" } },
      ctx,
    );
    expect(meta.skipped).toBeUndefined();
    expect(meta.draft.name).toBe("Renamed");

    const futureUid = draft.weeks[1].days[0].session!.uid;
    const rename = applyDraftOp(
      draft,
      { type: "update_session", sessionUid: futureUid, patch: { name: "Renamed Day" } },
      ctx,
    );
    expect(rename.skipped).toBeUndefined();
  });

  it("without lockedSlotUids the placed-plan target behaves like library", () => {
    const { draft } = makeLockedFixture();
    const out = applyDraftOp(
      draft,
      { type: "clear_slot", slotUid: draft.weeks[0].days[0].uid },
      { target: "placed-plan" },
    );
    expect(out.skipped).toBeUndefined();
  });
});
