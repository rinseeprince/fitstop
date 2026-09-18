import { applySetSpecEdit } from "@/utils/set-spec-edits";
import {
  MAX_SET_SPECS,
  MAX_WORKING_SETS,
  expandSetSpecs,
  setSpecCount,
} from "@/utils/exercise-set-specs";
import { isWorkingSpec } from "@/utils/progression-rules";
import {
  GROUP_NOTES_MAX,
  GROUP_REST_SECONDS_MAX,
  STRAIGHT_SETS,
  sessionExercises,
} from "@/utils/exercise-groups";
import { presetColumns, presetOf, type ColumnsPreset } from "@/utils/column-presets";
import { resolvePrescribedFields, type PrescribedField } from "@/utils/prescribed-fields";
import type {
  ExerciseDraft,
  ExerciseGroupDraft,
  SessionDraft,
} from "./program-builder-types";

// Supersets, circuits and linked straight sets in the builder
// (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md section 4.2). Pure and React-free:
// the builder's mutators and the assistant's ops (program-builder-ops.ts, run
// by the server executors and replayed by the client) make every group edit
// through these functions, so a hand edit and an assistant edit cannot differ.
//
// Three rules hold after every edit (normalizeGroups, and the write schemas in
// lib/validations/training.ts refuse anything else):
// - a group of one is a plain exercise: straight sets with nothing set;
// - in a superset or circuit every exercise has one set per round, so each
//   round keeps its own targets and the client logs a round as a row;
// - a group stores no setting its format doesn't use.
//
// Nothing here mints a uid: callers pass the uids new groups take, so the
// server's working copy and the client's replay stay identical.

export type GroupEditResult =
  | { ok: true; session: SessionDraft }
  | { ok: false; reason: string };

/**
 * Where a moved exercise lands, counted in the session as it stands before the
 * move: inside a linked group before its exercise at `index` (its length is the
 * end), or standalone before the session's group at `index`.
 */
export type ExerciseDestination =
  | { kind: "group"; groupUid: string; index: number }
  | { kind: "session"; index: number };

/**
 * The settings a coach edits on a linked group. `columnsPreset` applies a
 * column preset to every exercise in the group (utils/column-presets.ts) —
 * "a preset applies to one exercise or a whole group" — in the same edit as
 * any setting, so a format switch and the preset land in one commit.
 */
export type GroupSettingsPatch = {
  format?: "straight_sets" | "circuit";
  rounds?: number;
  restBetweenExercisesSeconds?: number | null;
  restBetweenRoundsSeconds?: number | null;
  notes?: string | null;
  columnsPreset?: ColumnsPreset;
};

/** The columns the selector doesn't offer where an exercise sits: Rest in a superset or circuit. */
export function hiddenColumnsIn(group: {
  format: string;
  exercises: ReadonlyArray<unknown>;
}): readonly PrescribedField[] {
  return isSupersetOrCircuit(group) ? ["rest"] : [];
}

/**
 * The preset every exercise in a linked group is on, under the group's hidden
 * columns; null when they differ or any is on none. What the group heading's
 * Columns menu ticks.
 */
export function groupColumnsPreset(group: ExerciseGroupDraft): ColumnsPreset | null {
  const hidden = hiddenColumnsIn(group);
  const presets = group.exercises.map((exercise) => presetOf(exercise.prescribedFields, hidden));
  const first = presets[0] ?? null;
  return first != null && presets.every((preset) => preset === first) ? first : null;
}

/**
 * `exercise` on a preset's columns, keeping its stored choice for a column
 * hidden where it sits; the same reference when its columns already are those.
 */
function applyColumnsPreset(
  exercise: ExerciseDraft,
  preset: ColumnsPreset,
  hidden: readonly PrescribedField[],
): ExerciseDraft {
  const current = resolvePrescribedFields(exercise.prescribedFields);
  const next = presetColumns(preset, current, hidden);
  const same =
    next.length === exercise.prescribedFields.length &&
    next.every((field, i) => field === exercise.prescribedFields[i]);
  return same ? exercise : { ...exercise, prescribedFields: next };
}

/** A superset (two exercises) or circuit (three or more): its exercises' sets are its rounds. */
export function isSupersetOrCircuit(group: {
  format: string;
  exercises: ReadonlyArray<unknown>;
}): boolean {
  return group.format === "circuit" && group.exercises.length > 1;
}

const clampIndex = (index: number, length: number) =>
  Math.max(0, Math.min(length, Math.trunc(index)));

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function loneGroup(uid: string, exercise: ExerciseDraft): ExerciseGroupDraft {
  return { uid, ...STRAIGHT_SETS, exercises: [exercise] };
}

