import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { newUid } from "@/components/clients/training/program-builder/program-builder-types";
import type { ExerciseDraft } from "@/components/clients/training/program-builder/program-builder-types";
import { defaultExerciseDraftFromCatalog } from "@/components/clients/training/program-builder/program-builder-model";
import {
  compactFromSpecs,
  expandSetSpecs,
  MAX_SET_SPECS,
  MAX_WORKING_SETS,
  type SetSpec,
  type SetType,
} from "@/utils/exercise-set-specs";
import {
  matchExerciseInRows,
  suggestExerciseCandidates,
} from "@/services/exercise-catalog-service";
import type { DraftWorkspace } from "./draft-workspace";
import { commitOp, resolveExerciseRef, resolveSession } from "./draft-tool-helpers";

// Exercise-level WRITE tools. Two invariants live here:
// - CATALOG CONSTRAINT (the surviving core of the original Phase 6): every
//   added exercise must resolve to a real catalog row via the READ-ONLY
//   matcher. A miss is a tool error with repair candidates — an op with an
//   unresolved exercise is never constructed, and the canonical catalog name
//   replaces the model's spelling so near-duplicate spellings die here.
// - COMPACT PROJECTION (landmine #2): any setSpecs write re-projects
//   sets/repsMin/repsMax via compactFromSpecs in the op payload itself.

const exerciseRefProperties = {
  week: { type: "integer", minimum: 1 },
  day: { type: "integer", minimum: 1, maximum: 7 },
  exercisePosition: {
    type: "integer",
    minimum: 1,
    description: "1-based position in the session (preferred — unambiguous)",
  },
  exerciseName: { type: "string", maxLength: 200 },
} as const;

type LoadInput = {
  loadKg?: number;
  loadPercent1rm?: number;
};

function loadFields(input: LoadInput): { type: "absolute" | "pct_1rm"; value: number } | null | { error: string } {
  if (input.loadKg != null && input.loadPercent1rm != null) {
    return { error: "Pass loadKg OR loadPercent1rm, not both." };
  }
  if (input.loadKg != null) return { type: "absolute", value: input.loadKg };
  if (input.loadPercent1rm != null) return { type: "pct_1rm", value: input.loadPercent1rm };
  return null;
}

