import { describe, it, expect } from "vitest";
import { PRESCRIBED_FIELDS } from "@/utils/prescribed-fields";
import {
  applyDraftOp,
  applyDraftOps,
  isDestructiveOp,
  type DraftOp,
} from "./program-builder-ops";
import { normalizeDraft } from "./program-builder-model";
import type { ExerciseDestination } from "./program-builder-groups";
import { LIMIT_LOCKED, PAST_LOCKED } from "./program-builder-lock-model";
import { MAX_SESSIONS_PER_DAY } from "@/lib/training-constants";
import {
  DAYS_PER_WEEK,
  MAX_WEEKS,
  makeRestSlot,
  makeRestWeek,
  newUid,
  type ExerciseDraft,
  type ExerciseGroupDraft,
  type ProgramDraft,
  type SessionDraft,
  type WeekDraft,
} from "./program-builder-types";
import { draftOpSchema, programDraftSnapshotSchema } from "@/lib/validations/assistant";
import {
  STRAIGHT_SETS,
  groupSettingsOf,
  sessionExercises,
  type GroupSettings,
} from "@/utils/exercise-groups";

const LIB = { target: "library" as const };
const CLIENT = { target: "client-draft" as const };

// A superset/circuit: three rounds, 90s between rounds.
const CIRCUIT: GroupSettings = {
  ...STRAIGHT_SETS,
  format: "circuit",
  rounds: 3,
  restBetweenRoundsSeconds: 90,
  notes: "A",
};

// Every setting a group carries, each one set.
const EVERY_SETTING: GroupSettings = {
  format: "emom",
  rounds: 10,
  timeCapSeconds: 600,
  intervalSeconds: 60,
  restBetweenExercisesSeconds: 15,
  restBetweenRoundsSeconds: 120,
  notes: "On the minute",
};

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
    isWarmup: false,
    notes: null,
    videoUrl: null,
    prescribedFields: ["set_type", "reps", "load", "rpe", "rest"],
    ...overrides,
  };
}

