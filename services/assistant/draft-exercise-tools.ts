import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { newUid } from "@/components/clients/training/program-builder/program-builder-types";
import type { ExerciseDraft } from "@/components/clients/training/program-builder/program-builder-types";
import {
  defaultExerciseDraftFromCatalog,
  findSession,
  straightSetsGroup,
} from "@/components/clients/training/program-builder/program-builder-model";
import {
  hiddenColumnsIn,
  isSupersetOrCircuit,
} from "@/components/clients/training/program-builder/program-builder-groups";
import type { SessionDraft } from "@/components/clients/training/program-builder/program-builder-types";
import { countSessionExercises } from "@/utils/exercise-groups";
import { groupName } from "@/utils/exercise-group-display";
import {
  COLUMN_PRESET_FIELDS,
  COLUMN_PRESETS,
  orderColumns,
  presetColumns,
  type ColumnsPreset,
} from "@/utils/column-presets";
import { toExerciseType } from "@/utils/exercise-types";
import {
  isPrescribedField,
  PRESCRIBED_FIELDS,
  resolvePrescribedFields,
  type PrescribedField,
} from "@/utils/prescribed-fields";
import {
  compactFromSpecs,
  expandSetSpecs,
  MAX_SET_SPECS,
  MAX_WORKING_SETS,
  SET_SPEC_MEASURES,
  setSpecCount,
  specMeasures,
  TEMPO_PATTERN,
  type SetSpec,
  type SetSpecMeasure,
  type SetType,
} from "@/utils/exercise-set-specs";
import { PRESCRIBED_FIELD_LABELS } from "@/utils/prescribed-fields";
import {
  matchExerciseInRows,
  suggestExerciseCandidates,
} from "@/services/exercise-catalog-service";
import type { DraftWorkspace } from "./draft-workspace";
import {
  commitOp,
  exerciseGroupAt,
  exercisePositionNow,
  linkedGroupNote,
  reorderDestination,
  resolveExerciseRef,
  resolveSession,
  sessionPlaceProperty,
} from "./draft-tool-helpers";

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
  session: sessionPlaceProperty,
  exercisePosition: {
    type: "integer",
    minimum: 1,
    description: "1-based position in the session (preferred — unambiguous)",
  },
  exerciseName: { type: "string", maxLength: 200 },
} as const;

type LoadInput = {
  loadKg?: number;
  loadKgMax?: number;
  loadPercent1rm?: number;
  loadPercent1rmMax?: number;
};

type LoadRange = { type: "absolute" | "pct_1rm"; min: number; max: number };

// A load is one value or a range: `loadKg` (the value, or the low end) with an
// optional `loadKgMax`; the same for a percentage. A range runs low to high.
function loadFields(input: LoadInput): LoadRange | null | { error: string } {
  if (input.loadKg != null && input.loadPercent1rm != null) {
    return { error: "Pass loadKg OR loadPercent1rm, not both." };
  }
  if (input.loadKg == null && input.loadKgMax != null) {
    return { error: "loadKgMax needs loadKg (the low end of the range)." };
  }
  if (input.loadPercent1rm == null && input.loadPercent1rmMax != null) {
    return { error: "loadPercent1rmMax needs loadPercent1rm (the low end of the range)." };
  }
  const range = (type: LoadRange["type"], min: number, max: number | undefined): LoadRange | { error: string } =>
    max != null && max < min
      ? { error: `A ${type === "absolute" ? "load" : "percentage"} range runs low to high (${min}-${max} doesn't).` }
      : { type, min, max: max ?? min };
  if (input.loadKg != null) return range("absolute", input.loadKg, input.loadKgMax);
  if (input.loadPercent1rm != null) return range("pct_1rm", input.loadPercent1rm, input.loadPercent1rmMax);
  return null;
}

// RPE the same way: `rpe` alone, or `rpe` to `rpeMax`.
function rpeFields(input: { rpe?: number; rpeMax?: number }):
  | { min: number; max: number }
  | null
  | { error: string } {
  if (input.rpe == null) {
    return input.rpeMax != null ? { error: "rpeMax needs rpe (the low end of the range)." } : null;
  }
  const max = input.rpeMax ?? input.rpe;
  if (max < input.rpe) return { error: `An RPE range runs low to high (${input.rpe}-${max} doesn't).` };
  return { min: input.rpe, max };
}