export function buildExerciseTools(ws: DraftWorkspace) {
  const addExercise = betaTool({
    name: "add_exercise",
    description:
      "Add an exercise from the coach's catalog to a session. The name MUST resolve to a real catalog exercise — on a miss you get repair candidates; pick one or use search_exercises. Defaults to 3 working sets of 8-12; override with the optional prescription fields.",
    inputSchema: {
      type: "object",
      properties: {
        week: { type: "integer", minimum: 1 },
        day: { type: "integer", minimum: 1, maximum: 7 },
        name: { type: "string", minLength: 1, maxLength: 200 },
        sets: { type: "integer", minimum: 1, maximum: 20 },
        repsMin: { type: "integer", minimum: 0, maximum: 100 },
        repsMax: { type: "integer", minimum: 0, maximum: 100 },
        rpeTarget: { type: "number", minimum: 0, maximum: 10 },
        percentage1rm: { type: "number", minimum: 0, maximum: 100 },
        restSeconds: { type: "integer", minimum: 0, maximum: 600 },
        tempo: { type: "string", maxLength: 20 },
        notes: { type: "string", maxLength: 500 },
        position: {
          type: "integer",
          minimum: 1,
          description: "1-based position to insert at (default: end of the session)",
        },
      },
      required: ["week", "day", "name"],
      additionalProperties: false,
    } as const,
    run: (input) => {
      const session = resolveSession(ws, input.week, input.day);
      if (!session.ok) return session.error;
      const row = matchExerciseInRows(ws.catalog, input.name);
      if (!row) {
        const candidates = suggestExerciseCandidates(ws.catalog, input.name);
        const hint =
          candidates.length > 0
            ? `Closest catalog matches: ${candidates.map((c) => c.name).join(", ")}. Pick one of these, search_exercises for others, or ask the coach.`
            : "No close catalog matches — use search_exercises or ask the coach to add it to their library first.";
        return `"${input.name}" is not in the exercise catalog, so it can't be added. ${hint}`;
      }
      const exercise: ExerciseDraft = {
        ...defaultExerciseDraftFromCatalog({ name: row.name, exerciseId: row.id }),
        uid: newUid("ex"),
        sets: input.sets ?? 3,
        repsMin: input.repsMin ?? 8,
        repsMax: input.repsMax ?? 12,
        rpeTarget: input.rpeTarget ?? null,
        percentage1rm: input.percentage1rm ?? null,
        restSeconds: input.restSeconds ?? null,
        tempo: input.tempo ?? null,
        notes: input.notes ?? null,
      };
      const err = commitOp(ws, {
        type: "add_exercise",
        sessionUid: session.value.uid,
        exercise,
        label: `W${input.week} D${input.day}: added ${row.name} (${exercise.sets}×${exercise.repsMin}-${exercise.repsMax})`,
      });
      if (err) return err;
      if (input.position != null) {
        // Clamp to the session's real length — an out-of-range toIndex is
        // schema-invalid on the client and would discard the whole turn
        // (including the add above) while this tool reported success.
        const count = session.value.exercises.length + 1;
        const target = Math.min(Math.max(input.position, 1), count);
        const reorderErr = commitOp(ws, {
          type: "reorder_exercise",
          sessionUid: session.value.uid,
          exerciseUid: exercise.uid,
          toIndex: target - 1,
          label: `W${input.week} D${input.day}: ${row.name} to position ${input.position}`,
        });
        if (reorderErr) return `Added ${row.name}, but couldn't reposition it: ${reorderErr}`;
      }
      return `Added "${row.name}" to "${session.value.name}" (week ${input.week} day ${input.day}).${row.name !== input.name.trim() ? ` (Catalog name used: "${row.name}".)` : ""}`;
    },
  });

  const updateExercise = betaTool({
    name: "update_exercise",
    description:
      "Update an exercise's prescription: set count, rep range, RPE, %1RM, tempo, rest, notes, or a uniform working-set load (loadKg / loadPercent1rm). If the exercise has per-set programming, only notes and load changes apply here — reshape its sets with set_exercise_sets instead. Renaming is not supported: remove the exercise and add the right one.",
    inputSchema: {
      type: "object",
      properties: {
        ...exerciseRefProperties,
        sets: { type: "integer", minimum: 1, maximum: 20 },
        repsMin: { type: ["integer", "null"], minimum: 0, maximum: 100 },
        repsMax: { type: ["integer", "null"], minimum: 0, maximum: 100 },
        rpeTarget: { type: ["number", "null"], minimum: 0, maximum: 10 },
        percentage1rm: { type: ["number", "null"], minimum: 0, maximum: 100 },
        tempo: { type: ["string", "null"], maxLength: 20 },
        restSeconds: { type: ["integer", "null"], minimum: 0, maximum: 600 },
        notes: { type: ["string", "null"], maxLength: 500 },
        loadKg: { type: "number", minimum: 0, maximum: 2000 },
        loadPercent1rm: { type: "number", minimum: 0, maximum: 100 },
      },
      required: ["week", "day"],
      additionalProperties: false,
    } as const,
    run: (input) => {
      const session = resolveSession(ws, input.week, input.day);
      if (!session.ok) return session.error;
      const ref = resolveExerciseRef(session.value, input);
      if (!ref.ok) return ref.error;
      const { exercise } = ref.value;

      const load = loadFields(input);
      if (load && "error" in load) return load.error;

      const patch: Partial<Omit<ExerciseDraft, "uid">> = {};
      const compactTouch =
        input.sets !== undefined ||
        input.repsMin !== undefined ||
        input.repsMax !== undefined ||
        input.rpeTarget !== undefined ||
        input.percentage1rm !== undefined ||
        input.tempo !== undefined ||
        input.restSeconds !== undefined;

      if (exercise.setSpecs && compactTouch) {
        return `"${exercise.name}" has per-set programming (${exercise.setSpecs.length} sets) — read it with get_session and reshape it with set_exercise_sets; only notes and loadKg/loadPercent1rm apply here.`;
      }

      // ORDER IS LOAD-BEARING: compact fields land FIRST, then a load
      // materializes specs from the POST-patch values. Materializing first
      // would expand stale sets/reps and the later compact writes would then
      // contradict the specs the same op ships (landmine #2) — "5 sets of 5 at
      // 100kg" on a 3×8-12 exercise silently reverted to 3×8-12 on save.
      const base: ExerciseDraft = { ...exercise };
      if (!exercise.setSpecs) {
        if (input.sets !== undefined) base.sets = input.sets;
        if (input.repsMin !== undefined) base.repsMin = input.repsMin;
        if (input.repsMax !== undefined) base.repsMax = input.repsMax;
        if (input.rpeTarget !== undefined) base.rpeTarget = input.rpeTarget;
        if (input.percentage1rm !== undefined) base.percentage1rm = input.percentage1rm;
        if (input.tempo !== undefined) base.tempo = input.tempo;
        if (input.restSeconds !== undefined) base.restSeconds = input.restSeconds;
        if (input.sets !== undefined) patch.sets = base.sets;
        if (input.repsMin !== undefined) patch.repsMin = base.repsMin;
        if (input.repsMax !== undefined) patch.repsMax = base.repsMax;
        if (input.rpeTarget !== undefined) patch.rpeTarget = base.rpeTarget;
        if (input.percentage1rm !== undefined) patch.percentage1rm = base.percentage1rm;
        if (input.tempo !== undefined) patch.tempo = base.tempo;
        if (input.restSeconds !== undefined) patch.restSeconds = base.restSeconds;
      }

      if (load) {
        // Uniform working-set load. Compact-only exercises materialize their
        // specs here (that's what "set bench to 100kg" means on one) — from
        // `base`, so the specs carry the sets/reps the coach just asked for.
        const specs = base.setSpecs ?? expandSetSpecs(base);
        const nextSpecs = specs.map((s) =>
          (s.set_type ?? "working") === "working"
            ? { ...s, load_type: load.type, load_value: load.value }
            : s,
        );
        const compact = compactFromSpecs(nextSpecs);
        patch.setSpecs = nextSpecs;
        patch.sets = compact.sets;
        patch.repsMin = compact.repsMin;
        patch.repsMax = compact.repsMax;
        if (load.type === "pct_1rm") patch.percentage1rm = load.value;
      }
      if (input.notes !== undefined) patch.notes = input.notes;

      if (Object.keys(patch).length === 0) return "Nothing to change — pass at least one field.";
      const err = commitOp(ws, {
        type: "update_exercise",
        sessionUid: session.value.uid,
        exerciseUid: exercise.uid,
        patch,
        label: `W${input.week} D${input.day} ${exercise.name}: updated prescription`,
      });
      return err ?? `Updated "${exercise.name}".`;
    },
  });

  const setExerciseSets = betaTool({
    name: "set_exercise_sets",
    description:
      "Replace an exercise's full per-set list (set-by-set programming: warm-ups, working sets, AMRAP/drop/failure finishers, per-set reps/loads/RPE). At least one non-warmup set; max 30 sets, 20 working. Loads: loadKg (absolute) or loadPercent1rm, one per set.",
    inputSchema: {
      type: "object",
      properties: {
        ...exerciseRefProperties,
        sets: {
          type: "array",
          minItems: 1,
          maxItems: 30,
          items: {
            type: "object",
            properties: {
              setType: {
                type: "string",
                enum: ["warmup", "working", "amrap", "drop", "failure"],
              },
              repsMin: { type: "integer", minimum: 0, maximum: 100 },
              repsMax: { type: "integer", minimum: 0, maximum: 100 },
              repsTarget: { type: "string", maxLength: 20 },
              loadKg: { type: "number", minimum: 0, maximum: 2000 },
              loadPercent1rm: { type: "number", minimum: 0, maximum: 100 },
              rpe: { type: "number", minimum: 0, maximum: 10 },
              tempo: { type: "string", maxLength: 20 },
              restSeconds: { type: "integer", minimum: 0, maximum: 3600 },
            },
            required: ["setType"],
            additionalProperties: false,
          },
        },
      },
      required: ["week", "day", "sets"],
      additionalProperties: false,
    } as const,
    run: (input) => {
      const session = resolveSession(ws, input.week, input.day);
      if (!session.ok) return session.error;
      const ref = resolveExerciseRef(session.value, input);
      if (!ref.ok) return ref.error;
      const { exercise } = ref.value;

      const working = input.sets.filter((s) => s.setType !== "warmup").length;
      if (working === 0) return "At least one non-warmup set is required.";
      if (working > MAX_WORKING_SETS) {
        return `Maximum ${MAX_WORKING_SETS} working sets per exercise (got ${working}).`;
      }
      if (input.sets.length > MAX_SET_SPECS) {
        return `Maximum ${MAX_SET_SPECS} sets per exercise.`;
      }

      const specs: SetSpec[] = [];
      for (const [i, s] of input.sets.entries()) {
        if (s.loadKg != null && s.loadPercent1rm != null) {
          return `Set ${i + 1}: pass loadKg OR loadPercent1rm, not both.`;
        }
        specs.push({
          set_number: i + 1,
          set_type: s.setType as SetType,
          reps_min: s.repsMin ?? null,
          reps_max: s.repsMax ?? null,
          reps_target: s.repsTarget ?? null,
          load_type: s.loadKg != null ? "absolute" : s.loadPercent1rm != null ? "pct_1rm" : null,
          load_value: s.loadKg ?? s.loadPercent1rm ?? null,
          rpe_target: s.rpe ?? null,
          tempo: s.tempo ?? null,
          rest_seconds: s.restSeconds ?? null,
          drops: null,
        });
      }
      const compact = compactFromSpecs(specs);
      const err = commitOp(ws, {
        type: "update_exercise",
        sessionUid: session.value.uid,
        exerciseUid: exercise.uid,
        patch: {
          setSpecs: specs,
          sets: compact.sets,
          repsMin: compact.repsMin,
          repsMax: compact.repsMax,
        },
        label: `W${input.week} D${input.day} ${exercise.name}: ${specs.length} sets programmed`,
      });
      return err ?? `Programmed ${specs.length} sets (${working} working) on "${exercise.name}".`;
    },
  });

  const removeExercise = betaTool({
    name: "remove_exercise",
    description: "Remove an exercise from a session.",
    inputSchema: {
      type: "object",
      properties: { ...exerciseRefProperties },
      required: ["week", "day"],
      additionalProperties: false,
    } as const,
    run: (input) => {
      const session = resolveSession(ws, input.week, input.day);
      if (!session.ok) return session.error;
      const ref = resolveExerciseRef(session.value, input);
      if (!ref.ok) return ref.error;
      const err = commitOp(ws, {
        type: "remove_exercise",
        sessionUid: session.value.uid,
        exerciseUid: ref.value.exercise.uid,
        label: `W${input.week} D${input.day}: removed ${ref.value.exercise.name}`,
      });
      return err ?? `Removed "${ref.value.exercise.name}" from "${session.value.name}".`;
    },
  });

  const reorderExercise = betaTool({
    name: "reorder_exercise",
    description: "Move an exercise to a different position within its session.",
    inputSchema: {
      type: "object",
      properties: {
        ...exerciseRefProperties,
        toPosition: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["week", "day", "toPosition"],
      additionalProperties: false,
    } as const,
    run: (input) => {
      const session = resolveSession(ws, input.week, input.day);
      if (!session.ok) return session.error;
      const ref = resolveExerciseRef(session.value, input);
      if (!ref.ok) return ref.error;
      const err = commitOp(ws, {
        type: "reorder_exercise",
        sessionUid: session.value.uid,
        exerciseUid: ref.value.exercise.uid,
        toIndex: input.toPosition - 1,
        label: `W${input.week} D${input.day}: ${ref.value.exercise.name} to position ${input.toPosition}`,
      });
      return err ?? `Moved "${ref.value.exercise.name}" to position ${input.toPosition}.`;
    },
  });

  return [addExercise, updateExercise, setExerciseSets, removeExercise, reorderExercise];
}