// A lone exercise: a straight-sets group of one.
function lone(exercise: ExerciseDraft): ExerciseGroupDraft {
  return { uid: newUid("grp"), ...STRAIGHT_SETS, exercises: [exercise] };
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
    groups: [lone(makeExercise())],
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

// A week whose first day holds `sessions`, in order; the other six are rest.
function weekWithSession(session: SessionDraft, weekIndex = 0, ...more: SessionDraft[]): WeekDraft {
  const week = makeRestWeek(weekIndex);
  week.days[0] = { ...makeRestSlot(0), isRest: false, sessions: [session, ...more] };
  return week;
}

describe("applyDraftOp", () => {
  it("places a session into a rest slot, then another after it; a replayed place skips", () => {
    const draft = makeDraft([makeRestWeek(0)]);
    const slotUid = draft.weeks[0].days[2].uid;
    const session = makeSession();

    const placed = applyDraftOp(draft, { type: "place_session", slotUid, session }, LIB);
    expect(placed.skipped).toBeUndefined();
    expect(placed.draft.weeks[0].days[2].sessions.map((s) => s.uid)).toEqual([session.uid]);

    const normalized = normalizeDraft(placed.draft);
    const second = makeSession();
    const again = applyDraftOp(normalized, { type: "place_session", slotUid, session: second }, LIB);
    expect(again.skipped).toBeUndefined();
    expect(again.draft.weeks[0].days[2].sessions.map((s) => s.uid)).toEqual([session.uid, second.uid]);

    // The same op replayed carries a uid the day already holds: it skips.
    const replayed = applyDraftOp(again.draft, { type: "place_session", slotUid, session: second }, LIB);
    expect(replayed.skipped).toBe("Session already added");
    expect(replayed.draft).toBe(again.draft);
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
    const sessionUid = draft.weeks[0].days[0].sessions[0].uid;

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

  it("moves a session (it joins an occupied day, last) and moves an exercise to a place", () => {
    const a = makeSession({ name: "A" });
    const b = makeSession({
      name: "B",
      groups: [lone(makeExercise()), lone(makeExercise({ name: "Row" }))],
    });
    const week = makeRestWeek(0);
    week.days[0] = { ...makeRestSlot(0), sessions: [a], isRest: false };
    week.days[3] = { ...makeRestSlot(3), sessions: [b], isRest: false };
    const draft = makeDraft([week]);
    const targetSlotUid = draft.weeks[0].days[3].uid;

    const joined = applyDraftOp(
      draft,
      { type: "move_session", sessionUid: a.uid, targetSlotUid },
      LIB,
    );
    expect(joined.draft.weeks[0].days[3].sessions.map((s) => s.name)).toEqual(["B", "A"]);
    expect(joined.draft.weeks[0].days[0].sessions).toEqual([]);

    const reordered = applyDraftOp(
      draft,
      {
        type: "move_exercise",
        sessionUid: b.uid,
        exerciseUid: sessionExercises(b)[1].uid,
        to: { kind: "session", index: 0 },
        groupUid: newUid("grp"),
      },
      LIB,
    );
    const [session] = reordered.draft.weeks[0].days[3].sessions;
    expect(sessionExercises(session).map((e) => e.name)).toEqual(["Row", "Bench Press"]);
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
      { type: "add_exercise", sessionUid: session.uid, group: session.groups[0] },
      LIB,
    );
    expect(dupEx.skipped).toMatch(/already/);
  });
});

describe("applyDraftOp on a day holding several sessions", () => {
  // Day 1 holds AM then PM, day 4 holds Solo, and the other days are rest.
  function fixture() {
    const week = weekWithSession(makeSession({ name: "AM" }), 0, makeSession({ name: "PM" }));
    week.days[3] = { ...makeRestSlot(3), isRest: false, sessions: [makeSession({ name: "Solo" })] };
    const draft = makeDraft([week]);
    const [dayOne, , , dayFour, , daySix] = draft.weeks[0].days;
    const [am, pm] = dayOne.sessions;
    return { draft, am, pm, solo: dayFour.sessions[0], dayOne, dayFour, daySix };
  }
  const namesOn = (draft: ProgramDraft, d: number) => draft.weeks[0].days[d].sessions.map((s) => s.name);

  it("remove_session takes one of two sessions off the day, and the day keeps the other", () => {
    const { draft, am } = fixture();
    const result = applyDraftOps(draft, [{ type: "remove_session", sessionUid: am.uid }], LIB);
    expect(result.skipped).toEqual([]);
    expect(namesOn(result.draft, 0)).toEqual(["PM"]);
    expect(result.draft.weeks[0].days[0].isRest).toBe(false);
    expect(namesOn(result.draft, 3)).toEqual(["Solo"]);
  });

  it("remove_session of a day's last session leaves a rest day; a vanished session skips", () => {
    const { draft, solo } = fixture();
    const result = applyDraftOps(draft, [{ type: "remove_session", sessionUid: solo.uid }], LIB);
    expect(result.draft.weeks[0].days[3]).toMatchObject({ isRest: true, sessions: [] });

    const gone = applyDraftOp(result.draft, { type: "remove_session", sessionUid: solo.uid }, LIB);
    expect(gone.skipped).toBe("That session no longer exists");
    expect(gone.draft).toBe(result.draft);
  });

  it("clear_slot empties the whole day, both sessions", () => {
    const { draft, dayOne } = fixture();
    const result = applyDraftOps(draft, [{ type: "clear_slot", slotUid: dayOne.uid }], LIB);
    expect(result.skipped).toEqual([]);
    expect(result.draft.weeks[0].days[0]).toMatchObject({ isRest: true, sessions: [] });
  });

  it("place_session joins a day holding one session or two, last; a full day skips with its reason", () => {
    const { draft, dayOne, dayFour } = fixture();
    const onTwo = applyDraftOp(draft, { type: "place_session", slotUid: dayOne.uid, session: makeSession({ name: "Late" }) }, LIB);
    expect(namesOn(onTwo.draft, 0)).toEqual(["AM", "PM", "Late"]);
    const onOne = applyDraftOp(draft, { type: "place_session", slotUid: dayFour.uid, session: makeSession({ name: "Late" }) }, LIB);
    expect(namesOn(onOne.draft, 3)).toEqual(["Solo", "Late"]);

    const full = makeDraft([
      weekWithSession(makeSession(), 0, ...Array.from({ length: MAX_SESSIONS_PER_DAY - 1 }, () => makeSession())),
    ]);
    const refused = applyDraftOp(full, { type: "place_session", slotUid: full.weeks[0].days[0].uid, session: makeSession() }, LIB);
    expect(refused.skipped).toBe(`A day holds at most ${MAX_SESSIONS_PER_DAY} sessions`);
    expect(refused.draft).toBe(full);
  });

  it("move_session takes one session of two onto a rest day; the day it left keeps the other", () => {
    const { draft, pm, daySix } = fixture();
    const result = applyDraftOps(
      draft,
      [{ type: "move_session", sessionUid: pm.uid, targetSlotUid: daySix.uid }],
      LIB,
    );
    expect(result.skipped).toEqual([]);
    expect(namesOn(result.draft, 5)).toEqual(["PM"]);
    expect(namesOn(result.draft, 0)).toEqual(["AM"]);
  });

  it("move_session joins a day holding two, last, and a session that shares its day joins a day holding one", () => {
    const { draft, am, solo, dayOne, dayFour } = fixture();
    const ontoTwo = applyDraftOps(
      draft,
      [{ type: "move_session", sessionUid: solo.uid, targetSlotUid: dayOne.uid }],
      LIB,
    );
    expect(ontoTwo.skipped).toEqual([]);
    expect(namesOn(ontoTwo.draft, 0)).toEqual(["AM", "PM", "Solo"]);
    expect(ontoTwo.draft.weeks[0].days[3]).toMatchObject({ isRest: true, sessions: [] });

    const shared = applyDraftOps(
      draft,
      [{ type: "move_session", sessionUid: am.uid, targetSlotUid: dayFour.uid }],
      LIB,
    );
    expect(namesOn(shared.draft, 3)).toEqual(["Solo", "AM"]);
    expect(namesOn(shared.draft, 0)).toEqual(["PM"]);

    // Onto its own day holding two: nothing changes, nothing skips.
    const ownDay = applyDraftOp(
      draft,
      { type: "move_session", sessionUid: am.uid, targetSlotUid: dayOne.uid },
      LIB,
    );
    expect(ownDay).toEqual({ draft });
  });

  it("reorder_session changes a session's place in its day; a vanished session skips", () => {
    const { draft, am, pm } = fixture();
    const result = applyDraftOps(draft, [{ type: "reorder_session", sessionUid: pm.uid, toIndex: 0 }], LIB);
    expect(result.skipped).toEqual([]);
    expect(namesOn(result.draft, 0)).toEqual(["PM", "AM"]);

    // Already there: the same draft, nothing skipped.
    expect(applyDraftOp(draft, { type: "reorder_session", sessionUid: am.uid, toIndex: 0 }, LIB)).toEqual({ draft });
    const gone = applyDraftOp(draft, { type: "reorder_session", sessionUid: "sess-gone", toIndex: 0 }, LIB);
    expect(gone.skipped).toBe("That session no longer exists");
  });

  it("on a history day reorder_session and a join onto it skip with PAST_LOCKED", () => {
    const { draft, pm, solo, dayOne } = fixture();
    const placed = { target: "placed-plan" as const, editableDays: { from: 3, through: null } };
    const reorder = applyDraftOp(draft, { type: "reorder_session", sessionUid: pm.uid, toIndex: 0 }, placed);
    expect(reorder.skipped).toBe(PAST_LOCKED);
    const join = applyDraftOp(draft, { type: "move_session", sessionUid: solo.uid, targetSlotUid: dayOne.uid }, placed);
    expect(join.skipped).toBe(PAST_LOCKED);
    const place = applyDraftOp(draft, { type: "place_session", slotUid: dayOne.uid, session: makeSession() }, placed);
    expect(place.skipped).toBe(PAST_LOCKED);
  });

  it("remove_session on a history day skips with PAST_LOCKED, the day's second session too", () => {
    const { draft, am, pm, solo } = fixture();
    // History before position 3: day 1 is history, day 4 is editable.
    const placed = { target: "placed-plan" as const, editableDays: { from: 3, through: null } };
    for (const session of [am, pm]) {
      const out = applyDraftOp(draft, { type: "remove_session", sessionUid: session.uid }, placed);
      expect(out.skipped).toBe(PAST_LOCKED);
      expect(out.draft).toBe(draft);
    }
    expect(applyDraftOp(draft, { type: "remove_session", sessionUid: solo.uid }, placed).skipped).toBeUndefined();
  });

  it("a uid held by a day's second session counts as present: a replayed add skips", () => {
    const { draft, am, pm } = fixture();
    const out = applyDraftOp(
      draft,
      { type: "add_exercise", sessionUid: am.uid, group: pm.groups[0] },
      LIB,
    );
    expect(out.skipped).toBe("Exercise already added");
    expect(out.draft).toBe(draft);
  });
});

describe("applyDraftOps", () => {
  it("applies sequentially with renumbering, so later ops can address the inserted week's content", () => {
    const session = makeSession();
    const draft = makeDraft([weekWithSession(session)]);
    const newWeek = weekWithSession(makeSession({ name: "Week 2 session" }), 5);
    const insertedSessionUid = newWeek.days[0].sessions[0].uid;

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
    expect(result.draft.weeks[1].days[0].sessions[0].notes).toBe("added this turn");
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
  it("flags week deletes, slot clears and session removals only", () => {
    expect(isDestructiveOp({ type: "remove_week", weekUid: "w" })).toBe(true);
    expect(isDestructiveOp({ type: "clear_slot", slotUid: "s" })).toBe(true);
    expect(isDestructiveOp({ type: "remove_session", sessionUid: "sess" })).toBe(true);
    expect(isDestructiveOp({ type: "remove_exercise", sessionUid: "sess", exerciseUid: "ex" })).toBe(false);
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
            groups: [
              {
                uid: newUid("grp"),
                ...EVERY_SETTING,
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
                        load_min: 40, load_max: 40,
                        rpe_min: null,
                        rpe_max: null,
                        tempo: "2-0-1-0",
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
                        load_min: 70,
                        load_max: 75,
                        rpe_min: 8,
                        rpe_max: 9,
                        rir_min: 1,
                        rir_max: 2,
                        distance_meters_min: 400,
                        distance_meters_max: 800,
                        duration_seconds_min: 60,
                        duration_seconds_max: 90.5,
                        pace_seconds_per_km_min: 270,
                        pace_seconds_per_km_max: 285,
                        split_seconds_per_500m_min: 105,
                        split_seconds_per_500m_max: 110,
                        calories_min: 20,
                        calories_max: 25,
                        cadence_min: 85,
                        cadence_max: 95,
                        stroke_rate_min: 26,
                        stroke_rate_max: 30,
                        resistance_min: 5,
                        resistance_max: 6,
                        heart_rate_zone_min: 2,
                        heart_rate_zone_max: 3,
                        heart_rate_min: 140,
                        heart_rate_max: 155,
                        power_min: 200,
                        power_max: 220,
                        ftp_percent_min: 75,
                        ftp_percent_max: 80,
                        tempo: "3-1-X-0",
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
                    tempo: "2-0-1-0",
                    restSeconds: 120,
                    isWarmup: false,
                    notes: "cue: elbows in",
                    videoUrl: "https://example.com/v",
                    prescribedFields: [...PRESCRIBED_FIELDS],
                  }),
                ],
              },
            ],
          }),
        ),
        makeRestWeek(1),
      ],
    });

    const parsed = programDraftSnapshotSchema.parse(maximal);
    expect(normalizeDraft(parsed as ProgramDraft)).toEqual(maximal);
  });

  it("keeps a day's sessions and their order; refuses a day holding more than twenty", () => {
    const am = makeSession({ name: "AM run" });
    const pm = makeSession({ name: "PM lift", calorieSurplusPercentage: 10 });
    const draft = makeDraft([weekWithSession(am, 0, pm)]);
    const parsed = programDraftSnapshotSchema.parse(draft);
    expect(normalizeDraft(parsed as ProgramDraft)).toEqual(draft);
    expect(parsed.weeks[0].days[0].sessions.map((s) => s.name)).toEqual(["AM run", "PM lift"]);

    const crowded = makeDraft([
      weekWithSession(makeSession(), 0, ...Array.from({ length: 20 }, () => makeSession())),
    ]);
    expect(programDraftSnapshotSchema.safeParse(crowded).success).toBe(false);
  });

  it("accepts a remove_session op and nothing without its session", () => {
    const op: DraftOp = { type: "remove_session", sessionUid: "sess-1", label: "W1 D1: removed \"AM run\"" };
    expect(draftOpSchema.parse(op)).toEqual(op);
    expect(draftOpSchema.safeParse({ type: "remove_session" }).success).toBe(false);
  });

  it("accepts a reorder_session op with a place inside a day, and nothing past a full day", () => {
    const op: DraftOp = { type: "reorder_session", sessionUid: "sess-1", toIndex: 1, label: "W1 D1: \"PM\" to session 2" };
    expect(draftOpSchema.parse(op)).toEqual(op);
    expect(draftOpSchema.safeParse({ ...op, toIndex: MAX_SESSIONS_PER_DAY - 1 }).success).toBe(true);
    expect(draftOpSchema.safeParse({ ...op, toIndex: MAX_SESSIONS_PER_DAY }).success).toBe(false);
    expect(draftOpSchema.safeParse({ ...op, toIndex: -1 }).success).toBe(false);
  });

  it("rejects a week that is not exactly 7 slots (uid-minting hazard)", () => {
    const draft = makeDraft([makeRestWeek(0)]);
    const short = {
      ...draft,
      weeks: [{ ...draft.weeks[0], days: draft.weeks[0].days.slice(0, DAYS_PER_WEEK - 1) }],
    };
    expect(programDraftSnapshotSchema.safeParse(short).success).toBe(false);
  });

  it("keeps a circuit group's uid, settings and exercises (nothing stripped)", () => {
    const circuit: ExerciseGroupDraft = {
      uid: newUid("grp"),
      ...CIRCUIT,
      exercises: [makeExercise({ name: "Squat" }), makeExercise({ name: "Row" })],
    };
    const draft = makeDraft([
      weekWithSession(makeSession({ groups: [circuit, lone(makeExercise())] })),
    ]);

    const parsed = programDraftSnapshotSchema.parse(draft);
    const [parsedCircuit] = parsed.weeks[0].days[0].sessions[0].groups;
    expect(parsedCircuit).toEqual(circuit);
    expect(groupSettingsOf(parsedCircuit)).toEqual(CIRCUIT);
  });
});