// A group keeps only the settings its format uses. AMRAP, EMOM and For time
// arrive with commits 14-15 and are left as they are.
function normalizeGroupSettings(group: ExerciseGroupDraft): ExerciseGroupDraft {
  if (group.exercises.length === 1) return { ...group, ...STRAIGHT_SETS };
  switch (group.format) {
    case "straight_sets":
      return {
        ...group,
        rounds: null,
        timeCapSeconds: null,
        intervalSeconds: null,
        restBetweenRoundsSeconds: null,
      };
    case "circuit":
      return { ...group, timeCapSeconds: null, intervalSeconds: null };
    default:
      return group;
  }
}

/**
 * A session's groups under the three rules: a group left with no exercises
 * goes, a group of one is a plain exercise, and no group stores a setting its
 * format doesn't use.
 */
export function normalizeGroups(groups: ExerciseGroupDraft[]): ExerciseGroupDraft[] {
  return groups.filter((group) => group.exercises.length > 0).map(normalizeGroupSettings);
}

const withGroups = (session: SessionDraft, groups: ExerciseGroupDraft[]): GroupEditResult => ({
  ok: true,
  session: { ...session, groups: normalizeGroups(groups) },
});

/**
 * `exercise` with exactly `sets` sets: copies of its last set added, or its
 * last sets removed, through the per-set edit kernel so every per-set rule
 * holds. The same reference when it already has that many.
 */
export function fitExerciseSets(
  exercise: ExerciseDraft,
  sets: number,
): { ok: true; exercise: ExerciseDraft } | { ok: false; reason: string } {
  if (!Number.isInteger(sets) || sets < 1 || sets > MAX_SET_SPECS) {
    return { ok: false, reason: `Rounds must be between 1 and ${MAX_SET_SPECS}` };
  }
  let current = exercise;
  let count = setSpecCount(current);
  while (count !== sets) {
    const result =
      count < sets
        ? applySetSpecEdit(current, { kind: "add-set", afterIndex: count - 1 })
        : applySetSpecEdit(current, { kind: "remove-set", index: count - 1 });
    if (!result.ok) return { ok: false, reason: `${exercise.name}: ${result.reason}` };
    current = result.exercise;
    count += count < sets ? 1 : -1;
  }
  return { ok: true, exercise: current };
}

function fitAll(
  exercises: ExerciseDraft[],
  sets: number,
): { ok: true; exercises: ExerciseDraft[] } | { ok: false; reason: string } {
  const fitted: ExerciseDraft[] = [];
  for (const exercise of exercises) {
    const result = fitExerciseSets(exercise, sets);
    if (!result.ok) return result;
    fitted.push(result.exercise);
  }
  return { ok: true, exercises: fitted };
}

const mostSets = (exercises: ExerciseDraft[]) => Math.max(...exercises.map(setSpecCount));

/**
 * Link exercises into one new superset or circuit, where the first of them
 * was, in session order. It takes as many rounds as the exercise with the most
 * sets has, and an exercise with fewer gets copies of its last set. An exercise
 * taken from another group leaves it.
 */
export function linkExercises(
  session: SessionDraft,
  exerciseUids: readonly string[],
  groupUid: string,
): GroupEditResult {
  const picked = new Set(exerciseUids);
  const linked = sessionExercises(session).filter((exercise) => picked.has(exercise.uid));
  if (linked.length !== picked.size) {
    return { ok: false, reason: "That exercise no longer exists" };
  }
  if (linked.length < 2) return { ok: false, reason: "Pick at least two exercises to link" };

  const rounds = mostSets(linked);
  const fitted = fitAll(linked, rounds);
  if (!fitted.ok) return fitted;

  const first = linked[0].uid;
  const at = session.groups.findIndex((group) => group.exercises.some((e) => e.uid === first));
  // The first exercise's group keeps any exercises before it, so the new group
  // follows them; the groups before it hold none of the linked exercises.
  const keepsEarlierExercises = session.groups[at].exercises[0].uid !== first;
  const groups = session.groups.map((group) => ({
    ...group,
    exercises: group.exercises.filter((exercise) => !picked.has(exercise.uid)),
  }));
  groups.splice(at + (keepsEarlierExercises ? 1 : 0), 0, {
    uid: groupUid,
    ...STRAIGHT_SETS,
    format: "circuit",
    rounds,
    exercises: fitted.exercises,
  });
  return withGroups(session, groups);
}

/**
 * Every exercise of a linked group becomes a plain exercise in the same place,
 * keeping its sets; `groupUids` names their groups, one per exercise.
 */
