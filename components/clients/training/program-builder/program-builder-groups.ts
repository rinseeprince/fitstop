import { applySetSpecEdit } from "@/utils/set-spec-edits";
import {
  MAX_SET_SPECS,
  MAX_WORKING_SETS,
  expandSetSpecs,
  setSpecCount,
} from "@/utils/exercise-set-specs";
import { isWorkingSpec } from "@/utils/progression-rules";
import {
  DEFAULT_AMRAP_TIME_CAP_SECONDS,
  DEFAULT_EMOM_INTERVAL_SECONDS,
  GROUP_FORMAT_SETTINGS,
  GROUP_INTERVAL_SECONDS_MAX,
  GROUP_NOTES_MAX,
  GROUP_REST_SECONDS_MAX,
  GROUP_RULE_WORDS,
  GROUP_SETTING_KEYS,
  GROUP_TIME_CAP_SECONDS_MAX,
  STRAIGHT_SETS,
  clearUnusedGroupSettings,
  formatHasRounds,
  isTimedFormat,
  rowsPerExercise,
  sessionExercises,
  type GroupFormat,
  type GroupSettings,
} from "@/utils/exercise-groups";
import { readsAsGroup } from "@/utils/exercise-group-display";
import { presetColumns, presetOf, type ColumnsPreset } from "@/utils/column-presets";
import { resolvePrescribedFields, type PrescribedField } from "@/utils/prescribed-fields";
import type {
  ExerciseDraft,
  ExerciseGroupDraft,
  SessionDraft,
} from "./program-builder-types";

// Groups in the builder — supersets, circuits, linked straight sets, AMRAPs,
// EMOMs and For times (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md sections 4.2
// and 4.5). Pure and React-free: the builder's mutators and the assistant's ops
// (program-builder-ops.ts, run by the server executors and replayed by the
// client) make every group edit through these functions, so a hand edit and an
// assistant edit cannot differ.
//
// Four rules hold after every edit (normalizeGroups, and the write schemas in
// lib/validations/training.ts refuse anything else through `groupRuleIssue`):
// - a straight-sets group of one is a plain exercise with nothing set; a timed
//   group of one keeps its format and settings, because its clock and its
//   score must stay in view;
// - where rounds are a setting — a superset or circuit, an EMOM, a For time —
//   every exercise has one row per round, so each round keeps its own targets
//   and the client logs a round as a row;
// - in an AMRAP every exercise has one row, the work of one round;
// - a group stores no setting its format doesn't use (GROUP_FORMAT_SETTINGS).
//
// Nothing here mints a uid: callers pass the uids new groups take, so the
// server's working copy and the client's replay stay identical.

export type GroupEditResult =
  | { ok: true; session: SessionDraft }
  | { ok: false; reason: string };

/** The formats Link makes: a superset or circuit, or one of the three timed formats. */
export type LinkFormat = Exclude<GroupFormat, "straight_sets">;

/**
 * Where a moved exercise lands, counted in the session as it stands before the
 * move: inside a linked group before its exercise at `index` (its length is the
 * end), or standalone before the session's group at `index`.
 */
export type ExerciseDestination =
  | { kind: "group"; groupUid: string; index: number }
  | { kind: "session"; index: number };

/**
 * The settings a coach edits on a group. `columnsPreset` applies a column
 * preset to every exercise in the group (utils/column-presets.ts) — "a preset
 * applies to one exercise or a whole group" — in the same edit as any setting,
 * so a format switch and the preset land in one commit.
 */
export type GroupSettingsPatch = {
  format?: GroupFormat;
  rounds?: number;
  timeCapSeconds?: number | null;
  intervalSeconds?: number | null;
  restBetweenExercisesSeconds?: number | null;
  restBetweenRoundsSeconds?: number | null;
  notes?: string | null;
  columnsPreset?: ColumnsPreset;
};

type GroupShape = { format: GroupFormat; exercises: ReadonlyArray<unknown> };

/**
 * Rows are rounds: a group that reads as a group (`readsAsGroup`) in any format
 * but straight sets — a superset or circuit, or a timed group of any size.
 */
export function rowsAreRounds(group: GroupShape): boolean {
  return readsAsGroup(group) && group.format !== "straight_sets";
}

/** The group's rounds are a setting its exercises' rows follow: a superset or circuit, an EMOM, a For time. */
export function hasGroupRounds(group: GroupShape): boolean {
  return rowsAreRounds(group) && formatHasRounds(group.format);
}

/** The rows every exercise in `group` has, or null where its format leaves them free. */
function rowsIn(group: GroupShape & { rounds: number | null }): number | null {
  return rowsAreRounds(group) ? rowsPerExercise(group.format, group.rounds) : null;
}

