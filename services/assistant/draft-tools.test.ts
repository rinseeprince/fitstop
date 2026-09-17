import { describe, it, expect } from "vitest";

// The tool layer is pure over a workspace built from fixture rows — no DB.
// (supabase-admin is mocked because the catalog service imports it at module
// top; nothing in these tests may touch it, which is itself the point: the
// assistant NEVER writes to the catalog.)
import { vi } from "vitest";
vi.mock("@/services/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      throw new Error("assistant tools must never touch the database");
    }),
  },
}));

import { z } from "zod";
import type { ExerciseRow } from "@/lib/database-helpers";
import {
  makeRestSlot,
  makeRestWeek,
  newUid,
  type ExerciseDraft,
  type ExerciseGroupDraft,
  type ProgramDraft,
  type SessionDraft,
} from "@/components/clients/training/program-builder/program-builder-types";
import {
  mapSession,
  normalizeDraft,
} from "@/components/clients/training/program-builder/program-builder-model";
import {
  applyDraftOps,
  isDestructiveOp,
} from "@/components/clients/training/program-builder/program-builder-ops";
import {
  LIMIT_LOCKED,
  PAST_LOCKED,
  type EditableDays,
} from "@/components/clients/training/program-builder/program-builder-lock-model";
import { draftOpSchema } from "@/lib/validations/assistant";
import type { SetSpec } from "@/utils/exercise-set-specs";
import {
  STRAIGHT_SETS,
  groupSettingsOf,
  sessionExercises,
  type GroupSettings,
} from "@/utils/exercise-groups";
import {
  buildWorkspaceFromRows,
  finalizeAssistantOps,
  type DraftWorkspace,
} from "./draft-workspace";
import { programContext, programSkeleton, resolveExerciseRef } from "./draft-tool-helpers";
import { buildReadTools } from "./draft-read-tools";
import { buildWeekTools } from "./draft-week-tools";
import { buildSessionTools } from "./draft-session-tools";
import { buildExerciseTools } from "./draft-exercise-tools";
import { buildGroupTools } from "./draft-group-tools";
import { setSpecCount } from "@/utils/exercise-set-specs";

