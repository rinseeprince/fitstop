import { describe, it, expect } from "vitest";
import {
  applyDraftOp,
  applyDraftOps,
  isDestructiveOp,
  type DraftOp,
} from "./program-builder-ops";
import { normalizeDraft } from "./program-builder-model";
import { LIMIT_LOCKED, PAST_LOCKED } from "./program-builder-lock-model";
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
    prescribedFields: null,
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
                prescribedFields: null,
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
// The plan editor (ctx.editableDays): every op asks the day rule of the draft
// as it stands — a history day refuses with PAST_LOCKED, a greyed day with
// LIMIT_LOCKED — and identity stays editable (IDENTITY_LOCKED is
// client-draft-only).
// =============================================================================

describe("applyDraftOp on the plan editor's days (placed-plan)", () => {
  // Week 0 is positions 0-6 with a session on its first day; week 1 starts on
  // position 7 with a session on its first day; later weeks are rest.
  function makeFixture(weekCount = 2) {
    const weeks = [weekWithSession(makeSession({ name: "Past Day" }), 0)];
    for (let w = 1; w < weekCount; w++) {
      weeks.push(
        w === 1 ? weekWithSession(makeSession({ name: "Future Day" }), 1) : makeRestWeek(w),
      );
    }
    const draft = makeDraft(weeks);
    return {
      draft,
      past: draft.weeks[0].days[0].session!,
      future: draft.weeks[1].days[0].session!,
    };
  }

  // The first editable day and the plan's last day, as positions.
  const placed = (from: number, through: number | null = null) => ({
    target: "placed-plan" as const,
    editableDays: { from, through },
  });

  it("place_session and clear_slot on a history day skip with PAST_LOCKED", () => {
    const { draft } = makeFixture();
    const placedOut = applyDraftOp(
      draft,
      { type: "place_session", slotUid: draft.weeks[0].days[3].uid, session: makeSession() },
      placed(7),
    );
    expect(placedOut.skipped).toBe(PAST_LOCKED);
    expect(placedOut.draft).toBe(draft);

    const cleared = applyDraftOp(
      draft,
      { type: "clear_slot", slotUid: draft.weeks[0].days[0].uid },
      placed(7),
    );
    expect(cleared.skipped).toBe(PAST_LOCKED);
    expect(cleared.draft).toBe(draft);
  });

  it("place_session and clear_slot on editable days apply", () => {
    const { draft } = makeFixture();
    const session = makeSession();
    const placedOut = applyDraftOp(
      draft,
      { type: "place_session", slotUid: draft.weeks[1].days[3].uid, session },
      placed(7),
    );
    expect(placedOut.skipped).toBeUndefined();
    expect(placedOut.draft.weeks[1].days[3].session?.uid).toBe(session.uid);

    const cleared = applyDraftOp(
      draft,
      { type: "clear_slot", slotUid: draft.weeks[1].days[0].uid },
      placed(7),
    );
    expect(cleared.skipped).toBeUndefined();
    expect(cleared.draft.weeks[1].days[0].session).toBeNull();
  });

  it("move_session refuses a history source or target with PAST_LOCKED, and moves between editable days", () => {
    const { draft, past, future } = makeFixture();
    const fromHistory = applyDraftOp(
      draft,
      { type: "move_session", sessionUid: past.uid, targetSlotUid: draft.weeks[1].days[2].uid },
      placed(7),
    );
    expect(fromHistory.skipped).toBe(PAST_LOCKED);

    const ontoHistory = applyDraftOp(
      draft,
      { type: "move_session", sessionUid: future.uid, targetSlotUid: draft.weeks[0].days[3].uid },
      placed(7),
    );
    expect(ontoHistory.skipped).toBe(PAST_LOCKED);

    const moved = applyDraftOp(
      draft,
      { type: "move_session", sessionUid: future.uid, targetSlotUid: draft.weeks[1].days[4].uid },
      placed(7),
    );
    expect(moved.skipped).toBeUndefined();
    expect(moved.draft.weeks[1].days[4].session?.uid).toBe(future.uid);
  });

  it("session and exercise ops on a history session skip with PAST_LOCKED; on an editable one they apply", () => {
    const { draft, past, future } = makeFixture();
    const opsOn = (session: SessionDraft): DraftOp[] => {
      const exerciseUid = session.exercises[0].uid;
      return [
        { type: "update_session", sessionUid: session.uid, patch: { notes: "x" } },
        { type: "add_exercise", sessionUid: session.uid, exercise: makeExercise() },
        { type: "update_exercise", sessionUid: session.uid, exerciseUid, patch: { sets: 5 } },
        { type: "remove_exercise", sessionUid: session.uid, exerciseUid },
        { type: "reorder_exercise", sessionUid: session.uid, exerciseUid, toIndex: 0 },
      ];
    };
    for (const op of opsOn(past)) {
      const out = applyDraftOp(draft, op, placed(7));
      expect(out.skipped, op.type).toBe(PAST_LOCKED);
      expect(out.draft, op.type).toBe(draft);
    }
    for (const op of opsOn(future)) {
      expect(applyDraftOp(draft, op, placed(7)).skipped, op.type).toBeUndefined();
    }
  });

  it("a greyed day refuses a session with LIMIT_LOCKED, ahead of its other failures", () => {
    const { draft, future } = makeFixture();
    // The plan reaches position 10: days 11-13 are greyed.
    const ctx = placed(7, 10);
    const greyedSlot = draft.weeks[1].days[5].uid;
    expect(
      applyDraftOp(draft, { type: "place_session", slotUid: greyedSlot, session: makeSession() }, ctx)
        .skipped,
    ).toBe(LIMIT_LOCKED);
    expect(
      applyDraftOp(
        draft,
        { type: "move_session", sessionUid: future.uid, targetSlotUid: greyedSlot },
        ctx,
      ).skipped,
    ).toBe(LIMIT_LOCKED);
    // A rest day would skip as already rest; the greyed day says why first.
    expect(applyDraftOp(draft, { type: "clear_slot", slotUid: greyedSlot }, ctx).skipped).toBe(
      LIMIT_LOCKED,
    );
    // The plan's last day still takes a session.
    const lastDay = applyDraftOp(
      draft,
      { type: "place_session", slotUid: draft.weeks[1].days[3].uid, session: makeSession() },
      ctx,
    );
    expect(lastDay.skipped).toBeUndefined();
  });

  it("remove_week refuses a week holding a history day with PAST_LOCKED, and removes a later one", () => {
    const { draft } = makeFixture(3);
    // from 9: week 1 holds history days 7-8.
    for (const week of [draft.weeks[0], draft.weeks[1]]) {
      const out = applyDraftOp(draft, { type: "remove_week", weekUid: week.uid }, placed(9));
      expect(out.skipped).toBe(PAST_LOCKED);
      expect(out.draft).toBe(draft);
    }
    const removed = applyDraftOp(
      draft,
      { type: "remove_week", weekUid: draft.weeks[2].uid },
      placed(9),
    );
    expect(removed.skipped).toBeUndefined();
    expect(removed.draft.weeks).toHaveLength(2);
  });

  it("insert_week refuses a week before the last history week with PAST_LOCKED", () => {
    const { draft } = makeFixture(3);
    // from 14: weeks 0 and 1 are history.
    const ctx = placed(14);
    const before = applyDraftOp(
      draft,
      { type: "insert_week", afterWeekUid: draft.weeks[0].uid, week: makeRestWeek(0) },
      ctx,
    );
    expect(before.skipped).toBe(PAST_LOCKED);
    expect(before.draft).toBe(draft);

    const after = applyDraftOp(
      draft,
      { type: "insert_week", afterWeekUid: draft.weeks[1].uid, week: makeRestWeek(0) },
      ctx,
    );
    expect(after.skipped).toBeUndefined();
    expect(after.draft.weeks).toHaveLength(4);

    const append = applyDraftOp(
      draft,
      { type: "insert_week", afterWeekUid: null, week: makeRestWeek(0) },
      ctx,
    );
    expect(append.skipped).toBeUndefined();
  });

  it("insert_week refuses with LIMIT_LOCKED when a session would land past the plan's last day", () => {
    const { draft } = makeFixture(3);
    // After week 0, Future Day would move from 7 to 14, past the plan's last day.
    const pushes = applyDraftOp(
      draft,
      { type: "insert_week", afterWeekUid: draft.weeks[0].uid, week: makeRestWeek(0) },
      placed(7, 13),
    );
    expect(pushes.skipped).toBe(LIMIT_LOCKED);
    expect(pushes.draft).toBe(draft);

    // Appended, the week starts on 21 and its own session sits on 24.
    const lateSession = () => {
      const week = makeRestWeek(3);
      week.days[3] = { ...makeRestSlot(3), isRest: false, session: makeSession() };
      return week;
    };
    const append = applyDraftOp(
      draft,
      { type: "insert_week", afterWeekUid: null, week: lateSession() },
      placed(7, 22),
    );
    expect(append.skipped).toBe(LIMIT_LOCKED);

    // A plan that reaches 24 takes the same append.
    const reaches = applyDraftOp(
      draft,
      { type: "insert_week", afterWeekUid: null, week: lateSession() },
      placed(7, 24),
    );
    expect(reaches.skipped).toBeUndefined();
    expect(reaches.draft.weeks).toHaveLength(4);
  });

  it("insert_week refuses with LIMIT_LOCKED a week that would start past the plan's last day, as Add week does", () => {
    const { draft } = makeFixture(3);
    // Three weeks end on 20: an appended rest week would start on 21.
    const pastLimit = applyDraftOp(
      draft,
      { type: "insert_week", afterWeekUid: null, week: makeRestWeek(3) },
      placed(7, 20),
    );
    expect(pastLimit.skipped).toBe(LIMIT_LOCKED);
    expect(pastLimit.draft).toBe(draft);

    const onLastDay = applyDraftOp(
      draft,
      { type: "insert_week", afterWeekUid: null, week: makeRestWeek(3) },
      placed(7, 21),
    );
    expect(onLastDay.skipped).toBeUndefined();

    // Mid-grid the start is where the week lands: after week 1 it starts on 14
    // (week 2 holds no session to push).
    const afterWeek1 = (through: number) =>
      applyDraftOp(
        draft,
        { type: "insert_week", afterWeekUid: draft.weeks[1].uid, week: makeRestWeek(0) },
        placed(7, through),
      );
    expect(afterWeek1(13).skipped).toBe(LIMIT_LOCKED);
    expect(afterWeek1(14).skipped).toBeUndefined();
  });

  it("move_week refuses the history boundary with PAST_LOCKED and the limit with LIMIT_LOCKED", () => {
    const { draft } = makeFixture(3);
    // from 7: week 0 is the last history week.
    const fromHistory = applyDraftOp(
      draft,
      { type: "move_week", weekUid: draft.weeks[0].uid, toIndex: 2 },
      placed(7),
    );
    expect(fromHistory.skipped).toBe(PAST_LOCKED);
    const ontoHistory = applyDraftOp(
      draft,
      { type: "move_week", weekUid: draft.weeks[2].uid, toIndex: 0 },
      placed(7),
    );
    expect(ontoHistory.skipped).toBe(PAST_LOCKED);

    // The plan reaches 13: moving Future Day's week last lands it on 14.
    const pastLimit = applyDraftOp(
      draft,
      { type: "move_week", weekUid: draft.weeks[1].uid, toIndex: 2 },
      placed(7, 13),
    );
    expect(pastLimit.skipped).toBe(LIMIT_LOCKED);

    const moved = applyDraftOp(
      draft,
      { type: "move_week", weekUid: draft.weeks[1].uid, toIndex: 2 },
      placed(7),
    );
    expect(moved.skipped).toBeUndefined();
    expect(moved.draft.weeks[2].uid).toBe(draft.weeks[1].uid);
  });

  it("applyDraftOps asks the rule of the grid each op leaves", () => {
    const { draft } = makeFixture(3);
    // The plan reaches position 20: all three weeks are inside it.
    const lastWeekDay = draft.weeks[2].days[0].uid;
    const result = applyDraftOps(
      draft,
      [
        { type: "insert_week", afterWeekUid: draft.weeks[1].uid, week: makeRestWeek(0) },
        // Its week now starts on 21, past the plan's last day.
        { type: "place_session", slotUid: lastWeekDay, session: makeSession() },
      ],
      placed(7, 20),
    );
    expect(result.applied).toBe(1);
    expect(result.skipped).toEqual([{ index: 1, type: "place_session", reason: LIMIT_LOCKED }]);
  });

  it("identity stays editable (IDENTITY_LOCKED is client-draft-only)", () => {
    const { draft, future } = makeFixture();
    const meta = applyDraftOp(
      draft,
      { type: "set_program_meta", patch: { name: "Renamed", splitType: "Upper/Lower" } },
      placed(7),
    );
    expect(meta.skipped).toBeUndefined();
    expect(meta.draft.name).toBe("Renamed");

    const rename = applyDraftOp(
      draft,
      { type: "update_session", sessionUid: future.uid, patch: { name: "Renamed Day" } },
      placed(7),
    );
    expect(rename.skipped).toBeUndefined();
  });

  it("without editableDays the placed-plan target behaves like library", () => {
    const { draft } = makeFixture();
    const out = applyDraftOp(
      draft,
      { type: "clear_slot", slotUid: draft.weeks[0].days[0].uid },
      { target: "placed-plan" },
    );
    expect(out.skipped).toBeUndefined();
  });
});
