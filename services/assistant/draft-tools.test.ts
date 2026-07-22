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

import type { ExerciseRow } from "@/lib/database-helpers";
import {
  makeRestSlot,
  makeRestWeek,
  newUid,
  type ExerciseDraft,
  type ProgramDraft,
  type SessionDraft,
} from "@/components/clients/training/program-builder/program-builder-types";
import { normalizeDraft } from "@/components/clients/training/program-builder/program-builder-model";
import type { SetSpec } from "@/utils/exercise-set-specs";
import { buildWorkspaceFromRows, finalizeAssistantOps } from "./draft-workspace";
import { programContext } from "./draft-tool-helpers";
import { buildWeekTools } from "./draft-week-tools";
import { buildSessionTools } from "./draft-session-tools";
import { buildExerciseTools } from "./draft-exercise-tools";

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
    supersetGroup: null,
    isWarmup: false,
    notes: null,
    videoUrl: null,
  };
}

function makeDraft(): ProgramDraft {
  const session: SessionDraft = {
    uid: newUid("sess"),
    name: "Lower A",
    focus: "legs",
    estimatedDurationMinutes: null,
    calorieSurplusPercentage: null,
    notes: null,
    sessionType: "training",
    exercises: [
      exercise("Back Squat", SQUAT_ID, [workingSet(100), workingSet(100)]),
      exercise("Leg Curl", CURL_ID, [workingSet(40), workingSet(40)]),
    ],
  };
  const week = makeRestWeek(0);
  week.days[0] = { ...makeRestSlot(0), isRest: false, session };
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
  const session = ws.draft.weeks[weekIndex].days[0].session;
  return (session?.exercises[0].setSpecs ?? []).map((s) => s.load_value ?? -1);
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
    const setCount = (w: number) =>
      ws.draft.weeks[w].days[0].session?.exercises[0].setSpecs?.length;
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
    const session = ws.draft.weeks[1].days[0].session!;
    expect(session.exercises[0].setSpecs?.[0].load_value).toBe(105); // Back Squat (Compound)
    expect(session.exercises[1].setSpecs?.[0].load_value).toBe(40); // Leg Curl untouched
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
    expect(op.exercise.exerciseId).toBe(BENCH_ID);
    expect(op.exercise.name).toBe("Bench Press");
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
    const rogue = exercise("Invented Movement", null, null);
    const sessionUid = ws.draft.weeks[0].days[0].session!.uid;
    ws.draft = normalizeDraft({
      ...ws.draft,
      weeks: ws.draft.weeks.map((w) => ({
        ...w,
        days: w.days.map((slot) =>
          slot.session?.uid === sessionUid
            ? {
                ...slot,
                session: {
                  ...slot.session,
                  exercises: [...slot.session.exercises, rogue],
                },
              }
            : slot,
        ),
      })),
    });
    ws.ops.push({ type: "add_exercise", sessionUid, exercise: rogue });

    const { ops, notes } = finalizeAssistantOps(ws);
    expect(ops).toEqual([]);
    expect(notes.join(" ")).toMatch(/Invented Movement/);
  });

  it("keeps clones of pre-existing content even when their exerciseId is null", () => {
    const ws = buildWorkspaceFromRows({
      target: "library",
      draft: (() => {
        const d = makeDraft();
        d.weeks[0].days[0].session!.exercises[0] = exercise("Coach Special", null, null);
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
    const sessionUid = ws.draft.weeks[0].days[0].session!.uid;
    ws.draft = normalizeDraft({
      ...ws.draft,
      weeks: ws.draft.weeks.map((w) => ({
        ...w,
        days: w.days.map((slot) =>
          slot.session?.uid === sessionUid
            ? {
                ...slot,
                session: {
                  ...slot.session,
                  exercises: [exercise("Back Squat", SQUAT_ID, null)],
                },
              }
            : slot,
        ),
      })),
    });

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
    ws.draft = normalizeDraft({
      ...ws.draft,
      weeks: ws.draft.weeks.map((w) => ({
        ...w,
        days: w.days.map((slot) =>
          slot.session
            ? { ...slot, session: { ...slot.session, name: longName } }
            : slot,
        ),
      })),
    });
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
          session: {
            uid: newUid("sess"),
            name: `Session ${i}`,
            focus: "full body",
            estimatedDurationMinutes: 60,
            calorieSurplusPercentage: null,
            notes: null,
            sessionType: "training",
            exercises: Array.from({ length: 8 }, () =>
              exercise("Back Squat", SQUAT_ID, [workingSet(100)]),
            ),
          },
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
    const sessionUid = ws.draft.weeks[0].days[0].session!.uid;
    ws.draft = normalizeDraft({
      ...ws.draft,
      weeks: ws.draft.weeks.map((w) => ({
        ...w,
        days: w.days.map((slot) =>
          slot.session?.uid === sessionUid
            ? {
                ...slot,
                session: {
                  ...slot.session,
                  exercises: [exercise("Back Squat", SQUAT_ID, [workingSet(80)])],
                },
              }
            : slot,
        ),
      })),
    });

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
      ws.draft.weeks[w].days[0].session!.exercises[0].setSpecs![0].load_value;
    expect([loads(1), loads(2), loads(3)]).toEqual([84, 88, 92.5]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Placed-plan target: past-slot locking (ops ctx + the locked sweep), with
// identity deliberately editable.
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
    exercises: [exercise("Back Squat", SQUAT_ID, [workingSet(100)])],
  };
  const future: SessionDraft = {
    uid: newUid("sess"),
    name: "Lower B",
    focus: "legs",
    estimatedDurationMinutes: null,
    calorieSurplusPercentage: null,
    notes: null,
    sessionType: "training",
    exercises: [exercise("Leg Curl", CURL_ID, [workingSet(40)])],
  };
  const week0 = makeRestWeek(0);
  week0.days[0] = { ...makeRestSlot(0), isRest: false, session: past };
  const week1 = makeRestWeek(1);
  week1.days[0] = { ...makeRestSlot(0), isRest: false, session: future };
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

function makePlacedWs(extraLockedUids: string[] = []) {
  const draft = makePlacedDraft();
  // Week 1 is history.
  const lockedSlotUids = [...draft.weeks[0].days.map((d) => d.uid), ...extraLockedUids];
  return buildWorkspaceFromRows({
    target: "placed-plan",
    draft,
    catalog: CATALOG,
    lockedSlotUids,
  });
}

describe("placed-plan locked slots (tool executors)", () => {
  it("edits touching a locked day are skipped; the same edit on a future day lands", async () => {
    const ws = makePlacedWs();
    const update = tool(buildExerciseTools(ws), "update_exercise");

    const refused = await update.run({
      week: 1,
      day: 1,
      exerciseName: "Back Squat",
      loadKg: 90,
    } as never);
    expect(refused).toMatch(/locked/);
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

  it("structural ops on history are skipped (delete_week / clear_day)", async () => {
    const ws = makePlacedWs();
    const del = tool(buildWeekTools(ws), "delete_week");
    expect(await del.run({ week: 1 } as never)).toMatch(/locked/);

    const clear = tool(buildSessionTools(ws), "clear_day");
    expect(await clear.run({ week: 1, day: 1 } as never)).toMatch(/locked/);
    expect(ws.ops).toHaveLength(0);
  });

  it("renames ARE allowed on placed plans (identity sweep not applied)", async () => {
    const ws = makePlacedWs();
    const program = tool(buildSessionTools(ws), "update_program");
    const session = tool(buildSessionTools(ws), "update_session_details");

    expect(await program.run({ name: "Renamed Block" } as never)).not.toMatch(/identity/);
    // A FUTURE session's rename lands too.
    expect(
      await session.run({ week: 2, day: 1, name: "Lower B2" } as never),
    ).toMatch(/Updated/);

    const finalized = finalizeAssistantOps(ws);
    expect(finalized.ops.length).toBeGreaterThan(0);
    expect(finalized.notes).toHaveLength(0);
  });

  it("unknown lock uids from the wire are ignored", () => {
    const ws = makePlacedWs(["slot-not-in-this-draft"]);
    expect(ws.lockedSlotUids.has("slot-not-in-this-draft")).toBe(false);
    const finalized = finalizeAssistantOps(ws);
    expect(finalized.notes).toHaveLength(0);
  });
});

describe("placed-plan locked sweep (finalizeAssistantOps)", () => {
  it("discards the turn when a locked slot's content changed despite the guards", () => {
    const ws = makePlacedWs();
    // Simulate an executor bug mutating history directly (bypassing commitOp).
    ws.draft = normalizeDraft({
      ...ws.draft,
      weeks: ws.draft.weeks.map((w, i) =>
        i !== 0
          ? w
          : {
              ...w,
              days: w.days.map((slot) =>
                slot.session
                  ? { ...slot, session: { ...slot.session, name: "Rewritten History" } }
                  : slot,
              ),
            },
      ),
    });

    const finalized = finalizeAssistantOps(ws);
    expect(finalized.ops).toHaveLength(0);
    expect(finalized.notes.join(" ")).toMatch(/already happened/);
  });

  it("discards the turn when a locked slot vanished (its week removed)", () => {
    const ws = makePlacedWs();
    ws.draft = normalizeDraft({ ...ws.draft, weeks: ws.draft.weeks.slice(1) });

    const finalized = finalizeAssistantOps(ws);
    expect(finalized.ops).toHaveLength(0);
    expect(finalized.notes.join(" ")).toMatch(/already happened/);
  });

  it("ships the ops when history is untouched", async () => {
    const ws = makePlacedWs();
    const update = tool(buildExerciseTools(ws), "update_exercise");
    await update.run({ week: 2, day: 1, exerciseName: "Leg Curl", loadKg: 45 } as never);

    const finalized = finalizeAssistantOps(ws);
    expect(finalized.ops).toHaveLength(1);
    expect(finalized.notes).toHaveLength(0);
  });
});