/** The columns the selector doesn't offer where an exercise sits: Rest where its rows are rounds. */
export function hiddenColumnsIn(group: GroupShape): readonly PrescribedField[] {
  return rowsAreRounds(group) ? ["rest"] : [];
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

// A group keeps only the settings its format uses, and a group of one is a
// plain exercise unless it is timed.
function normalizeGroupSettings(group: ExerciseGroupDraft): ExerciseGroupDraft {
  if (group.exercises.length === 1 && !isTimedFormat(group.format)) {
    return { ...group, ...STRAIGHT_SETS };
  }
  return clearUnusedGroupSettings(group);
}

/**
 * A session's groups under the rules: a group left with no exercises goes, a
 * group of one is a plain exercise unless it is timed, and no group stores a
 * setting its format doesn't use.
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

/** The settings a group made by Link starts with: its format, its rounds, and a clock for the formats that need one. */
function newGroupSettings(format: LinkFormat, rounds: number): Partial<GroupSettings> {
  switch (format) {
    case "circuit":
      return { format, rounds };
    case "amrap":
      return { format, timeCapSeconds: DEFAULT_AMRAP_TIME_CAP_SECONDS };
    case "emom":
      return { format, rounds, intervalSeconds: DEFAULT_EMOM_INTERVAL_SECONDS };
    case "for_time":
      return { format, rounds };
  }
}

/**
 * Link exercises into one new group of `format`, where the first of them was,
 * in session order. A superset or circuit needs two; a timed group takes one
 * or more. Where rounds are a setting the group takes as many as the exercise
 * with the most sets has, and an exercise with fewer gets copies of its last
 * set; an AMRAP fits every exercise to one row. A new AMRAP starts with a
 * 10-minute cap and a new EMOM at every minute. An exercise taken from another
 * group leaves it.
 */
export function linkExercises(
  session: SessionDraft,
  exerciseUids: readonly string[],
  groupUid: string,
  format: LinkFormat = "circuit",
): GroupEditResult {
  const picked = new Set(exerciseUids);
  const linked = sessionExercises(session).filter((exercise) => picked.has(exercise.uid));
  if (linked.length !== picked.size) {
    return { ok: false, reason: "That exercise no longer exists" };
  }
  if (format === "circuit" && linked.length < 2) {
    return { ok: false, reason: "Pick at least two exercises to link" };
  }
  if (linked.length < 1) return { ok: false, reason: "Pick an exercise to link" };

  const rows = rowsPerExercise(format, mostSets(linked)) ?? mostSets(linked);
  const fitted = fitAll(linked, rows);
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
    ...newGroupSettings(format, rows),
    exercises: fitted.exercises,
  });
  return withGroups(session, groups);
}

/**
 * Every exercise of a linked group becomes a plain exercise in the same place,
 * keeping its sets; `groupUids` names their groups, one per exercise. A timed
 * group of one becomes a plain exercise in place.
 */
export function unlinkGroup(
  session: SessionDraft,
  groupUid: string,
  groupUids: readonly string[],
): GroupEditResult {
  const at = session.groups.findIndex((group) => group.uid === groupUid);
  if (at < 0) return { ok: false, reason: "That group no longer exists" };
  const group = session.groups[at];
  if (group.exercises.length < 2) {
    if (!isTimedFormat(group.format)) return { ok: true, session };
    const groups = [...session.groups];
    groups[at] = { ...group, ...STRAIGHT_SETS };
    return withGroups(session, groups);
  }
  if (groupUids.length < group.exercises.length) {
    throw new Error("unlinkGroup needs one group uid per exercise");
  }
  const groups = [...session.groups];
  groups.splice(at, 1, ...group.exercises.map((exercise, i) => loneGroup(groupUids[i], exercise)));
  return withGroups(session, groups);
}

/**
 * Move an exercise. Into a group that reads as a group it joins it and takes
 * the rows its format asks for — the rounds of a superset, circuit, EMOM or For
 * time, one row in an AMRAP; to a place among the session's groups it stands
 * alone — in a group of its own named `groupUid`, or its own group when it
 * already stood alone. The same session when it lands where it is.
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
    if (!readsAsGroup(target)) {
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
    const rows = rowsIn(target);
    if (rows != null) {
      const fitted = fitExerciseSets(exercise, rows);
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

const inRange = (value: number, min: number, max: number) =>
  Number.isInteger(value) && value >= min && value <= max;

/**
 * Change a group's settings. The format decides which settings the patch may
 * set (GROUP_FORMAT_SETTINGS; anything else is refused with the format's
 * sentence) and the rows every exercise is fitted to: the rounds of a superset,
 * circuit, EMOM or For time — becoming one, a group takes the rounds it had or
 * those of the exercise with the most sets unless the patch says otherwise —
 * one row in an AMRAP, and straight sets keep every set. A new AMRAP's cap is
 * 10 minutes and a new EMOM's interval a minute until the coach says otherwise.
 * The same session when nothing changes.
 */