const loadRangeProperties = {
  loadKg: { type: "number", minimum: 0, maximum: 2000, description: "Absolute load in kg — the value, or the low end of a range" },
  loadKgMax: { type: "number", minimum: 0, maximum: 2000, description: "High end of a kg range (loadKg is the low end)" },
  loadPercent1rm: { type: "number", minimum: 0, maximum: 100, description: "% of 1RM — the value, or the low end of a range" },
  loadPercent1rmMax: { type: "number", minimum: 0, maximum: 100, description: "High end of a % 1RM range" },
} as const;

const rpeProperty = {
  type: "number",
  minimum: SET_SPEC_MEASURES.rpe.floor,
  maximum: SET_SPEC_MEASURES.rpe.ceiling,
} as const;

const tempoProperty = {
  type: "string",
  pattern: TEMPO_PATTERN.source,
  description: "Four phases, seconds or X for explosive, written like 3-1-X-0",
} as const;

// The measurement columns an exercise asks its client for, as the coach's
// column selector sets them: the exact list, or a preset by name
// (utils/column-presets.ts). Columns are the exercise's, whatever its sets
// hold, so they apply beside per-set programming.
const columnLabel = (field: PrescribedField) => PRESCRIBED_FIELD_LABELS[field];

const presetGlossary = COLUMN_PRESETS.map(
  (preset) => `${preset} = ${COLUMN_PRESET_FIELDS[preset].map(columnLabel).join(", ")}`,
).join("; ");

const columnsProperties = {
  columns: {
    type: "array",
    minItems: 1,
    maxItems: PRESCRIBED_FIELDS.length,
    uniqueItems: true,
    items: { type: "string", enum: [...PRESCRIBED_FIELDS] },
    description:
      "The exact measurement columns the client fills in for this exercise (a column left out is removed; targets already set stay stored). Or use columnsPreset.",
  },
  columnsPreset: {
    type: "string",
    enum: [...COLUMN_PRESETS],
    description: `Set the columns to a preset's: ${presetGlossary}.`,
  },
} as const;

type ColumnsInput = { columns?: string[]; columnsPreset?: ColumnsPreset };

/**
 * The column list an input asks for, in the builder's order: a preset's
 * (keeping the exercise's stored choice for a column hidden where it sits —
 * Rest in a superset or circuit), or the exact list named; null when the
 * input names neither.
 */
function columnsFields(
  input: ColumnsInput,
  current: ReadonlySet<PrescribedField>,
  hidden: readonly PrescribedField[],
): PrescribedField[] | null | { error: string } {
  if (input.columns != null && input.columnsPreset != null) {
    return { error: "Pass columns OR columnsPreset, not both." };
  }
  if (input.columnsPreset != null) return presetColumns(input.columnsPreset, current, hidden);
  if (input.columns != null) {
    const unknown = input.columns.filter((column) => !isPrescribedField(column));
    if (unknown.length > 0) {
      return { error: `Unknown columns: ${unknown.join(", ")}. The columns are ${PRESCRIBED_FIELDS.join(", ")}.` };
    }
    return orderColumns(input.columns.filter(isPrescribedField));
  }
  return null;
}

const sameColumns = (a: readonly PrescribedField[], b: readonly PrescribedField[]) =>
  a.length === b.length && a.every((field, i) => field === b[i]);

const describeColumns = (fields: readonly PrescribedField[]) => fields.map(columnLabel).join(", ");

// The measures set_exercise_sets can write. Any other target an exercise
// carries — RIR and the endurance measures, which commit 13 teaches the
// assistant — makes the tool refuse rather than rebuild the sets without them.
const WRITABLE_MEASURES: ReadonlySet<SetSpecMeasure> = new Set(["reps", "load", "rpe"]);

function unwritableTargets(exercise: ExerciseDraft): SetSpecMeasure[] {
  const found = new Set<SetSpecMeasure>();
  for (const spec of exercise.setSpecs ?? []) {
    for (const measure of specMeasures(spec)) {
      if (!WRITABLE_MEASURES.has(measure)) found.add(measure);
    }
  }
  return [...found];
}

/**
 * The refusal for a change to how many sets an exercise has when its sets are
 * a superset's or circuit's rounds; null when it isn't in one or keeps them.
 */