const SQUAT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CURL_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BENCH_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function row(overrides: Partial<ExerciseRow> & Pick<ExerciseRow, "id" | "name">): ExerciseRow {
  return {
    coach_id: null,
    muscle_group: null,
    equipment: null,
    category: null,
    aliases: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as ExerciseRow;
}

const CATALOG: ExerciseRow[] = [
  row({ id: SQUAT_ID, name: "Back Squat", category: "Compound", aliases: ["squat"] }),
  row({ id: CURL_ID, name: "Leg Curl", category: "isolation" }),
  row({ id: BENCH_ID, name: "Bench Press", category: "compound", aliases: ["bp"] }),
];

const workingSet = (load: number): SetSpec => ({
  set_number: 1,
  set_type: "working",
  reps_min: 5,
  reps_max: 5,
  reps_target: null,
  load_type: "absolute",
  load_value: load,
  rpe_target: null,
  tempo: null,
  rest_seconds: 180,
  drops: null,
});

function exercise(
  name: string,
  exerciseId: string | null,
  specs: SetSpec[] | null,
): ExerciseDraft {
  return {
    uid: newUid("ex"),
    exerciseId,
    name,
    setSpecs: specs?.map((s, i) => ({ ...s, set_number: i + 1 })) ?? null,
    sets: specs ? specs.filter((s) => s.set_type !== "warmup").length : 3,
    repsMin: 5,
    repsMax: 5,
    repsTarget: null,
    rpeTarget: null,
    percentage1rm: null,
    tempo: null,
    restSeconds: null,
    isWarmup: false,
    notes: null,
    videoUrl: null,
    prescribedFields: null,
  };
}

// A lone exercise: a straight-sets group of one.
function lone(ex: ExerciseDraft): ExerciseGroupDraft {
  return { uid: newUid("grp"), ...STRAIGHT_SETS, exercises: [ex] };
}

// A superset/circuit: three rounds, 90s between rounds.
const CIRCUIT: GroupSettings = {
  ...STRAIGHT_SETS,
  format: "circuit",
  rounds: 3,
  restBetweenRoundsSeconds: 90,
  notes: "A",
};

function makeDraft(): ProgramDraft {
  const session: SessionDraft = {
    uid: newUid("sess"),
    name: "Lower A",
    focus: "legs",
    estimatedDurationMinutes: null,
    calorieSurplusPercentage: null,
    notes: null,
    sessionType: "training",
    groups: [
      lone(exercise("Back Squat", SQUAT_ID, [workingSet(100), workingSet(100)])),
      lone(exercise("Leg Curl", CURL_ID, [workingSet(40), workingSet(40)])),
    ],
  };
  const week = makeRestWeek(0);
  week.days[0] = { ...makeRestSlot(0), isRest: false, sessions: [session] };
  return normalizeDraft({
    id: "44444444-4444-4444-8444-444444444444",
    name: "Strength Block",
    description: null,
    status: "saved",
    splitType: "Strength",
    programDurationWeeks: null,
    defaultSurplusPercentage: null,
    weeks: [week],
  });
}

function makeWs(target: "library" | "client-draft" = "library") {
  return buildWorkspaceFromRows({ target, draft: makeDraft(), catalog: CATALOG });
}

const tool = (tools: Array<{ name: string }>, name: string) => {
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found as unknown as { run: (input: never) => Promise<string> | string };
};

const squatLoads = (ws: ReturnType<typeof makeWs>, weekIndex: number): number[] => {
  const [session] = ws.draft.weeks[weekIndex].days[0].sessions;
  return ((session ? sessionExercises(session)[0].setSpecs : null) ?? []).map(
    (s) => s.load_value ?? -1,
  );
};

describe("duplicate_week with progression", () => {
  it("compounds per-step load rules cumulatively (+2kg per generated week)", async () => {
    const ws = makeWs();
    const dup = tool(buildWeekTools(ws), "duplicate_week");
    const out = await dup.run({
      week: 1,
      count: 3,
      rules: [{ kind: "load_kg", amount: 2 }],
    } as never);
    expect(out).toMatch(/Inserted 3 week/);
    expect(ws.ops).toHaveLength(3);
    expect(ws.ops.every((op) => op.type === "insert_week")).toBe(true);
    expect(squatLoads(ws, 1)).toEqual([102, 102]);
    expect(squatLoads(ws, 2)).toEqual([104, 104]);
    expect(squatLoads(ws, 3)).toEqual([106, 106]);
  });

  it("fires everyNWeeks rules only on their cadence (extra set every other week)", async () => {
    const ws = makeWs();
    const dup = tool(buildWeekTools(ws), "duplicate_week");
    await dup.run({
      week: 1,
      count: 4,
      rules: [{ kind: "sets", amount: 1, everyNWeeks: 2 }],
    } as never);
    const setCount = (w: number) => {
      const [session] = ws.draft.weeks[w].days[0].sessions;
      return session ? sessionExercises(session)[0].setSpecs?.length : undefined;
    };
    expect(setCount(1)).toBe(2); // step 1: rule not due
    expect(setCount(2)).toBe(3); // step 2: +1
    expect(setCount(3)).toBe(3); // step 3: not due
    expect(setCount(4)).toBe(4); // step 4: +1 again (cumulative)
  });

  it("scopes 'compounds' via the catalog category (case-insensitive)", async () => {
    const ws = makeWs();
    const dup = tool(buildWeekTools(ws), "duplicate_week");
    await dup.run({
      week: 1,
      count: 1,
      rules: [{ kind: "load_kg", amount: 5 }],
      scope: "compounds",
    } as never);
    const exercises = sessionExercises(ws.draft.weeks[1].days[0].sessions[0]);
    expect(exercises[0].setSpecs?.[0].load_value).toBe(105); // Back Squat (Compound)
    expect(exercises[1].setSpecs?.[0].load_value).toBe(40); // Leg Curl untouched
  });

  it("relays the MAX_WEEKS belt instead of silently no-opping", async () => {
    const ws = makeWs();
    ws.draft = normalizeDraft({
      ...ws.draft,
      weeks: Array.from({ length: 52 }, (_, i) => makeRestWeek(i)),
    });
    const dup = tool(buildWeekTools(ws), "duplicate_week");
    const out = await dup.run({ week: 1, count: 1 } as never);
    expect(out).toMatch(/cap/);
    expect(ws.ops).toHaveLength(0);
  });
});

describe("delete_week / add_session belts", () => {
  it("refuses to delete the last week, loudly", async () => {
    const ws = makeWs();
    const del = tool(buildWeekTools(ws), "delete_week");
    const out = await del.run({ week: 1 } as never);
    expect(out).toMatch(/at least one week/);
    expect(ws.ops).toHaveLength(0);
  });

  it("refuses to add a session onto an occupied day", async () => {
    const ws = makeWs();
    const add = tool(buildSessionTools(ws), "add_session");
    const out = await add.run({ week: 1, day: 1, name: "Second" } as never);
    expect(out).toMatch(/already has a session/);
    expect(ws.ops).toHaveLength(0);
  });
});

describe("catalog constraint (add_exercise)", () => {
  it("resolves via alias and stamps the CANONICAL catalog name + id", async () => {
    const ws = makeWs();
    const add = tool(buildExerciseTools(ws), "add_exercise");
    const out = await add.run({ week: 1, day: 1, name: "bp" } as never);
    expect(out).toMatch(/Bench Press/);
    expect(ws.ops).toHaveLength(1);
    const op = ws.ops[0];
    if (op.type !== "add_exercise") throw new Error("expected add_exercise");
    expect(op.group.exercises).toHaveLength(1);
    expect(op.group.exercises[0].exerciseId).toBe(BENCH_ID);
    expect(op.group.exercises[0].name).toBe("Bench Press");
  });

  it("commits the exercise as a straight-sets group of one, its grp- uid minted by the tool", async () => {
    const ws = makeWs();
    const add = tool(buildExerciseTools(ws), "add_exercise");
    await add.run({ week: 1, day: 1, name: "Bench Press" } as never);
    expect(ws.ops).toHaveLength(1);
    const op = ws.ops[0];
    if (op.type !== "add_exercise") throw new Error("expected add_exercise");

    const { uid, exercises, ...settings } = op.group;
    expect(uid).toMatch(/^grp-/);
    expect(settings).toEqual(STRAIGHT_SETS);
    expect(exercises).toHaveLength(1);
    expect(exercises[0]).toMatchObject({ exerciseId: BENCH_ID, name: "Bench Press" });
    expect(exercises[0].uid).toMatch(/^ex-/);

    // The working copy holds that very group, after the session's two.
    const groups = ws.draft.weeks[0].days[0].sessions[0].groups;
    expect(groups).toHaveLength(3);
    expect(groups[2]).toEqual(op.group);
  });

  it("rejects an unresolvable name with repair candidates and constructs NO op", async () => {
    const ws = makeWs();
    const add = tool(buildExerciseTools(ws), "add_exercise");
    const out = await add.run({ week: 1, day: 1, name: "Bulgarian Ring Squat" } as never);
    expect(out).toMatch(/not in the exercise catalog/);
    expect(out).toMatch(/Back Squat/); // candidate surfaced
    expect(ws.ops).toHaveLength(0);
  });
});

describe("template identity (client-draft)", () => {
  it("update_program name/focus and update_session_details name/focus are refused", async () => {
    const ws = makeWs("client-draft");
    const program = tool(buildSessionTools(ws), "update_program");
    const session = tool(buildSessionTools(ws), "update_session_details");
    expect(await program.run({ name: "Hacked" } as never)).toMatch(/identity/);
    expect(await session.run({ week: 1, day: 1, focus: "renamed" } as never)).toMatch(
      /identity/,
    );
    expect(ws.ops).toHaveLength(0);

    // Non-identity fields still work in client-draft mode.
    const ok = await session.run({ week: 1, day: 1, surplusPercentage: 15 } as never);
    expect(ok).toMatch(/Updated/);
    expect(ws.ops).toHaveLength(1);
  });
});

describe("set programming tools", () => {
  it("set_exercise_sets builds specs with the compact projection in the op payload", async () => {
    const ws = makeWs();
    const setSets = tool(buildExerciseTools(ws), "set_exercise_sets");
    const out = await setSets.run({
      week: 1,
      day: 1,
      exerciseName: "Back Squat",
      sets: [
        { setType: "warmup", repsMin: 10, repsMax: 10, loadKg: 60 },
        { setType: "working", repsMin: 5, repsMax: 5, loadKg: 120, rpe: 8 },
        { setType: "working", repsMin: 5, repsMax: 8, loadKg: 110 },
      ],
    } as never);
    expect(out).toMatch(/3 sets \(2 working\)/);
    const op = ws.ops[0];
    if (op.type !== "update_exercise") throw new Error("expected update_exercise");
    expect(op.patch.setSpecs).toHaveLength(3);
    expect(op.patch.sets).toBe(2); // compact = working count (landmine #2)
    expect(op.patch.repsMin).toBe(5);
    expect(op.patch.repsMax).toBe(8);
  });

  it("rejects an all-warmup set list", async () => {
    const ws = makeWs();
    const setSets = tool(buildExerciseTools(ws), "set_exercise_sets");
    const out = await setSets.run({
      week: 1,
      day: 1,
      exercisePosition: 1,
      sets: [{ setType: "warmup" }],
    } as never);
    expect(out).toMatch(/non-warmup/);
    expect(ws.ops).toHaveLength(0);
  });

  it("update_exercise loadKg sets a uniform working-set load with compact re-projection", async () => {
    const ws = makeWs();
    const update = tool(buildExerciseTools(ws), "update_exercise");
    const out = await update.run({
      week: 1,
      day: 1,
      exerciseName: "Leg Curl",
      loadKg: 45,
    } as never);
    expect(out).toMatch(/Updated/);
    const op = ws.ops[0];
    if (op.type !== "update_exercise") throw new Error("expected update_exercise");
    expect(op.patch.setSpecs?.every((s) => s.load_value === 45)).toBe(true);
  });
});

describe("finalizeAssistantOps sweeps", () => {
  it("discards the whole turn when an unresolved NEW exercise leaks into the draft", () => {
    const ws = makeWs();
    // Simulate an executor bug: an exercise with no catalog identity and a
    // name that did not exist at entry lands in the working copy.
    const rogue = lone(exercise("Invented Movement", null, null));
    const sessionUid = ws.draft.weeks[0].days[0].sessions[0].uid;
    ws.draft = normalizeDraft(
      mapSession(ws.draft, sessionUid, (s) => ({ ...s, groups: [...s.groups, rogue] })),
    );
    ws.ops.push({ type: "add_exercise", sessionUid, group: rogue });

    const { ops, notes } = finalizeAssistantOps(ws);
    expect(ops).toEqual([]);
    expect(notes.join(" ")).toMatch(/Invented Movement/);
  });

  it("keeps clones of pre-existing content even when their exerciseId is null", () => {
    const ws = buildWorkspaceFromRows({
      target: "library",
      draft: (() => {
        const d = makeDraft();
        d.weeks[0].days[0].sessions[0].groups[0].exercises[0] = exercise("Coach Special", null, null);
        return normalizeDraft(d);
      })(),
      catalog: CATALOG,
    });
    // duplicate_week clones "Coach Special" with a fresh uid — legal.
    const dup = tool(buildWeekTools(ws), "duplicate_week");
    return (async () => {
      await dup.run({ week: 1, count: 1 } as never);
      const { ops } = finalizeAssistantOps(ws);
      expect(ops).toHaveLength(1);
    })();
  });

  it("discards the turn if template identity broke in client-draft mode", () => {
    const ws = makeWs("client-draft");
    // Bypass every per-tool guard by mutating the working copy directly.
    ws.draft = normalizeDraft({ ...ws.draft, name: "Sneaky Rename" });
    ws.ops.push({ type: "set_program_meta", patch: { description: "cover" } });
    const { ops, notes } = finalizeAssistantOps(ws);
    expect(ops).toEqual([]);
    expect(notes.join(" ")).toMatch(/identity/);
  });
});

describe("review-fleet regressions (S6a follow-up)", () => {
  it("update_exercise applies compact fields BEFORE materializing a load (compact/specs can't contradict)", async () => {
    const ws = makeWs();
    // Compact-only exercise: setSpecs null, 3 sets 8-12.
    const sessionUid = ws.draft.weeks[0].days[0].sessions[0].uid;
    ws.draft = normalizeDraft(
      mapSession(ws.draft, sessionUid, (s) => ({
        ...s,
        groups: [lone(exercise("Back Squat", SQUAT_ID, null))],
      })),
    );

    const update = tool(buildExerciseTools(ws), "update_exercise");
    // "make it 5 sets of 5 at 100kg" — load AND compact fields in one call.
    await update.run({
      week: 1,
      day: 1,
      exercisePosition: 1,
      sets: 5,
      repsMin: 5,
      repsMax: 5,
      loadKg: 100,
    } as never);

    const op = ws.ops[0];
    if (op.type !== "update_exercise") throw new Error("expected update_exercise");
    // The specs must carry the REQUESTED 5 sets at 5 reps @100kg…
    expect(op.patch.setSpecs).toHaveLength(5);
    expect(op.patch.setSpecs?.every((s) => s.load_value === 100)).toBe(true);
    expect(op.patch.setSpecs?.every((s) => s.reps_min === 5 && s.reps_max === 5)).toBe(true);
    // …and the compact columns must be the projection OF those specs, so the
    // save path's re-derivation can't silently revert the coach's 5x5.
    expect(op.patch.sets).toBe(5);
    expect(op.patch.repsMin).toBe(5);
    expect(op.patch.repsMax).toBe(5);
  });

  it("clamps op labels to the wire cap so one long name can't void the whole turn", async () => {
    const ws = makeWs();
    const longName = "X".repeat(190);
    ws.draft = normalizeDraft(
      mapSession(ws.draft, ws.draft.weeks[0].days[0].sessions[0].uid, (s) => ({
        ...s,
        name: longName,
      })),
    );
    const clear = tool(buildSessionTools(ws), "clear_day");
    await clear.run({ week: 1, day: 1 } as never);
    expect(ws.ops).toHaveLength(1);
    expect(ws.ops[0].label!.length).toBeLessThanOrEqual(200);
  });

  it("clamps an out-of-range move_week target instead of emitting a wire-invalid index", async () => {
    const ws = makeWs();
    const dup = tool(buildWeekTools(ws), "duplicate_week");
    await dup.run({ week: 1, count: 2 } as never); // 3 weeks total
    ws.ops.length = 0;
    const move = tool(buildWeekTools(ws), "move_week");
    const out = await move.run({ week: 1, toPosition: 99 } as never);
    const op = ws.ops[0];
    if (op.type !== "move_week") throw new Error("expected move_week");
    expect(op.toIndex).toBe(2); // clamped to the last real position
    expect(out).toMatch(/position 3/); // narration matches what happened
  });
});

describe("duplicate_week insertAfterWeek (deload-then-resume)", () => {
  it("clones from BEFORE a deload and places the copies AFTER it, in order", async () => {
    const ws = makeWs();
    const dup = tool(buildWeekTools(ws), "duplicate_week");

    // W2-W3 progressing +10kg off W1.
    await dup.run({ week: 1, count: 2, rules: [{ kind: "load_kg", amount: 10 }] } as never);
    expect(squatLoads(ws, 1)).toEqual([110, 110]);
    expect(squatLoads(ws, 2)).toEqual([120, 120]);

    // W4 = deload off W3.
    await dup.run({ week: 3, count: 1, rules: [{ kind: "load_kg", amount: -60 }] } as never);
    expect(squatLoads(ws, 3)).toEqual([60, 60]);

    // W5-W6 resume from W3's PRE-deload loads, placed after the deload.
    const out = await dup.run({
      week: 3,
      count: 2,
      insertAfterWeek: 4,
      rules: [{ kind: "load_kg", amount: 10 }],
    } as never);

    expect(ws.draft.weeks).toHaveLength(6);
    expect(squatLoads(ws, 3)).toEqual([60, 60]); // deload still sits at position 4
    expect(squatLoads(ws, 4)).toEqual([130, 130]); // resumed from 120, not 60
    expect(squatLoads(ws, 5)).toEqual([140, 140]); // and keeps compounding
    expect(out).toMatch(/cloned from week 3/);
  });

  it("rejects an insertAfterWeek that doesn't exist instead of guessing", async () => {
    const ws = makeWs();
    const dup = tool(buildWeekTools(ws), "duplicate_week");
    const out = await dup.run({ week: 1, count: 1, insertAfterWeek: 9 } as never);
    expect(out).toMatch(/Week 9 doesn't exist/);
    expect(ws.ops).toHaveLength(0);
  });
});

describe("programContext front-loading (latency)", () => {
  it("inlines the FULL prescription for a normal program so no read round trips are needed", async () => {
    const ws = makeWs();
    const dup = tool(buildWeekTools(ws), "duplicate_week");
    await dup.run({ week: 1, count: 3 } as never); // 4-week program
    const ctx = programContext(ws.draft);
    expect(ctx.complete).toBe(true);
    // Every exercise the model would otherwise have to fetch is already there.
    expect(ctx.text).toContain("Back Squat");
    expect(ctx.text).toContain("Leg Curl");
    expect(ctx.text).toContain("Week 4:");
    expect(ctx.text).toContain("Day 2: rest");
  });

  it("falls back to the skeleton when a program is too large to inline", () => {
    const ws = makeWs();
    const big = normalizeDraft({
      ...ws.draft,
      weeks: Array.from({ length: 52 }, (_, i) => {
        const w = makeRestWeek(i);
        w.days[0] = {
          ...makeRestSlot(0),
          isRest: false,
          sessions: [
            {
              uid: newUid("sess"),
              name: `Session ${i}`,
              focus: "full body",
              estimatedDurationMinutes: 60,
              calorieSurplusPercentage: null,
              notes: null,
              sessionType: "training",
              groups: Array.from({ length: 8 }, () =>
                lone(exercise("Back Squat", SQUAT_ID, [workingSet(100)])),
              ),
            },
          ],
        };
        return w;
      }),
    });
    const ctx = programContext(big);
    expect(ctx.complete).toBe(false);
    expect(ctx.text).toContain("W1:"); // one line per week
    expect(ctx.text.length).toBeLessThan(12_000);
  });
});

describe("duplicate_week reports STORED loads, not recomputed arithmetic", () => {
  it("quotes the plate-rounded values the engine actually saved", async () => {
    const ws = makeWs();
    // Reproduces the live 12-week case: 80kg bench, +5%/week. Raw arithmetic
    // gives 84 / 88.2 / 92.61; the engine snaps to the nearest 0.5kg, so the
    // tool result must say 88 and 92.5 — those are what the grid holds.
    const sessionUid = ws.draft.weeks[0].days[0].sessions[0].uid;
    ws.draft = normalizeDraft(
      mapSession(ws.draft, sessionUid, (s) => ({
        ...s,
        groups: [lone(exercise("Back Squat", SQUAT_ID, [workingSet(80)]))],
      })),
    );

    const dup = tool(buildWeekTools(ws), "duplicate_week");
    const out = await dup.run({
      week: 1,
      count: 3,
      rules: [{ kind: "load_percent", amount: 5 }],
    } as never);

    expect(out).toContain("Resulting loads:");
    expect(out).toContain("Back Squat");
    // Stored, plate-rounded chain — never the raw 88.2 / 92.61.
    expect(out).toContain("84");
    expect(out).toContain("88");
    expect(out).toContain("92.5");
    expect(out).not.toContain("88.2");
    expect(out).not.toContain("92.6");

    const loads = (w: number) =>
      sessionExercises(ws.draft.weeks[w].days[0].sessions[0])[0].setSpecs![0].load_value;
    expect([loads(1), loads(2), loads(3)]).toEqual([84, 88, 92.5]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Groups through a turn: tools count exercise positions across groups, and the
// ops a turn returns replay onto the coach's draft without touching a group the
// turn did not edit.
// ═════════════════════════════════════════════════════════════════════════════

// Week 1 day 1: a circuit of Back Squat then Leg Curl, then Bench Press,
// Walking Lunge and Calf Raise, each a lone exercise.
function makeCircuitDraft(): { draft: ProgramDraft; circuit: ExerciseGroupDraft } {
  const circuit: ExerciseGroupDraft = {
    uid: newUid("grp"),
    ...CIRCUIT,
    exercises: [
      exercise("Back Squat", SQUAT_ID, [workingSet(100), workingSet(100)]),
      exercise("Leg Curl", CURL_ID, [workingSet(40)]),
    ],
  };
  const session: SessionDraft = {
    uid: newUid("sess"),
    name: "Lower A",
    focus: "legs",
    estimatedDurationMinutes: null,
    calorieSurplusPercentage: null,
    notes: null,
    sessionType: "training",
    groups: [
      circuit,
      lone(exercise("Bench Press", BENCH_ID, null)),
      lone(exercise("Walking Lunge", null, null)),
      lone(exercise("Calf Raise", null, null)),
    ],
  };
  const week = makeRestWeek(0);
  week.days[0] = { ...makeRestSlot(0), isRest: false, sessions: [session] };
  const draft = normalizeDraft({
    id: "44444444-4444-4444-8444-444444444444",
    name: "Strength Block",
    description: null,
    status: "saved",
    splitType: "Strength",
    programDurationWeeks: null,
    defaultSurplusPercentage: null,
    weeks: [week],
  });
  return { draft, circuit };
}

describe("a turn over a draft holding a circuit", () => {
  it("edits to other exercises replay onto the coach's draft with the circuit's uid and settings intact", async () => {
    const { draft: coachDraft, circuit } = makeCircuitDraft();
    const ws = buildWorkspaceFromRows({ target: "library", draft: coachDraft, catalog: CATALOG });
    const tools = buildExerciseTools(ws);

    // Position 3 is the first exercise after the two-exercise circuit.
    expect(
      await tool(tools, "update_exercise").run({
        week: 1,
        day: 1,
        exercisePosition: 3,
        sets: 5,
      } as never),
    ).toMatch(/Updated "Bench Press"/);
    expect(
      await tool(tools, "set_exercise_sets").run({
        week: 1,
        day: 1,
        exerciseName: "Walking Lunge",
        sets: [
          { setType: "working", repsMin: 10, repsMax: 12 },
          { setType: "working", repsMin: 10, repsMax: 12 },
        ],
      } as never),
    ).toMatch(/Programmed 2 sets/);
    expect(
      await tool(tools, "remove_exercise").run({
        week: 1,
        day: 1,
        exerciseName: "Calf Raise",
      } as never),
    ).toMatch(/Removed "Calf Raise"/);

    const { ops, notes } = finalizeAssistantOps(ws);
    expect(notes).toEqual([]);
    expect(ops.map((op) => op.type)).toEqual([
      "update_exercise",
      "update_exercise",
      "remove_exercise",
    ]);

    // The client re-validates the response body, then replays what the schema kept.
    const received = z.array(draftOpSchema).parse(JSON.parse(JSON.stringify(ops)));
    const replayed = applyDraftOps(coachDraft, received, { target: "library" });
    expect(replayed.skipped).toEqual([]);
    expect(replayed.applied).toBe(3);

    const [session] = replayed.draft.weeks[0].days[0].sessions;
    expect(session.groups[0].uid).toBe(circuit.uid);
    expect(groupSettingsOf(session.groups[0])).toEqual(CIRCUIT);
    expect(session.groups[0]).toEqual(circuit);
    expect(sessionExercises(session).map((e) => e.name)).toEqual([
      "Back Squat",
      "Leg Curl",
      "Bench Press",
      "Walking Lunge",
    ]);
    // The coach's draft lands where the server's working copy did.
    expect(replayed.draft).toEqual(ws.draft);
  });

  // A move never splits a linked group, so an exercise can land beside the
  // place the model asked for. The tool reports where it is, never the ask.
  it("reorder_exercise reports where the exercise landed when a linked group kept it from the place asked", async () => {
    const { draft } = makeCircuitDraft();
    const ws = buildWorkspaceFromRows({ target: "library", draft, catalog: CATALOG });
    const tools = buildExerciseTools(ws);

    // Position 2 is inside the circuit: Bench Press stays after it, at 3.
    const out = await tool(tools, "reorder_exercise").run({
      week: 1,
      day: 1,
      exerciseName: "Bench Press",
      toPosition: 2,
    } as never);
    expect(out).toBe(
      '"Bench Press" is at position 3, not 2: exercises linked in a group stay together, so it went to the nearest place that keeps every group whole.',
    );
    expect(sessionExercises(ws.draft.weeks[0].days[0].sessions[0]).map((e) => e.name)).toEqual([
      "Back Squat",
      "Leg Curl",
      "Bench Press",
      "Walking Lunge",
      "Calf Raise",
    ]);

    // A move a group allows is reported as asked, clamped to the session.
    expect(
      await tool(tools, "reorder_exercise").run({
        week: 1,
        day: 1,
        exerciseName: "Calf Raise",
        toPosition: 1,
      } as never),
    ).toBe('Moved "Calf Raise" to position 1.');
    expect(
      await tool(tools, "reorder_exercise").run({
        week: 1,
        day: 1,
        exerciseName: "Calf Raise",
        toPosition: 50,
      } as never),
    ).toBe('Moved "Calf Raise" to position 5.');
  });

  it("add_exercise with a position inside a linked group says where the new exercise went", async () => {
    const { draft } = makeCircuitDraft();
    const ws = buildWorkspaceFromRows({ target: "library", draft, catalog: CATALOG });
    const tools = buildExerciseTools(ws);

    const out = await tool(tools, "add_exercise").run({
      week: 1,
      day: 1,
      name: "Bench Press",
      position: 2,
    } as never);
    expect(out).toMatch(/^Added "[^"]+" to "Lower A" \(week 1 day 1\)\. "[^"]+" is at position 3, not 2: exercises linked in a group stay together/);
    const names = sessionExercises(ws.draft.weeks[0].days[0].sessions[0]).map((e) => e.name);
    expect(names.slice(0, 2)).toEqual(["Back Squat", "Leg Curl"]);
  });
});

describe("resolveExerciseRef across groups", () => {
  it("counts exercisePosition across groups: position 2 is the second exercise of a two-exercise first group", () => {
    const [session] = makeCircuitDraft().draft.weeks[0].days[0].sessions;

    const second = resolveExerciseRef(session, { exercisePosition: 2 });
    if (!second.ok) throw new Error(second.error);
    expect(second.value.exercise).toBe(session.groups[0].exercises[1]);
    expect(second.value.exercise.name).toBe("Leg Curl");
    expect(second.value.index).toBe(1);

    const third = resolveExerciseRef(session, { exercisePosition: 3 });
    if (!third.ok) throw new Error(third.error);
    expect(third.value.exercise).toBe(session.groups[1].exercises[0]);
    expect(third.value.index).toBe(2);

    const past = resolveExerciseRef(session, { exercisePosition: 6 });
    expect(past.ok).toBe(false);
    if (!past.ok) expect(past.error).toMatch(/has 5 exercise\(s\) — position 6 doesn't exist/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Placed-plan target: the editable days, as positions from the plan's start
// (ops ctx + the sweep). Days before `from` are history, days past `through`
// are greyed; the program and session names stay editable.
// ═════════════════════════════════════════════════════════════════════════════

function makePlacedDraft(): ProgramDraft {
  const past: SessionDraft = {
    uid: newUid("sess"),
    name: "Lower A",
    focus: "legs",
    estimatedDurationMinutes: null,
    calorieSurplusPercentage: null,
    notes: null,
    sessionType: "training",
    groups: [lone(exercise("Back Squat", SQUAT_ID, [workingSet(100)]))],
  };
  const future: SessionDraft = {
    uid: newUid("sess"),
    name: "Lower B",
    focus: "legs",
    estimatedDurationMinutes: null,
    calorieSurplusPercentage: null,
    notes: null,
    sessionType: "training",
    groups: [lone(exercise("Leg Curl", CURL_ID, [workingSet(40)]))],
  };
  const week0 = makeRestWeek(0);
  week0.days[0] = { ...makeRestSlot(0), isRest: false, sessions: [past] };
  const week1 = makeRestWeek(1);
  week1.days[0] = { ...makeRestSlot(0), isRest: false, sessions: [future] };
  return normalizeDraft({
    id: "44444444-4444-4444-8444-444444444444",
    name: "Placed Block",
    description: null,
    status: "saved",
    splitType: "Strength",
    programDurationWeeks: null,
    defaultSurplusPercentage: null,
    weeks: [week0, week1],
  });
}

// Week 1 (positions 0-6) is history and week 2 editable unless the days say
// otherwise; each week's day 1 holds a session.
function makePlacedWs(editableDays: EditableDays = { from: 7, through: null }) {
  return buildWorkspaceFromRows({
    target: "placed-plan",
    draft: makePlacedDraft(),
    catalog: CATALOG,
    editableDays,
  });
}

describe("placed-plan editable days (tool executors)", () => {
  it("skips an edit on a history day as locked; the same edit on an editable day lands", async () => {
    const ws = makePlacedWs();
    const update = tool(buildExerciseTools(ws), "update_exercise");

    const refused = await update.run({
      week: 1,
      day: 1,
      exerciseName: "Back Squat",
      loadKg: 90,
    } as never);
    expect(refused).toBe(PAST_LOCKED);
    expect(ws.ops).toHaveLength(0);

    const ok = await update.run({
      week: 2,
      day: 1,
      exerciseName: "Leg Curl",
      loadKg: 45,
    } as never);
    expect(ok).toMatch(/Updated/);
    expect(ws.ops).toHaveLength(1);
  });

  it("never adds a session to a history day, or moves one onto or off it", async () => {
    const ws = makePlacedWs();
    const add = tool(buildSessionTools(ws), "add_session");
    const move = tool(buildSessionTools(ws), "move_session");

    expect(await add.run({ week: 1, day: 2, name: "Extra" } as never)).toBe(PAST_LOCKED);
    expect(
      await move.run({ fromWeek: 1, fromDay: 1, toWeek: 2, toDay: 3 } as never),
    ).toBe(PAST_LOCKED);
    expect(
      await move.run({ fromWeek: 2, fromDay: 1, toWeek: 1, toDay: 2 } as never),
    ).toBe(PAST_LOCKED);
    expect(ws.ops).toHaveLength(0);
  });

  it("skips structural ops on history (delete_week / clear_day / move_week / duplicate_week)", async () => {
    const ws = makePlacedWs();
    expect(await tool(buildWeekTools(ws), "delete_week").run({ week: 1 } as never)).toBe(
      PAST_LOCKED,
    );
    expect(
      await tool(buildSessionTools(ws), "clear_day").run({ week: 1, day: 1 } as never),
    ).toBe(PAST_LOCKED);
    expect(
      await tool(buildWeekTools(ws), "move_week").run({ week: 2, toPosition: 1 } as never),
    ).toBe(PAST_LOCKED);
    expect(ws.ops).toHaveLength(0);

    // Week 2's first three days are history: a copy landing after week 1
    // would move them.
    const midWeek = makePlacedWs({ from: 10, through: null });
    expect(
      await tool(buildWeekTools(midWeek), "duplicate_week").run({ week: 1 } as never),
    ).toBe(PAST_LOCKED);
    expect(midWeek.ops).toHaveLength(0);
  });

  it("never puts a session on a greyed day past the plan's limit", async () => {
    // The plan reaches week 2 day 4 (position 10); days 5-7 are greyed.
    const ws = makePlacedWs({ from: 7, through: 10 });
    const add = tool(buildSessionTools(ws), "add_session");
    const move = tool(buildSessionTools(ws), "move_session");

    expect(await add.run({ week: 2, day: 5, name: "Extra" } as never)).toBe(LIMIT_LOCKED);
    expect(
      await move.run({ fromWeek: 2, fromDay: 1, toWeek: 2, toDay: 6 } as never),
    ).toBe(LIMIT_LOCKED);
    expect(ws.ops).toHaveLength(0);

    // The limit's own day still takes one.
    expect(await add.run({ week: 2, day: 4, name: "Extra" } as never)).toMatch(/Added/);
    expect(ws.ops).toHaveLength(1);
  });

  it("skips a copied week that would push a session past the plan's limit", async () => {
    // The plan reaches the end of week 2 and no further.
    const ws = makePlacedWs({ from: 7, through: 13 });
    expect(
      await tool(buildWeekTools(ws), "duplicate_week").run({ week: 2 } as never),
    ).toBe(LIMIT_LOCKED);
    expect(ws.ops).toHaveLength(0);
  });

  it("renames ARE allowed on placed plans (identity sweep not applied)", async () => {
    const ws = makePlacedWs();
    const program = tool(buildSessionTools(ws), "update_program");
    const session = tool(buildSessionTools(ws), "update_session_details");

    expect(await program.run({ name: "Renamed Block" } as never)).not.toMatch(/identity/);
    // An editable session's rename lands too.
    expect(
      await session.run({ week: 2, day: 1, name: "Lower B2" } as never),
    ).toMatch(/Updated/);

    const finalized = finalizeAssistantOps(ws);
    expect(finalized.ops.length).toBeGreaterThan(0);
    expect(finalized.notes).toHaveLength(0);
  });
});

describe("placed-plan sweep (finalizeAssistantOps)", () => {
  it("discards the turn when a history day's content changed despite the guards", () => {
    const ws = makePlacedWs();
    // Simulate an executor bug mutating history directly (bypassing commitOp).
    ws.draft = normalizeDraft(
      mapSession(ws.draft, ws.draft.weeks[0].days[0].sessions[0].uid, (s) => ({
        ...s,
        name: "Rewritten History",
      })),
    );

    const finalized = finalizeAssistantOps(ws);
    expect(finalized.ops).toHaveLength(0);
    expect(finalized.notes.join(" ")).toMatch(/already happened/);
  });

  it("discards the turn when a history day vanished (its week removed)", () => {
    const ws = makePlacedWs();
    ws.draft = normalizeDraft({ ...ws.draft, weeks: ws.draft.weeks.slice(1) });

    const finalized = finalizeAssistantOps(ws);
    expect(finalized.ops).toHaveLength(0);
    expect(finalized.notes.join(" ")).toMatch(/already happened/);
  });

  it("discards the turn when it leaves a session on a greyed day", () => {
    const ws = makePlacedWs({ from: 7, through: 10 });
    // Simulate an executor bug placing a session on week 2 day 6 (position
    // 12), past the limit, bypassing commitOp.
    const extra: SessionDraft = {
      uid: newUid("sess"),
      name: "Extra",
      focus: null,
      estimatedDurationMinutes: null,
      calorieSurplusPercentage: null,
      notes: null,
      sessionType: "training",
      groups: [],
    };
    const greyedUid = ws.draft.weeks[1].days[5].uid;
    ws.draft = normalizeDraft({
      ...ws.draft,
      weeks: ws.draft.weeks.map((w) => ({
        ...w,
        days: w.days.map((slot) =>
          slot.uid === greyedUid ? { ...slot, isRest: false, sessions: [extra] } : slot,
        ),
      })),
    });
    ws.ops.push({ type: "place_session", slotUid: greyedUid, session: extra });

    const finalized = finalizeAssistantOps(ws);
    expect(finalized.ops).toHaveLength(0);
    expect(finalized.notes.join(" ")).toMatch(/greyed-out day/);
  });

  it("ships the ops when history is untouched and every greyed day is rest", async () => {
    const ws = makePlacedWs({ from: 7, through: 10 });
    const update = tool(buildExerciseTools(ws), "update_exercise");
    await update.run({ week: 2, day: 1, exerciseName: "Leg Curl", loadKg: 45 } as never);

    const finalized = finalizeAssistantOps(ws);
    expect(finalized.ops).toHaveLength(1);
    expect(finalized.notes).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Group tools: the coach's own gestures — link, add to a group, take out, move
// a whole group, change its settings — as ops the client replays identically.
// ═════════════════════════════════════════════════════════════════════════════

// Week 1 day 1: Back Squat, Bench Press, Leg Curl (2 sets) and Calf Raise,
// each a lone exercise.
function makeLoneDraft(): ProgramDraft {
  const session: SessionDraft = {
    uid: newUid("sess"),
    name: "Full body A",
    focus: null,
    estimatedDurationMinutes: null,
    calorieSurplusPercentage: null,
    notes: null,
    sessionType: "training",
    groups: [
      lone(exercise("Back Squat", SQUAT_ID, null)),
      lone(exercise("Bench Press", BENCH_ID, null)),
      lone({ ...exercise("Leg Curl", CURL_ID, null), sets: 2 }),
      lone(exercise("Calf Raise", null, null)),
    ],
  };
  const week = makeRestWeek(0);
  week.days[0] = { ...makeRestSlot(0), isRest: false, sessions: [session] };
  return normalizeDraft({
    id: "44444444-4444-4444-8444-444444444444",
    name: "Hybrid",
    description: null,
    status: "saved",
    splitType: null,
    programDurationWeeks: null,
    defaultSurplusPercentage: null,
    weeks: [week],
  });
}

const dayOne = (draft: ProgramDraft) => draft.weeks[0].days[0].sessions[0];
const shapeOf = (draft: ProgramDraft) =>
  dayOne(draft).groups.map((g) => g.exercises.map((e) => e.name));

describe("group tools", () => {
  function groupWs() {
    const coachDraft = makeLoneDraft();
    const ws = buildWorkspaceFromRows({ target: "library", draft: coachDraft, catalog: CATALOG });
    return { coachDraft, ws, groups: buildGroupTools(ws), exercises: buildExerciseTools(ws) };
  }

  // What the client does with a turn: re-validate, then replay onto its own draft.
  function expectReplayMatches(coachDraft: ProgramDraft, ws: ReturnType<typeof groupWs>["ws"]) {
    const { ops, notes } = finalizeAssistantOps(ws);
    expect(notes).toEqual([]);
    const received = z.array(draftOpSchema).parse(JSON.parse(JSON.stringify(ops)));
    const replayed = applyDraftOps(coachDraft, received, { target: "library" });
    expect(replayed.skipped).toEqual([]);
    expect(replayed.draft).toEqual(ws.draft);
    return ops;
  }

  it("link_exercises makes a superset with its settings, and the client replays it exactly", async () => {
    const { coachDraft, ws, groups } = groupWs();
    const out = await tool(groups, "link_exercises").run({
      week: 1,
      day: 1,
      exercisePositions: [3, 2],
      rounds: 4,
      restBetweenRoundsSeconds: 90,
    } as never);

    expect(out).toBe("Linked them: Superset · 4 rounds — 1m 30s rest between rounds (positions 2-3).");
    expect(shapeOf(ws.draft)).toEqual([["Back Squat"], ["Bench Press", "Leg Curl"], ["Calf Raise"]]);
    expect(dayOne(ws.draft).groups[1].exercises.map(setSpecCount)).toEqual([4, 4]);
    expect(expectReplayMatches(coachDraft, ws).map((op) => op.type)).toEqual([
      "link_exercises",
      "update_group",
    ]);
  });

  it("link_exercises refuses straight sets with rounds, and fewer than two exercises", async () => {
    const { ws, groups } = groupWs();
    expect(
      await tool(groups, "link_exercises").run({
        week: 1,
        day: 1,
        exercisePositions: [1, 2],
        format: "straight_sets",
        rounds: 3,
      } as never),
    ).toMatch(/Straight sets have no rounds/);
    expect(
      await tool(groups, "link_exercises").run({ week: 1, day: 1, exercisePositions: [2, 2] } as never),
    ).toMatch(/at least two different exercises/);
    expect(ws.ops).toEqual([]);
  });

  it("add_to_group puts an exercise at the end of a group, taking its rounds; a lone anchor is refused", async () => {
    const { coachDraft, ws, groups } = groupWs();
    await tool(groups, "link_exercises").run({ week: 1, day: 1, exercisePositions: [1, 2] } as never);

    expect(
      await tool(groups, "add_to_group").run({
        week: 1,
        day: 1,
        exercisePosition: 3,
        groupExercisePosition: 4,
      } as never),
    ).toMatch(/isn't in a superset, circuit or straight-sets group/);

    const out = await tool(groups, "add_to_group").run({
      week: 1,
      day: 1,
      exerciseName: "Leg Curl",
      groupExercisePosition: 1,
    } as never);
    expect(out).toBe('Added "Leg Curl": Circuit · 3 rounds (positions 1-3).');
    expect(shapeOf(ws.draft)).toEqual([["Back Squat", "Bench Press", "Leg Curl"], ["Calf Raise"]]);
    // Leg Curl had two sets and took the circuit's three rounds.
    expect(dayOne(ws.draft).groups[0].exercises.map(setSpecCount)).toEqual([3, 3, 3]);
    expectReplayMatches(coachDraft, ws);
  });

  it("unlink_exercises takes exercises out in order: the first before its group, any other after it", async () => {
    const { coachDraft, ws, groups } = groupWs();
    await tool(groups, "link_exercises").run({ week: 1, day: 1, exercisePositions: [1, 2, 3] } as never);

    expect(
      await tool(groups, "unlink_exercises").run({ week: 1, day: 1, exercisePositions: [1, 3] } as never),
    ).toBe("Took Back Squat, Leg Curl out of their group.");
    expect(shapeOf(ws.draft)).toEqual([["Back Squat"], ["Bench Press"], ["Leg Curl"], ["Calf Raise"]]);
    // The circuit left with Bench Press alone is a plain exercise again.
    expect(groupSettingsOf(dayOne(ws.draft).groups[1])).toEqual(STRAIGHT_SETS);
    expectReplayMatches(coachDraft, ws);

    expect(
      await tool(groups, "unlink_exercises").run({ week: 1, day: 1, exercisePositions: [4] } as never),
    ).toBe("None of those exercises is in a group.");
  });

  it("move_group moves a whole group and says where it starts", async () => {
    const { coachDraft, ws, groups } = groupWs();
    await tool(groups, "link_exercises").run({ week: 1, day: 1, exercisePositions: [3, 4] } as never);
    expect(
      await tool(groups, "move_group").run({ week: 1, day: 1, exercisePosition: 4, toPosition: 1 } as never),
    ).toBe("Moved it to start at position 1.");
    expect(shapeOf(ws.draft)).toEqual([["Leg Curl", "Calf Raise"], ["Back Squat"], ["Bench Press"]]);
    // Asked to start inside another group, it goes to the nearest boundary.
    await tool(groups, "link_exercises").run({ week: 1, day: 1, exercisePositions: [3, 4] } as never);
    expect(
      await tool(groups, "move_group").run({ week: 1, day: 1, exercisePosition: 3, toPosition: 2 } as never),
    ).toMatch(/starts at position 3, not 2/);
    expectReplayMatches(coachDraft, ws);
  });

  it("update_group changes the format and settings; a lone exercise has none", async () => {
    const { coachDraft, ws, groups } = groupWs();
    await tool(groups, "link_exercises").run({ week: 1, day: 1, exercisePositions: [1, 2] } as never);
    expect(
      await tool(groups, "update_group").run({
        week: 1,
        day: 1,
        exercisePosition: 2,
        format: "straight_sets",
        restBetweenExercisesSeconds: 60,
        notes: "Squat, then bench",
      } as never),
    ).toBe("Updated: Straight sets — 1m rest between exercises — notes: Squat, then bench (positions 1-2).");
    expect(
      await tool(groups, "update_group").run({ week: 1, day: 1, exercisePosition: 4, rounds: 2 } as never),
    ).toMatch(/isn't in a group/);
    expectReplayMatches(coachDraft, ws);
  });

  it("a superset exercise's sets change only with the group's rounds", async () => {
    const { ws, groups, exercises } = groupWs();
    await tool(groups, "link_exercises").run({ week: 1, day: 1, exercisePositions: [1, 2] } as never);

    expect(
      await tool(exercises, "update_exercise").run({ week: 1, day: 1, exercisePosition: 1, sets: 5 } as never),
    ).toMatch(/3-round superset: it has exactly one set per round/);
    expect(
      await tool(exercises, "set_exercise_sets").run({
        week: 1,
        day: 1,
        exercisePosition: 2,
        sets: [{ setType: "working", repsMin: 21, repsMax: 21 }],
      } as never),
    ).toMatch(/send 3 sets, or change the rounds with update_group/);
    expect(
      await tool(exercises, "set_exercise_sets").run({
        week: 1,
        day: 1,
        exercisePosition: 2,
        sets: [
          { setType: "working", repsMin: 21, repsMax: 21 },
          { setType: "working", repsMin: 15, repsMax: 15 },
          { setType: "working", repsMin: 9, repsMax: 9 },
        ],
      } as never),
    ).toMatch(/Programmed 3 sets/);
    expect(dayOne(ws.draft).groups[0].exercises.map(setSpecCount)).toEqual([3, 3]);
  });

  it("reorder_exercise keeps a group's exercise inside its group", async () => {
    const { coachDraft, ws, groups, exercises } = groupWs();
    await tool(groups, "link_exercises").run({ week: 1, day: 1, exercisePositions: [2, 3] } as never);
    expect(
      await tool(exercises, "reorder_exercise").run({
        week: 1,
        day: 1,
        exerciseName: "Leg Curl",
        toPosition: 2,
      } as never),
    ).toBe('Moved "Leg Curl" to position 2.');
    expect(shapeOf(ws.draft)).toEqual([["Back Squat"], ["Leg Curl", "Bench Press"], ["Calf Raise"]]);
    // Sent past its group, it stops at the group's edge.
    expect(
      await tool(exercises, "reorder_exercise").run({
        week: 1,
        day: 1,
        exerciseName: "Leg Curl",
        toPosition: 4,
      } as never),
    ).toMatch(/is at position 3, not 4/);
    expectReplayMatches(coachDraft, ws);
  });

  it("the program state shows a group's heading above its indented exercises, in rounds", async () => {
    const { ws, groups } = groupWs();
    await tool(groups, "link_exercises").run({
      week: 1,
      day: 1,
      exercisePositions: [2, 3],
      restBetweenExercisesSeconds: 0,
    } as never);
    const text = programContext(ws.draft).text;
    expect(text).toContain("    1. Back Squat — 3 sets");
    expect(text).toContain("    Superset · 3 rounds — No rest between exercises");
    expect(text).toContain("      2. Bench Press — 3 rounds");
    expect(text).toContain("      3. Leg Curl — 3 rounds");
    expect(text).toContain("    4. Calf Raise — 3 sets");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// A day holding several sessions: tools name a session by its place in its day,
// the program state lists each with its place, and the session tools follow
// the coach's rules — as ops the client replays identically.
// ═════════════════════════════════════════════════════════════════════════════

// Week 1 day 1 holds an AM run, then a PM lift of squat and bench; day 3 holds
// Upper; every other day is rest.
function makeTwoADayDraft(): ProgramDraft {
  const named = (name: string, groups: ExerciseGroupDraft[]): SessionDraft => ({
    uid: newUid("sess"),
    name,
    focus: null,
    estimatedDurationMinutes: null,
    calorieSurplusPercentage: null,
    notes: null,
    sessionType: "training",
    groups,
  });
  const week = makeRestWeek(0);
  week.days[0] = {
    ...makeRestSlot(0),
    isRest: false,
    sessions: [
      named("AM run", [lone(exercise("Leg Curl", CURL_ID, [workingSet(40)]))]),
      named("PM lift", [
        lone(exercise("Back Squat", SQUAT_ID, [workingSet(100)])),
        lone(exercise("Bench Press", BENCH_ID, [workingSet(80)])),
      ]),
    ],
  };
  week.days[2] = {
    ...makeRestSlot(2),
    isRest: false,
    sessions: [named("Upper", [lone(exercise("Bench Press", BENCH_ID, [workingSet(60)]))])],
  };
  return normalizeDraft({
    id: "44444444-4444-4444-8444-444444444444",
    name: "Hybrid",
    description: null,
    status: "saved",
    splitType: null,
    programDurationWeeks: null,
    defaultSurplusPercentage: null,
    weeks: [week],
  });
}

describe("a day holding several sessions", () => {
  function twoADayWs(target: "library" | "client-draft" = "library") {
    const coachDraft = makeTwoADayDraft();
    const ws = buildWorkspaceFromRows({ target, draft: coachDraft, catalog: CATALOG });
    return { coachDraft, ws };
  }

  const namesOn = (draft: ProgramDraft, d: number) =>
    draft.weeks[0].days[d].sessions.map((s) => s.name);

  // What the client does with a turn: re-validate, then replay onto its own draft.
  function expectReplayMatches(coachDraft: ProgramDraft, ws: DraftWorkspace) {
    const { ops, notes } = finalizeAssistantOps(ws);
    expect(notes).toEqual([]);
    const received = z.array(draftOpSchema).parse(JSON.parse(JSON.stringify(ops)));
    const replayed = applyDraftOps(coachDraft, received, { target: "library" });
    expect(replayed.skipped).toEqual([]);
    expect(replayed.draft).toEqual(ws.draft);
  }

  it("tools address a day's session by its place, the day's first by default", async () => {
    const { ws } = twoADayWs();
    const details = tool(buildSessionTools(ws), "update_session_details");
    expect(await details.run({ week: 1, day: 1, session: 2, notes: "Heavy" } as never)).toBe(
      'Updated "PM lift" (week 1 day 1).',
    );
    expect(await details.run({ week: 1, day: 1, notes: "Easy" } as never)).toBe(
      'Updated "AM run" (week 1 day 1).',
    );
    expect(ws.draft.weeks[0].days[0].sessions.map((s) => s.notes)).toEqual(["Easy", "Heavy"]);

    // Exercise positions count inside the session the place names.
    const update = tool(buildExerciseTools(ws), "update_exercise");
    expect(
      await update.run({ week: 1, day: 1, session: 2, exercisePosition: 2, loadKg: 85 } as never),
    ).toBe('Updated "Bench Press".');
    expect(
      sessionExercises(ws.draft.weeks[0].days[0].sessions[1])[1].setSpecs![0].load_value,
    ).toBe(85);
  });

  it("a place past the day's sessions is an error naming how many the day holds", async () => {
    const { ws } = twoADayWs();
    const getSession = tool(buildReadTools(ws), "get_session");
    expect(await getSession.run({ week: 1, day: 1, session: 3 } as never)).toBe(
      "Week 1 day 1 has only 2 sessions.",
    );
    expect(await getSession.run({ week: 1, day: 3, session: 2 } as never)).toBe(
      "Week 1 day 3 has only 1 session.",
    );
    expect(await getSession.run({ week: 1, day: 2 } as never)).toMatch(/is a rest day/);
    const addToSecond = tool(buildExerciseTools(ws), "add_exercise");
    expect(await addToSecond.run({ week: 1, day: 3, session: 2, name: "Leg Curl" } as never)).toBe(
      "Week 1 day 3 has only 1 session.",
    );
    expect(ws.ops).toEqual([]);
  });

  it("remove_session removes the session it names and the day keeps the rest; the client replays it", async () => {
    const { coachDraft, ws } = twoADayWs();
    const remove = tool(buildSessionTools(ws), "remove_session");
    expect(await remove.run({ week: 1, day: 1, session: 1 } as never)).toBe(
      "Removed \"AM run\" from week 1 day 1; the day's other sessions stay.",
    );
    expect(namesOn(ws.draft, 0)).toEqual(["PM lift"]);

    expect(await remove.run({ week: 1, day: 3 } as never)).toBe(
      'Week 1 day 3 is now a rest day ("Upper" removed).',
    );
    expect(ws.draft.weeks[0].days[2]).toMatchObject({ isRest: true, sessions: [] });

    expect(ws.ops.map((op) => op.type)).toEqual(["remove_session", "remove_session"]);
    // The coach previews a removal before it lands.
    expect(ws.ops.every(isDestructiveOp)).toBe(true);
    expectReplayMatches(coachDraft, ws);
  });

  it("clear_day removes every session on the day and names them", async () => {
    const { ws } = twoADayWs();
    const clear = tool(buildSessionTools(ws), "clear_day");
    expect(await clear.run({ week: 1, day: 1 } as never)).toBe(
      'Week 1 day 1 is now a rest day ("AM run", "PM lift" removed).',
    );
    expect(ws.draft.weeks[0].days[0]).toMatchObject({ isRest: true, sessions: [] });
    expect(ws.ops.map((op) => op.label)).toEqual(['W1 D1: removed "AM run", "PM lift" (now rest)']);
  });

  it("move_session follows the coach's rule: onto a rest day it moves, a lone session swaps, anything else is refused", async () => {
    const { coachDraft, ws } = twoADayWs();
    const move = tool(buildSessionTools(ws), "move_session");
    // The lift shares day 1 with the run: it can't swap with Upper.
    expect(
      await move.run({ fromWeek: 1, fromDay: 1, session: 2, toWeek: 1, toDay: 3 } as never),
    ).toBe("That day already has a session");
    // Upper is alone on day 3, but day 1 holds two.
    expect(await move.run({ fromWeek: 1, fromDay: 3, toWeek: 1, toDay: 1 } as never)).toBe(
      "That day already has a session",
    );
    expect(ws.ops).toEqual([]);

    expect(
      await move.run({ fromWeek: 1, fromDay: 1, session: 2, toWeek: 1, toDay: 5 } as never),
    ).toBe('Moved "PM lift" to week 1 day 5.');
    expect(namesOn(ws.draft, 0)).toEqual(["AM run"]);
    expect(namesOn(ws.draft, 4)).toEqual(["PM lift"]);

    // Alone on day 1 now, the run swaps with Upper.
    expect(await move.run({ fromWeek: 1, fromDay: 1, toWeek: 1, toDay: 3 } as never)).toBe(
      'Moved "AM run" to week 1 day 3 — it swapped places with "Upper".',
    );
    expect(namesOn(ws.draft, 0)).toEqual(["Upper"]);
    expect(namesOn(ws.draft, 2)).toEqual(["AM run"]);
    expectReplayMatches(coachDraft, ws);
  });

  it("add_session still takes only a rest day", async () => {
    const { ws } = twoADayWs();
    const add = tool(buildSessionTools(ws), "add_session");
    expect(await add.run({ week: 1, day: 1, name: "Mobility" } as never)).toBe(
      "That day already has a session",
    );
    expect(ws.ops).toEqual([]);
  });

  it("the program state lists each session of a day with its place; a day's only session carries none", async () => {
    const { ws } = twoADayWs();
    const full = programContext(ws.draft);
    expect(full.complete).toBe(true);
    expect(full.text).toContain('  Day 1 · session 1: "AM run"');
    expect(full.text).toContain('  Day 1 · session 2: "PM lift"');
    expect(full.text).toContain('  Day 3: "Upper"');
    expect(full.text).toContain("  Day 2: rest");
    expect(programSkeleton(ws.draft).split("\n")[1]).toBe(
      "W1: D1 AM run(1ex) + PM lift(2ex) | D2 rest | D3 Upper(1ex) | D4 rest | D5 rest | D6 rest | D7 rest",
    );

    const read = buildReadTools(ws);
    const week = await tool(read, "get_week").run({ week: 1 } as never);
    expect(week).toContain('Day 1 · session 1: "AM run"');
    expect(week).toContain('Day 1 · session 2: "PM lift"');
    expect(week).toContain('Day 3: "Upper"');
    expect(await tool(read, "get_session").run({ week: 1, day: 1, session: 2 } as never)).toMatch(
      /^Week 1 day 1 · session 2: "PM lift"/,
    );
    expect(await tool(read, "get_session").run({ week: 1, day: 3 } as never)).toMatch(
      /^Week 1 day 3: "Upper"/,
    );
  });

  it("duplicate_week copies and progresses every session of a day, and reports across them", async () => {
    const { ws } = twoADayWs();
    const out = await tool(buildWeekTools(ws), "duplicate_week").run({
      week: 1,
      rules: [{ kind: "load_kg", amount: 5 }],
    } as never);
    expect(out).toContain("4/4 in-scope exercises changed");
    expect(out).toContain("Back Squat 100 kg → 105 kg");
    const [am, pm] = ws.draft.weeks[1].days[0].sessions;
    expect([am.name, pm.name]).toEqual(["AM run", "PM lift"]);
    expect(sessionExercises(pm).map((e) => e.setSpecs![0].load_value)).toEqual([105, 85]);
  });

  it("the catalog sweep reads every session: an unresolved exercise new on a day's second session discards the turn", () => {
    const { ws } = twoADayWs();
    const pm = ws.draft.weeks[0].days[0].sessions[1];
    const rogue = lone(exercise("Invented Movement", null, null));
    ws.draft = normalizeDraft(mapSession(ws.draft, pm.uid, (s) => ({ ...s, groups: [...s.groups, rogue] })));
    ws.ops.push({ type: "add_exercise", sessionUid: pm.uid, group: rogue });

    const { ops, notes } = finalizeAssistantOps(ws);
    expect(ops).toEqual([]);
    expect(notes.join(" ")).toMatch(/Invented Movement/);
  });

  it("in the client editor, the identity sweep reads a day's second session too", () => {
    const { ws } = twoADayWs("client-draft");
    const pm = ws.draft.weeks[0].days[0].sessions[1];
    ws.draft = normalizeDraft(mapSession(ws.draft, pm.uid, (s) => ({ ...s, name: "Renamed" })));
    ws.ops.push({ type: "set_program_meta", patch: { description: "cover" } });

    const { ops, notes } = finalizeAssistantOps(ws);
    expect(ops).toEqual([]);
    expect(notes.join(" ")).toMatch(/identity/);
  });
});