// =============================================================================
// Groups through the ops: an added exercise arrives as a whole group, exercise
// ops address exercises wherever their group, and no op loses a setting.
// =============================================================================

describe("add_exercise appends a whole group", () => {
  it("appends the op's fully-materialized group unchanged; a replayed duplicate skips", () => {
    const session = makeSession();
    const draft = makeDraft([weekWithSession(session)]);
    const group: ExerciseGroupDraft = {
      uid: newUid("grp"),
      ...CIRCUIT,
      exercises: [makeExercise({ name: "Row" }), makeExercise({ name: "Dip" })],
    };
    const op: DraftOp = { type: "add_exercise", sessionUid: session.uid, group };

    const result = applyDraftOps(draft, [op], LIB);
    expect(result.applied).toBe(1);
    expect(result.skipped).toEqual([]);
    const groups = result.draft.weeks[0].days[0].sessions[0].groups;
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual(draft.weeks[0].days[0].sessions[0].groups[0]);
    expect(groups[1]).toEqual(group);

    // The same op replayed.
    const replayed = applyDraftOp(result.draft, op, LIB);
    expect(replayed.skipped).toBe("Exercise already added");
    expect(replayed.draft).toBe(result.draft);

    // The same group uid, holding a fresh exercise.
    const sameGroupUid = applyDraftOp(
      result.draft,
      {
        type: "add_exercise",
        sessionUid: session.uid,
        group: { ...group, exercises: [makeExercise({ name: "Row" })] },
      },
      LIB,
    );
    expect(sameGroupUid.skipped).toBe("Exercise already added");
    expect(sameGroupUid.draft).toBe(result.draft);

    // A fresh group uid, holding an exercise uid the draft already has.
    const sameExerciseUid = applyDraftOp(
      result.draft,
      { type: "add_exercise", sessionUid: session.uid, group: lone(group.exercises[1]) },
      LIB,
    );
    expect(sameExerciseUid.skipped).toBe("Exercise already added");
    expect(sameExerciseUid.draft).toBe(result.draft);
  });
});