function roundsRefusal(session: SessionDraft, exercise: ExerciseDraft, sets: number): string | null {
  const group = exerciseGroupAt(session, exercise.uid)?.group;
  if (!group || !isSupersetOrCircuit(group)) return null;
  const rounds = setSpecCount(exercise);
  if (sets === rounds) return null;
  const name = groupName(group.format, group.exercises.length).toLowerCase();
  return `"${exercise.name}" is in a ${rounds}-round ${name}: it has exactly one set per round, so send ${rounds} sets, or change the rounds with update_group.`;
}

export function buildExerciseTools(ws: DraftWorkspace) {
  const addExercise = betaTool({
    name: "add_exercise",
    description:
      "Add an exercise from the coach's catalog to a session. The name MUST resolve to a real catalog exercise — on a miss you get repair candidates; pick one or use search_exercises. Defaults to 3 working sets on the columns of the exercise's catalog type (its preset: a run starts on endurance, a rower on erg, a carry on carry_sled, a plank on holds), with 8-12 reps where those columns ask for reps; override with the optional prescription fields, or set its measurement columns with columns or columnsPreset. The type is a default, not a rule: any preset or column list the coach names applies to any exercise.",
    inputSchema: {
      type: "object",
      properties: {
        week: { type: "integer", minimum: 1 },
        day: { type: "integer", minimum: 1, maximum: 7 },
        session: sessionPlaceProperty,
        name: { type: "string", minLength: 1, maxLength: 200 },
        sets: { type: "integer", minimum: 1, maximum: 20 },
        repsMin: { type: "integer", minimum: 0, maximum: 100 },
        repsMax: { type: "integer", minimum: 0, maximum: 100 },
        rpeTarget: rpeProperty,
        percentage1rm: { type: "number", minimum: 0, maximum: 100 },
        restSeconds: { type: "integer", minimum: 0, maximum: 600 },
        tempo: tempoProperty,
        notes: { type: "string", maxLength: 500 },
        ...columnsProperties,
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
      const session = resolveSession(ws, input.week, input.day, input.session);
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
      // The exercise starts on its catalog type's preset, as a pick in the
      // builder does; columns or a preset the coach names replace it.
      const base = defaultExerciseDraftFromCatalog({
        name: row.name,
        exerciseId: row.id,
        exerciseType: toExerciseType(row.exercise_type),
      });
      const columns = columnsFields(input, resolvePrescribedFields(base.prescribedFields), []);
      if (columns && "error" in columns) return columns.error;
      const prescribedFields = columns ?? base.prescribedFields;
      // An exercise whose columns don't ask for reps (a run) doesn't start
      // with a rep range hidden behind them; its sets are still its intervals.
      const asksReps = prescribedFields.includes("reps");
      const exercise: ExerciseDraft = {
        ...base,
        uid: newUid("ex"),
        sets: input.sets ?? 3,
        repsMin: input.repsMin ?? (asksReps ? 8 : null),
        repsMax: input.repsMax ?? (asksReps ? 12 : null),
        rpeTarget: input.rpeTarget ?? null,
        percentage1rm: input.percentage1rm ?? null,
        restSeconds: input.restSeconds ?? null,
        tempo: input.tempo ?? null,
        notes: input.notes ?? null,
        prescribedFields,
      };
      const scheme =
        exercise.repsMin != null || exercise.repsMax != null
          ? `${exercise.sets}×${exercise.repsMin ?? ""}-${exercise.repsMax ?? ""}`
          : `${exercise.sets} sets`;
      const err = commitOp(ws, {
        type: "add_exercise",
        sessionUid: session.value.uid,
        // A lone exercise: a straight-sets group of one, its uid minted here
        // so the client replays the same group.
        group: straightSetsGroup(newUid("grp"), exercise),
        label: `W${input.week} D${input.day}: added ${row.name} (${scheme})`,
      });
      if (err) return err;
      // Named whenever they aren't the strength ones — the coach asked for
      // them, or the exercise's type put it there.
      const columnsNote =
        columns || !sameColumns(prescribedFields, COLUMN_PRESET_FIELDS.strength)
          ? ` Columns: ${describeColumns(prescribedFields)}.`
          : "";
      if (input.position != null) {
        // Clamp to the session's real length, and work the place out on the
        // working copy as it now stands: the op carries the place itself, never
        // a position the client would read again.
        const count = countSessionExercises(session.value) + 1;
        const target = Math.min(Math.max(input.position, 1), count);
        const now = findSession(ws.draft, session.value.uid);
        const to = now && reorderDestination(now, exercise.uid, target);
        const reorderErr = to
          ? commitOp(ws, {
              type: "move_exercise",
              sessionUid: session.value.uid,
              exerciseUid: exercise.uid,
              to,
              groupUid: newUid("grp"),
              label: `W${input.week} D${input.day}: ${row.name} to position ${input.position}`,
            })
          : "That exercise no longer exists";
        if (reorderErr) return `Added ${row.name}, but couldn't reposition it: ${reorderErr}`;
        const landed = exercisePositionNow(ws, session.value.uid, exercise.uid);
        if (landed !== target) {
          return `Added "${row.name}" to "${session.value.name}" (week ${input.week} day ${input.day}).${columnsNote} ${linkedGroupNote(row.name, landed, target)}`;
        }
      }
      return `Added "${row.name}" to "${session.value.name}" (week ${input.week} day ${input.day}).${columnsNote}${row.name !== input.name.trim() ? ` (Catalog name used: "${row.name}".)` : ""}`;
    },
  });

  const updateExercise = betaTool({
    name: "update_exercise",
    description:
      "Update an exercise's prescription: set count, rep range, RPE, %1RM, tempo, rest, notes, a uniform working-set load — one value (loadKg / loadPercent1rm) or a range (add loadKgMax / loadPercent1rmMax) — or its measurement columns (columns, or columnsPreset — any preset applies to any exercise, whatever its type). If the exercise has per-set programming, only notes, load and columns changes apply here — reshape its sets with set_exercise_sets instead. Renaming is not supported: remove the exercise and add the right one.",
    inputSchema: {
      type: "object",
      properties: {
        ...exerciseRefProperties,
        sets: { type: "integer", minimum: 1, maximum: 20 },
        repsMin: { type: ["integer", "null"], minimum: 0, maximum: 100 },
        repsMax: { type: ["integer", "null"], minimum: 0, maximum: 100 },
        rpeTarget: { type: ["number", "null"], minimum: SET_SPEC_MEASURES.rpe.floor, maximum: SET_SPEC_MEASURES.rpe.ceiling },
        percentage1rm: { type: ["number", "null"], minimum: 0, maximum: 100 },
        tempo: { type: ["string", "null"], pattern: TEMPO_PATTERN.source, description: tempoProperty.description },
        restSeconds: { type: ["integer", "null"], minimum: 0, maximum: 600 },
        notes: { type: ["string", "null"], maxLength: 500 },
        ...loadRangeProperties,
        ...columnsProperties,
      },
      required: ["week", "day"],
      additionalProperties: false,
    } as const,
    run: (input) => {
      const session = resolveSession(ws, input.week, input.day, input.session);
      if (!session.ok) return session.error;
      const ref = resolveExerciseRef(session.value, input);
      if (!ref.ok) return ref.error;
      const { exercise } = ref.value;

      const load = loadFields(input);
      if (load && "error" in load) return load.error;
      // Columns are the exercise's, so they apply beside per-set programming
      // too. A column hidden where the exercise sits keeps its stored choice
      // under a preset, exactly as the coach's selector keeps it.
      const group = exerciseGroupAt(session.value, exercise.uid)?.group;
      const columns = columnsFields(
        input,
        resolvePrescribedFields(exercise.prescribedFields),
        group ? hiddenColumnsIn(group) : [],
      );
      if (columns && "error" in columns) return columns.error;

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
      if (input.sets !== undefined) {
        const refused = roundsRefusal(session.value, exercise, input.sets);
        if (refused) return refused;
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
        // Every other key on a set is kept as it is.
        const specs = base.setSpecs ?? expandSetSpecs(base);
        const nextSpecs = specs.map((s) =>
          (s.set_type ?? "working") === "working"
            ? { ...s, load_type: load.type, load_min: load.min, load_max: load.max }
            : s,
        );
        const compact = compactFromSpecs(nextSpecs);
        patch.setSpecs = nextSpecs;
        patch.sets = compact.sets;
        patch.repsMin = compact.repsMin;
        patch.repsMax = compact.repsMax;
        if (load.type === "pct_1rm") patch.percentage1rm = load.min;
      }
      if (input.notes !== undefined) patch.notes = input.notes;
      if (columns && !sameColumns(columns, exercise.prescribedFields)) {
        patch.prescribedFields = columns;
      }

      if (Object.keys(patch).length === 0) {
        return columns
          ? `"${exercise.name}" already has those columns (${describeColumns(columns)}).`
          : "Nothing to change — pass at least one field.";
      }
      const err = commitOp(ws, {
        type: "update_exercise",
        sessionUid: session.value.uid,
        exerciseUid: exercise.uid,
        patch,
        label: `W${input.week} D${input.day} ${exercise.name}: updated prescription`,
      });
      if (err) return err;
      return patch.prescribedFields
        ? `Updated "${exercise.name}". Columns: ${describeColumns(patch.prescribedFields)}.`
        : `Updated "${exercise.name}".`;
    },
  });

  const setExerciseSets = betaTool({
    name: "set_exercise_sets",
    description:
      "Replace an exercise's full per-set list (set-by-set programming: warm-ups, working sets, AMRAP/drop/failure finishers, per-set reps/loads/RPE). At least one non-warmup set; max 30 sets, 20 working. Each load and RPE is one value or a range: loadKg (absolute) or loadPercent1rm, with loadKgMax / loadPercent1rmMax for the high end; rpe with rpeMax for the high end. In a superset or circuit each set is one round: send exactly the group's rounds. Refuses an exercise carrying targets this tool can't write (RIR, distance, duration, pace and the other endurance measures) rather than dropping them.",
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
              ...loadRangeProperties,
              rpe: { ...rpeProperty, description: "RPE — the value, or the low end of a range" },
              rpeMax: { ...rpeProperty, description: "High end of an RPE range (rpe is the low end)" },
              tempo: tempoProperty,
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
      const session = resolveSession(ws, input.week, input.day, input.session);
      if (!session.ok) return session.error;
      const ref = resolveExerciseRef(session.value, input);
      if (!ref.ok) return ref.error;
      const { exercise } = ref.value;

      const refused = roundsRefusal(session.value, exercise, input.sets.length);
      if (refused) return refused;
      const unwritable = unwritableTargets(exercise);
      if (unwritable.length > 0) {
        const names = unwritable.map((m) => PRESCRIBED_FIELD_LABELS[m]).join(", ");
        return `"${exercise.name}" carries targets this tool can't write yet (${names}); rebuilding its sets here would drop them. Leave its sets to the coach, or change its notes and loads with update_exercise.`;
      }
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
        const load = loadFields(s);
        if (load && "error" in load) return `Set ${i + 1}: ${load.error}`;
        const rpe = rpeFields(s);
        if (rpe && "error" in rpe) return `Set ${i + 1}: ${rpe.error}`;
        specs.push({
          set_number: i + 1,
          set_type: s.setType as SetType,
          reps_min: s.repsMin ?? null,
          reps_max: s.repsMax ?? null,
          load_type: load?.type ?? null,
          load_min: load?.min ?? null,
          load_max: load?.max ?? null,
          rpe_min: rpe?.min ?? null,
          rpe_max: rpe?.max ?? null,
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
      const session = resolveSession(ws, input.week, input.day, input.session);
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
    description:
      "Move an exercise to a different position within its session. An exercise in a superset, circuit or straight-sets group moves within its group (take it out with unlink_exercises); a standalone exercise never lands inside a group (put it in one with add_to_group).",
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
      const session = resolveSession(ws, input.week, input.day, input.session);
      if (!session.ok) return session.error;
      const ref = resolveExerciseRef(session.value, input);
      if (!ref.ok) return ref.error;
      const to = reorderDestination(session.value, ref.value.exercise.uid, input.toPosition);
      if (!to) return "That exercise no longer exists.";
      const err = commitOp(ws, {
        type: "move_exercise",
        sessionUid: session.value.uid,
        exerciseUid: ref.value.exercise.uid,
        to,
        groupUid: newUid("grp"),
        label: `W${input.week} D${input.day}: ${ref.value.exercise.name} to position ${input.toPosition}`,
      });
      if (err) return err;
      // The op clamps to the session's length; a linked group can move the
      // exercise somewhere else again. Report where it is.
      const asked = Math.min(input.toPosition, countSessionExercises(session.value));
      const landed = exercisePositionNow(ws, session.value.uid, ref.value.exercise.uid);
      return landed === asked
        ? `Moved "${ref.value.exercise.name}" to position ${asked}.`
        : linkedGroupNote(ref.value.exercise.name, landed, asked);
    },
  });

  return [addExercise, updateExercise, setExerciseSets, removeExercise, reorderExercise];
}