export function unlinkGroup(
  session: SessionDraft,
  groupUid: string,
  groupUids: readonly string[],
): GroupEditResult {
  const at = session.groups.findIndex((group) => group.uid === groupUid);
  if (at < 0) return { ok: false, reason: "That group no longer exists" };
  const group = session.groups[at];
  if (group.exercises.length < 2) return { ok: true, session };
  if (groupUids.length < group.exercises.length) {
    throw new Error("unlinkGroup needs one group uid per exercise");
  }
  const groups = [...session.groups];
  groups.splice(at, 1, ...group.exercises.map((exercise, i) => loneGroup(groupUids[i], exercise)));
  return withGroups(session, groups);
}

/**
 * Move an exercise. Into a linked group it joins that group, and in a superset
 * or circuit it takes the group's rounds; to a place among the session's groups
 * it stands alone — in a group of its own named `groupUid`, or its own group
 * when it already stood alone. The same session when it lands where it is.
 */
export function moveExercise(
  session: SessionDraft,
  exerciseUid: string,
  to: ExerciseDestination,
  groupUid: string,
): GroupEditResult {
  const fromAt = session.groups.findIndex((group) =>
    group.exercises.some((exercise) => exercise.uid === exerciseUid),
  );
  if (fromAt < 0) return { ok: false, reason: "That exercise no longer exists" };
  const from = session.groups[fromAt];
  const fromIndex = from.exercises.findIndex((exercise) => exercise.uid === exerciseUid);
  const exercise = from.exercises[fromIndex];

  if (to.kind === "group") {
    const target = session.groups.find((group) => group.uid === to.groupUid);
    if (!target) return { ok: false, reason: "That group no longer exists" };
    if (target.exercises.length < 2) {
      return { ok: false, reason: "That exercise isn't linked to anything — link them instead" };
    }
    const at = clampIndex(to.index, target.exercises.length);
    if (target === from) {
      const index = at > fromIndex ? at - 1 : at;
      if (index === fromIndex) return { ok: true, session };
      const groups = [...session.groups];
      groups[fromAt] = { ...from, exercises: moveItem(from.exercises, fromIndex, index) };
      return withGroups(session, groups);
    }
    let joining = exercise;
    if (isSupersetOrCircuit(target) && target.rounds != null) {
      const fitted = fitExerciseSets(exercise, target.rounds);
      if (!fitted.ok) return fitted;
      joining = fitted.exercise;
    }
    const groups = session.groups.map((group) => {
      if (group === from) {
        return { ...group, exercises: group.exercises.filter((e) => e.uid !== exerciseUid) };
      }
      if (group !== target) return group;
      const exercises = [...group.exercises];
      exercises.splice(at, 0, joining);
      return { ...group, exercises };
    });
    return withGroups(session, groups);
  }

  const at = clampIndex(to.index, session.groups.length);
  if (from.exercises.length === 1) {
    const index = at > fromAt ? at - 1 : at;
    if (index === fromAt) return { ok: true, session };
    return withGroups(session, moveItem(session.groups, fromAt, index));
  }
  const groups = session.groups.map((group) =>
    group === from
      ? { ...group, exercises: group.exercises.filter((e) => e.uid !== exerciseUid) }
      : group,
  );
  groups.splice(at, 0, loneGroup(groupUid, exercise));
  return withGroups(session, groups);
}

/**
 * Move a whole group, lone or linked, to before the session's group at
 * `index`. The same session when it lands where it is.
 */
export function moveGroup(session: SessionDraft, groupUid: string, index: number): GroupEditResult {
  const from = session.groups.findIndex((group) => group.uid === groupUid);
  if (from < 0) return { ok: false, reason: "That group no longer exists" };
  const at = clampIndex(index, session.groups.length);
  const to = at > from ? at - 1 : at;
  if (to === from) return { ok: true, session };
  return withGroups(session, moveItem(session.groups, from, to));
}

const inRange = (value: number, max: number) =>
  Number.isInteger(value) && value >= 0 && value <= max;

/**
 * Change a linked group's settings. A superset or circuit fits every exercise
 * to its rounds (becoming one, it takes the rounds of the exercise with the
 * most sets unless the patch says otherwise); straight sets store no rounds
 * and no rest between rounds. The same session when nothing changes.
 */