describe("exercise ops on a session holding a circuit", () => {
  // The session's groups: a circuit of Squat then Row, then a lone Bench Press.
  function makeFixture() {
    const squat = makeExercise({ name: "Squat" });
    const row = makeExercise({ name: "Row" });
    const bench = makeExercise({ name: "Bench Press" });
    const circuit: ExerciseGroupDraft = { uid: newUid("grp"), ...CIRCUIT, exercises: [squat, row] };
    const benchGroup = lone(bench);
    const session = makeSession({ groups: [circuit, benchGroup] });
    const draft = makeDraft([weekWithSession(session)]);
    return { draft, sessionUid: session.uid, circuit, benchGroup, squat, row, bench };
  }

  const groupsOf = (draft: ProgramDraft) => draft.weeks[0].days[0].sessions[0].groups;
  const namesOf = (draft: ProgramDraft) =>
    sessionExercises(draft.weeks[0].days[0].sessions[0]).map((e) => e.name);

  // The circuit is still ONE group, with its uid, its settings and both its
  // exercises.
  function expectCircuitWhole(draft: ProgramDraft, circuit: ExerciseGroupDraft) {
    const circuitUids = circuit.exercises.map((e) => e.uid);
    const holding = groupsOf(draft).filter((g) =>
      g.exercises.some((e) => circuitUids.includes(e.uid)),
    );
    expect(holding).toHaveLength(1);
    expect(holding[0].uid).toBe(circuit.uid);
    expect(groupSettingsOf(holding[0])).toEqual(CIRCUIT);
    expect(holding[0].exercises.map((e) => e.uid).sort()).toEqual([...circuitUids].sort());
  }

  it("update_exercise keeps the circuit's uid and settings, in or out of it", () => {
    const { draft, sessionUid, circuit, benchGroup, row, bench } = makeFixture();

    const inCircuit = applyDraftOps(
      draft,
      [{ type: "update_exercise", sessionUid, exerciseUid: row.uid, patch: { repsMin: 6 } }],
      LIB,
    );
    expect(inCircuit.skipped).toEqual([]);
    const [updatedCircuit, sameBench] = groupsOf(inCircuit.draft);
    expect(updatedCircuit.uid).toBe(circuit.uid);
    expect(groupSettingsOf(updatedCircuit)).toEqual(CIRCUIT);
    expect(updatedCircuit.exercises).toEqual([circuit.exercises[0], { ...row, repsMin: 6 }]);
    expect(sameBench).toEqual(benchGroup);

    const outOfCircuit = applyDraftOps(
      draft,
      [{ type: "update_exercise", sessionUid, exerciseUid: bench.uid, patch: { notes: "pause" } }],
      LIB,
    );
    expect(outOfCircuit.skipped).toEqual([]);
    expect(groupsOf(outOfCircuit.draft)).toEqual([
      circuit,
      { ...benchGroup, exercises: [{ ...bench, notes: "pause" }] },
    ]);
  });

  it("update_exercise refuses to change how many sets a circuit exercise has — its sets are the rounds", () => {
    const { draft, sessionUid, row, bench } = makeFixture();
    for (const patch of [{ sets: 5 }, { setSpecs: [
      { set_number: 1, set_type: "working" as const },
      { set_number: 2, set_type: "working" as const },
    ] }]) {
      const refused = applyDraftOp(draft, { type: "update_exercise", sessionUid, exerciseUid: row.uid, patch }, LIB);
      expect(refused.skipped).toMatch(/superset or circuit/);
      expect(refused.draft).toBe(draft);
    }
    // Keeping the count applies, and a lone exercise changes its sets freely.
    expect(
      applyDraftOp(draft, { type: "update_exercise", sessionUid, exerciseUid: row.uid, patch: { sets: 3, repsMin: 5 } }, LIB).skipped,
    ).toBeUndefined();
    expect(
      applyDraftOp(draft, { type: "update_exercise", sessionUid, exerciseUid: bench.uid, patch: { sets: 5 } }, LIB).skipped,
    ).toBeUndefined();
  });

  it("remove_exercise of the circuit's second exercise leaves the other a plain exercise", () => {
    const { draft, sessionUid, circuit, benchGroup, squat, row } = makeFixture();
    const result = applyDraftOps(
      draft,
      [{ type: "remove_exercise", sessionUid, exerciseUid: row.uid }],
      LIB,
    );
    expect(result.skipped).toEqual([]);
    const groups = groupsOf(result.draft);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({ uid: circuit.uid, ...STRAIGHT_SETS, exercises: [squat] });
    expect(groups[1]).toEqual(benchGroup);
  });

  it("remove_exercise of a lone exercise removes its group", () => {
    const { draft, sessionUid, circuit, bench } = makeFixture();
    const result = applyDraftOps(
      draft,
      [{ type: "remove_exercise", sessionUid, exerciseUid: bench.uid }],
      LIB,
    );
    expect(result.skipped).toEqual([]);
    expect(groupsOf(result.draft)).toEqual([circuit]);
  });

  it("move_exercise lands where its place says: among the groups, inside the circuit, or out of it", () => {
    const { draft, sessionUid, circuit, benchGroup, squat, bench } = makeFixture();
    const move = (exerciseUid: string, to: ExerciseDestination, groupUid = "grp-out") =>
      applyDraftOp(draft, { type: "move_exercise", sessionUid, exerciseUid, to, groupUid }, LIB);

    // The lone exercise to the front: its own group moves ahead of the circuit.
    const benchFirst = move(bench.uid, { kind: "session", index: 0 });
    expect(benchFirst.skipped).toBeUndefined();
    expect(namesOf(benchFirst.draft)).toEqual(["Bench Press", "Squat", "Row"]);
    expect(groupsOf(benchFirst.draft).map((g) => g.uid)).toEqual([benchGroup.uid, circuit.uid]);
    expectCircuitWhole(benchFirst.draft, circuit);

    // Into the circuit, between Squat and Row: it joins, keeping the circuit's settings.
    const intoCircuit = move(bench.uid, { kind: "group", groupUid: circuit.uid, index: 1 });
    expect(intoCircuit.skipped).toBeUndefined();
    expect(namesOf(intoCircuit.draft)).toEqual(["Squat", "Bench Press", "Row"]);
    expect(groupsOf(intoCircuit.draft)).toHaveLength(1);
    expect(groupSettingsOf(groupsOf(intoCircuit.draft)[0])).toEqual(CIRCUIT);

    // Out of the circuit, to the end: it stands alone in the op's group, and the
    // circuit it left with one exercise is a plain exercise.
    const squatOut = move(squat.uid, { kind: "session", index: 2 });
    expect(squatOut.skipped).toBeUndefined();
    expect(namesOf(squatOut.draft)).toEqual(["Row", "Bench Press", "Squat"]);
    expect(groupsOf(squatOut.draft)[2]).toEqual({ uid: "grp-out", ...STRAIGHT_SETS, exercises: [squat] });
    expect(groupSettingsOf(groupsOf(squatOut.draft)[0])).toEqual(STRAIGHT_SETS);

    // A move to where it is changes nothing.
    expect(move(bench.uid, { kind: "session", index: 1 }).draft).toBe(draft);
    // The group uid it would take already exists: a replayed move skips.
    expect(move(squat.uid, { kind: "session", index: 2 }, benchGroup.uid).skipped).toMatch(/already/);
  });

  it("link_exercises, move_group and update_group edit through the shared group module", () => {
    const { draft, sessionUid, circuit, benchGroup, squat, row, bench } = makeFixture();
    const result = applyDraftOps(
      draft,
      [
        { type: "move_group", sessionUid, groupUid: benchGroup.uid, toIndex: 0 },
        { type: "update_group", sessionUid, groupUid: circuit.uid, patch: { rounds: 4, notes: null } },
        { type: "link_exercises", sessionUid, exerciseUids: [bench.uid, row.uid], groupUid: "grp-new" },
      ],
      LIB,
    );
    expect(result.skipped).toEqual([]);
    expect(result.applied).toBe(3);
    const groups = groupsOf(result.draft);
    expect(groups.map((g) => g.exercises.map((e) => e.name))).toEqual([["Bench Press", "Row"], ["Squat"]]);
    expect(groups[0]).toMatchObject({ uid: "grp-new", format: "circuit", rounds: 4 });
    expect(groups[0].exercises.map((e) => e.sets)).toEqual([4, 4]);
    expect(groups[1]).toEqual({ uid: circuit.uid, ...STRAIGHT_SETS, exercises: [expect.objectContaining({ uid: squat.uid })] });
  });

  it("a refused group edit is a skip with its reason, and a vanished session skips", () => {
    const { draft, sessionUid, benchGroup, circuit } = makeFixture();
    const refused = applyDraftOp(
      draft,
      { type: "update_group", sessionUid, groupUid: benchGroup.uid, patch: { rounds: 2 } },
      LIB,
    );
    expect(refused.skipped).toBe("A single exercise has no group settings");
    expect(refused.draft).toBe(draft);
    expect(
      applyDraftOp(draft, { type: "move_group", sessionUid: "gone", groupUid: circuit.uid, toIndex: 0 }, LIB).skipped,
    ).toBe("That session no longer exists");
    expect(
      applyDraftOp(draft, { type: "link_exercises", sessionUid, exerciseUids: [], groupUid: circuit.uid }, LIB).skipped,
    ).toMatch(/already/);
  });
});