export function updateGroup(
  session: SessionDraft,
  groupUid: string,
  patch: GroupSettingsPatch,
): GroupEditResult {
  const at = session.groups.findIndex((group) => group.uid === groupUid);
  if (at < 0) return { ok: false, reason: "That group no longer exists" };
  const group = session.groups[at];
  if (!readsAsGroup(group)) {
    return { ok: false, reason: "A single exercise has no group settings" };
  }
  const format = patch.format ?? group.format;
  if (format === "circuit" && group.exercises.length < 2) {
    return { ok: false, reason: "A superset needs two exercises" };
  }
  const { uses } = GROUP_FORMAT_SETTINGS[format];
  if (GROUP_SETTING_KEYS.some((key) => patch[key] != null && !uses.includes(key))) {
    return { ok: false, reason: GROUP_RULE_WORDS[format].unused };
  }

  const keep = <T>(patched: T | undefined, current: T): T =>
    patched === undefined ? current : patched;
  const rounds = uses.includes("rounds")
    ? patch.rounds ??
      (hasGroupRounds(group) && group.rounds != null ? group.rounds : mostSets(group.exercises))
    : null;
  const timeCapSeconds = uses.includes("timeCapSeconds")
    ? keep(patch.timeCapSeconds, group.timeCapSeconds) ??
      (format === "amrap" ? DEFAULT_AMRAP_TIME_CAP_SECONDS : null)
    : null;
  const intervalSeconds = uses.includes("intervalSeconds")
    ? keep(patch.intervalSeconds, group.intervalSeconds) ?? DEFAULT_EMOM_INTERVAL_SECONDS
    : null;
  const restBetweenExercisesSeconds = uses.includes("restBetweenExercisesSeconds")
    ? keep(patch.restBetweenExercisesSeconds, group.restBetweenExercisesSeconds)
    : null;
  const restBetweenRoundsSeconds = uses.includes("restBetweenRoundsSeconds")
    ? keep(patch.restBetweenRoundsSeconds, group.restBetweenRoundsSeconds)
    : null;
  const notes = keep(patch.notes, group.notes);

  if (
    (restBetweenExercisesSeconds != null &&
      !inRange(restBetweenExercisesSeconds, 0, GROUP_REST_SECONDS_MAX)) ||
    (restBetweenRoundsSeconds != null && !inRange(restBetweenRoundsSeconds, 0, GROUP_REST_SECONDS_MAX))
  ) {
    return { ok: false, reason: `Rests must be between 0 and ${GROUP_REST_SECONDS_MAX} seconds` };
  }
  if (timeCapSeconds != null && !inRange(timeCapSeconds, 1, GROUP_TIME_CAP_SECONDS_MAX)) {
    return {
      ok: false,
      reason: `A time cap must be between 1 second and ${GROUP_TIME_CAP_SECONDS_MAX / 3600} hours`,
    };
  }
  if (intervalSeconds != null && !inRange(intervalSeconds, 1, GROUP_INTERVAL_SECONDS_MAX)) {
    return {
      ok: false,
      reason: `An interval must be between 1 second and ${GROUP_INTERVAL_SECONDS_MAX / 60} minutes`,
    };
  }
  if (notes != null && notes.length > GROUP_NOTES_MAX) {
    return { ok: false, reason: `Notes can be at most ${GROUP_NOTES_MAX} characters` };
  }

  let exercises = group.exercises;
  const rows = rowsPerExercise(format, rounds);
  if (rows != null) {
    const fitted = fitAll(group.exercises, rows);
    if (!fitted.ok) return fitted;
    exercises = fitted.exercises;
  }
  let next: ExerciseGroupDraft = {
    ...group,
    format,
    rounds,
    timeCapSeconds,
    intervalSeconds,
    restBetweenExercisesSeconds,
    restBetweenRoundsSeconds,
    notes,
    exercises,
  };
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
    next.timeCapSeconds === group.timeCapSeconds &&
    next.intervalSeconds === group.intervalSeconds &&
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
 * A group whose rounds are a setting — a superset or circuit, an EMOM, a For
 * time — with `amount` rounds added or removed, or null when that changes
 * nothing: duplicate-with-progression's Sets rule on a group, so its exercises
 * stay one row per round. A round added copies every exercise's last set and
 * stops where any exercise would pass 30 sets or 20 working sets; rounds come
 * off the end, and a group keeps one round and a working set on every
 * exercise. An AMRAP's rows never change.
 */
export function progressGroupRounds(
  group: ExerciseGroupDraft,
  amount: number,
): ExerciseGroupDraft | null {
  const n = Math.trunc(amount);
  if (!Number.isFinite(n) || n === 0 || !hasGroupRounds(group)) return null;
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