export function updateGroup(
  session: SessionDraft,
  groupUid: string,
  patch: GroupSettingsPatch,
): GroupEditResult {
  const at = session.groups.findIndex((group) => group.uid === groupUid);
  if (at < 0) return { ok: false, reason: "That group no longer exists" };
  const group = session.groups[at];
  if (group.exercises.length < 2) {
    return { ok: false, reason: "A single exercise has no group settings" };
  }
  const format = patch.format ?? group.format;
  if (format !== "straight_sets" && format !== "circuit") {
    return { ok: false, reason: "Only supersets, circuits and straight sets can be changed here" };
  }
  const rest = (value: number | null | undefined, fallback: number | null) =>
    value === undefined ? fallback : value;
  const restBetweenExercisesSeconds = rest(
    patch.restBetweenExercisesSeconds,
    group.restBetweenExercisesSeconds,
  );
  const restBetweenRoundsSeconds = rest(patch.restBetweenRoundsSeconds, group.restBetweenRoundsSeconds);
  const notes = patch.notes === undefined ? group.notes : patch.notes;
  if (
    (restBetweenExercisesSeconds != null && !inRange(restBetweenExercisesSeconds, GROUP_REST_SECONDS_MAX)) ||
    (restBetweenRoundsSeconds != null && !inRange(restBetweenRoundsSeconds, GROUP_REST_SECONDS_MAX))
  ) {
    return { ok: false, reason: `Rests must be between 0 and ${GROUP_REST_SECONDS_MAX} seconds` };
  }
  if (notes != null && notes.length > GROUP_NOTES_MAX) {
    return { ok: false, reason: `Notes can be at most ${GROUP_NOTES_MAX} characters` };
  }

  let next: ExerciseGroupDraft;
  if (format === "straight_sets") {
    if (patch.rounds != null || patch.restBetweenRoundsSeconds != null) {
      return { ok: false, reason: "Straight sets have no rounds" };
    }
    next = { ...group, format, restBetweenExercisesSeconds, notes, rounds: null, restBetweenRoundsSeconds: null };
  } else {
    const rounds =
      patch.rounds ??
      (group.format === "circuit" && group.rounds != null ? group.rounds : mostSets(group.exercises));
    const fitted = fitAll(group.exercises, rounds);
    if (!fitted.ok) return fitted;
    next = {
      ...group,
      format,
      rounds,
      restBetweenExercisesSeconds,
      restBetweenRoundsSeconds,
      notes,
      exercises: fitted.exercises,
    };
  }
  if (patch.columnsPreset) {
    // Judged against the group as it will be, so a preset applied together
    // with a switch to a superset keeps each exercise's Rest choice.
    const hidden = hiddenColumnsIn(next);
    next = {
      ...next,
      exercises: next.exercises.map((exercise) =>
        applyColumnsPreset(exercise, patch.columnsPreset as ColumnsPreset, hidden),
      ),
    };
  }

  const unchanged =
    next.format === group.format &&
    next.rounds === group.rounds &&
    next.restBetweenExercisesSeconds === group.restBetweenExercisesSeconds &&
    next.restBetweenRoundsSeconds === group.restBetweenRoundsSeconds &&
    next.notes === group.notes &&
    next.exercises.every((exercise, i) => exercise === group.exercises[i]);
  if (unchanged) return { ok: true, session };
  const groups = [...session.groups];
  groups[at] = next;
  return withGroups(session, groups);
}

/**
 * A superset or circuit with `amount` rounds added or removed, or null when
 * that changes nothing — duplicate-with-progression's Sets rule on a group, so
 * its exercises stay one set per round. A round added copies every exercise's
 * last set and stops where any exercise would pass 30 sets or 20 working sets;
 * rounds come off the end, and a group keeps one round and a working set on
 * every exercise.
 */
export function progressGroupRounds(
  group: ExerciseGroupDraft,
  amount: number,
): ExerciseGroupDraft | null {
  const n = Math.trunc(amount);
  if (!Number.isFinite(n) || n === 0 || !isSupersetOrCircuit(group)) return null;
  const specsOf = group.exercises.map((exercise) => expandSetSpecs(exercise));
  const rounds = group.rounds ?? Math.max(...specsOf.map((specs) => specs.length));

  let change: number;
  if (n > 0) {
    const headroom = Math.min(
      ...specsOf.map((specs) => {
        const room = MAX_SET_SPECS - specs.length;
        const last = specs[specs.length - 1];
        return last && isWorkingSpec(last)
          ? Math.min(room, MAX_WORKING_SETS - specs.filter(isWorkingSpec).length)
          : room;
      }),
    );
    change = Math.max(0, Math.min(n, headroom));
  } else {
    change = -Math.min(-n, rounds - 1);
    while (
      change < 0 &&
      !specsOf.every((specs) => specs.slice(0, rounds + change).some((s) => s.set_type !== "warmup"))
    ) {
      change += 1;
    }
  }
  if (change === 0) return null;
  const fitted = fitAll(group.exercises, rounds + change);
  if (!fitted.ok) return null;
  return { ...group, rounds: rounds + change, exercises: fitted.exercises };
}