describe("place_session and insert_week carry every group setting", () => {
  function sessionWithEverySetting(): SessionDraft {
    return makeSession({
      groups: [
        {
          uid: newUid("grp"),
          ...EVERY_SETTING,
          exercises: [makeExercise({ name: "Burpee" }), makeExercise({ name: "Thruster" })],
        },
        lone(makeExercise({ name: "Plank" })),
      ],
    });
  }

  it("the placed session and the inserted week hold their groups as the ops sent them", () => {
    const draft = makeDraft([makeRestWeek(0)]);
    const session = sessionWithEverySetting();
    const week = weekWithSession(sessionWithEverySetting(), 1);
    const ops: DraftOp[] = [
      { type: "place_session", slotUid: draft.weeks[0].days[2].uid, session },
      { type: "insert_week", afterWeekUid: null, week },
    ];

    // The client replays what its schema belt kept, so the schema keeps them too.
    for (const op of ops) expect(draftOpSchema.parse(op)).toEqual(op);

    const result = applyDraftOps(draft, ops, LIB);
    expect(result.skipped).toEqual([]);
    expect(result.applied).toBe(2);

    const placedGroups = result.draft.weeks[0].days[2].sessions[0].groups;
    expect(placedGroups).toEqual(session.groups);
    expect(groupSettingsOf(placedGroups[0])).toEqual(EVERY_SETTING);

    const insertedGroups = result.draft.weeks[1].days[0].sessions[0].groups;
    expect(insertedGroups).toEqual(week.days[0].sessions[0].groups);
    expect(groupSettingsOf(insertedGroups[0])).toEqual(EVERY_SETTING);
  });
});

describe("draftOpSchema (the client's belt before replay)", () => {
  const OTHER_CATALOG_ID = "44444444-4444-4444-8444-444444444444";
  const addExerciseOp = (exercises: ExerciseDraft[]) => ({
    type: "add_exercise" as const,
    sessionUid: "sess-1",
    group: { uid: "grp-1", ...CIRCUIT, exercises },
  });

  it("accepts an added group whose every exercise carries a catalog uuid, keeping every setting", () => {
    const op = addExerciseOp([
      makeExercise(),
      makeExercise({ name: "Row", exerciseId: OTHER_CATALOG_ID }),
    ]);
    const parsed = draftOpSchema.safeParse(op);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(op);
  });

  it("rejects an added group holding an exercise with no catalog identity", () => {
    const op = addExerciseOp([makeExercise(), makeExercise({ name: "Row", exerciseId: null })]);
    expect(draftOpSchema.safeParse(op).success).toBe(false);
  });

  it("rejects an update_exercise patch carrying supersetGroup or groups (strict)", () => {
    const updateExerciseOp = (patch: Record<string, unknown>) => ({
      type: "update_exercise",
      sessionUid: "sess-1",
      exerciseUid: "ex-1",
      patch,
    });
    expect(draftOpSchema.safeParse(updateExerciseOp({ sets: 4 })).success).toBe(true);
    expect(
      draftOpSchema.safeParse(updateExerciseOp({ sets: 4, supersetGroup: "A" })).success,
    ).toBe(false);
    expect(draftOpSchema.safeParse(updateExerciseOp({ sets: 4, groups: [] })).success).toBe(
      false,
    );
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
      past: draft.weeks[0].days[0].sessions[0],
      future: draft.weeks[1].days[0].sessions[0],
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
    expect(placedOut.draft.weeks[1].days[3].sessions.map((s) => s.uid)).toEqual([session.uid]);

    const cleared = applyDraftOp(
      draft,
      { type: "clear_slot", slotUid: draft.weeks[1].days[0].uid },
      placed(7),
    );
    expect(cleared.skipped).toBeUndefined();
    expect(cleared.draft.weeks[1].days[0].sessions).toEqual([]);
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
    expect(moved.draft.weeks[1].days[4].sessions.map((s) => s.uid)).toEqual([future.uid]);
  });

  it("session and exercise ops on a history session skip with PAST_LOCKED; on an editable one they apply", () => {
    const { draft, past, future } = makeFixture();
    const opsOn = (session: SessionDraft): DraftOp[] => {
      const exerciseUid = sessionExercises(session)[0].uid;
      return [
        { type: "update_session", sessionUid: session.uid, patch: { notes: "x" } },
        { type: "add_exercise", sessionUid: session.uid, group: lone(makeExercise()) },
        { type: "update_exercise", sessionUid: session.uid, exerciseUid, patch: { sets: 5 } },
        { type: "remove_exercise", sessionUid: session.uid, exerciseUid },
        {
          type: "move_exercise",
          sessionUid: session.uid,
          exerciseUid,
          to: { kind: "session", index: 0 },
          groupUid: newUid("grp"),
        },
        { type: "move_group", sessionUid: session.uid, groupUid: session.groups[0].uid, toIndex: 0 },
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
      week.days[3] = { ...makeRestSlot(3), isRest: false, sessions: [makeSession()] };
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
