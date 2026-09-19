// Groups (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md section 4.2, migration 178).
//
// A session is an ordered list of groups; a group is an ordered list of
// exercises; every exercise sits in a group. A group with one exercise on
// straight sets is exactly a lone exercise. Pure and client-safe: the builder,
// the services and the client read the same shape through this module.

import { setSpecCount } from "./exercise-set-specs";

/**
 * The formats a group can take. Migration 178's CHECK mirrors this list, so
 * the two change together. `circuit` is "superset/circuit": a loop through the
 * group's exercises, for its rounds.
 */
export const GROUP_FORMATS = [
  "straight_sets",
  "circuit",
  "amrap",
  "emom",
  "for_time",
] as const;

export type GroupFormat = (typeof GROUP_FORMATS)[number];

/** The most exercises one session holds, across all its groups (the builder's ceiling). */
export const MAX_EXERCISES_PER_SESSION = 50;

// Setting bounds, mirrored by migration 178's CHECKs.
export const GROUP_ROUNDS_MAX = 100;
export const GROUP_TIME_CAP_SECONDS_MAX = 14_400;
export const GROUP_INTERVAL_SECONDS_MAX = 3_600;
export const GROUP_REST_SECONDS_MAX = 3_600;
export const GROUP_NOTES_MAX = 1_000;

/** The formats that run on a clock: AMRAP, EMOM and For time (`utils/group-scores.ts` says which score). */
export function isTimedFormat(format: GroupFormat): boolean {
  return format === "amrap" || format === "emom" || format === "for_time";
}

/** The formats whose rounds are a setting each exercise's rows follow, one row per round. */
export function formatHasRounds(format: GroupFormat): boolean {
  return format === "circuit" || format === "emom" || format === "for_time";
}

/** In an AMRAP every exercise has one row: the work of one round, repeated until the cap. */
export const AMRAP_ROWS_PER_EXERCISE = 1;

/** What a new AMRAP starts with; the coach changes it in the group's settings. */
export const DEFAULT_AMRAP_TIME_CAP_SECONDS = 600;
/** What a new EMOM starts with: every minute. */
export const DEFAULT_EMOM_INTERVAL_SECONDS = 60;

/** A group's settings: the same on a library group, a client group, a draft and the wire. */
export type GroupSettings = {
  format: GroupFormat;
  rounds: number | null;
  timeCapSeconds: number | null;
  intervalSeconds: number | null;
  restBetweenExercisesSeconds: number | null;
  restBetweenRoundsSeconds: number | null;
  notes: string | null;
};

/** A group's settings other than its format. */
export type GroupSetting = Exclude<keyof GroupSettings, "format">;

export const GROUP_SETTING_KEYS: readonly GroupSetting[] = [
  "rounds",
  "timeCapSeconds",
  "intervalSeconds",
  "restBetweenExercisesSeconds",
  "restBetweenRoundsSeconds",
  "notes",
];

/**
 * The settings each format uses, and which of them it needs. The one table: the
 * builder clears what a format doesn't use (`clearUnusedGroupSettings`), the
 * write schemas refuse it (`groupRuleIssue`), and the settings popover shows a
 * format's rows from it. An EMOM's interval is its clock and what is left of it
 * is rest, so it has no rests and no cap; an AMRAP runs to its cap with no
 * rounds and no rests; a For time may carry a cap and rests.
 */
export const GROUP_FORMAT_SETTINGS: Record<
  GroupFormat,
  { uses: readonly GroupSetting[]; requires: readonly GroupSetting[] }
> = {
  straight_sets: { uses: ["restBetweenExercisesSeconds", "notes"], requires: [] },
  circuit: {
    uses: ["rounds", "restBetweenExercisesSeconds", "restBetweenRoundsSeconds", "notes"],
    requires: ["rounds"],
  },
  amrap: { uses: ["timeCapSeconds", "notes"], requires: ["timeCapSeconds"] },
  emom: { uses: ["rounds", "intervalSeconds", "notes"], requires: ["rounds", "intervalSeconds"] },
  for_time: {
    uses: ["rounds", "timeCapSeconds", "restBetweenExercisesSeconds", "restBetweenRoundsSeconds", "notes"],
    requires: ["rounds"],
  },
};

/** `group` with every setting its format doesn't use set to null. */
export function clearUnusedGroupSettings<T extends GroupSettings>(group: T): T {
  const uses = GROUP_FORMAT_SETTINGS[group.format].uses;
  return {
    ...group,
    rounds: uses.includes("rounds") ? group.rounds : null,
    timeCapSeconds: uses.includes("timeCapSeconds") ? group.timeCapSeconds : null,
    intervalSeconds: uses.includes("intervalSeconds") ? group.intervalSeconds : null,
    restBetweenExercisesSeconds: uses.includes("restBetweenExercisesSeconds")
      ? group.restBetweenExercisesSeconds
      : null,
    restBetweenRoundsSeconds: uses.includes("restBetweenRoundsSeconds")
      ? group.restBetweenRoundsSeconds
      : null,
    notes: uses.includes("notes") ? group.notes : null,
  };
}

/**
 * How many rows each exercise in a group of `format` has, or null where the
 * format leaves it to the exercise: one per round where rounds are a setting,
 * one in an AMRAP, free in straight sets.
 */
export function rowsPerExercise(format: GroupFormat, rounds: number | null): number | null {
  if (format === "amrap") return AMRAP_ROWS_PER_EXERCISE;
  return formatHasRounds(format) ? rounds : null;
}

/** The sentences a group that breaks a format's rules is refused with, by format. */
export const GROUP_RULE_WORDS: Record<GroupFormat, { unused: string; missing: string; rows: string }> = {
  straight_sets: { unused: "Straight sets have no rounds", missing: "", rows: "" },
  circuit: {
    unused: "A superset or circuit has no time cap or interval",
    missing: "A superset or circuit needs its rounds",
    rows: "Every exercise in a superset or circuit needs one set per round",
  },
  amrap: {
    unused: "An AMRAP has no rounds, interval or rests",
    missing: "An AMRAP needs its time cap",
    rows: "Every exercise in an AMRAP has one row, the work of one round",
  },
  emom: {
    unused: "An EMOM has no time cap or rests",
    missing: "An EMOM needs its interval and rounds",
    rows: "Every exercise in an EMOM needs one row per round",
  },
  for_time: {
    unused: "A For time has no interval",
    missing: "A For time needs its rounds",
    rows: "Every exercise in a For time needs one row per round",
  },
};

/** A group as the rules read it: its format, its settings and its exercises' set counts. */
export type GroupRuleInput = Partial<Omit<GroupSettings, "format">> & {
  format: GroupFormat;
  exercises: ReadonlyArray<{ sets: number; setSpecs?: readonly unknown[] | null }>;
};

/**
 * Why `group` breaks the rules every group keeps, or null when it keeps them:
 * a straight-sets group of one is a plain exercise with nothing set; a superset
 * needs two exercises; a group stores no setting its format doesn't use and
 * carries the ones it needs; and every exercise has the rows its format asks
 * for (`rowsPerExercise`). The builder holds these after every edit
 * (program-builder-groups.ts); the write schemas refuse anything else.
 */
export function groupRuleIssue(group: GroupRuleInput): string | null {
  const set = (key: GroupSetting) => group[key] != null;
  if (group.exercises.length === 1) {
    if (group.format === "straight_sets") {
      return GROUP_SETTING_KEYS.some(set) ? "A single exercise can't carry group settings" : null;
    }
    if (group.format === "circuit") return "A superset needs two exercises";
  }
  const { uses, requires } = GROUP_FORMAT_SETTINGS[group.format];
  const words = GROUP_RULE_WORDS[group.format];
  if (GROUP_SETTING_KEYS.some((key) => set(key) && !uses.includes(key))) return words.unused;
  if (requires.some((key) => !set(key))) return words.missing;
  const rows = rowsPerExercise(group.format, group.rounds ?? null);
  if (rows != null && !group.exercises.every((exercise) => setSpecCount(exercise) === rows)) {
    return words.rows;
  }
  return null;
}

/** The settings of a lone exercise: straight sets, nothing else set. */
export const STRAIGHT_SETS: Readonly<GroupSettings> = Object.freeze({
  format: "straight_sets",
  rounds: null,
  timeCapSeconds: null,
  intervalSeconds: null,
  restBetweenExercisesSeconds: null,
  restBetweenRoundsSeconds: null,
  notes: null,
});

/** A group's settings as its row stores them. */
export type GroupSettingsRow = {
  format: string;
  rounds: number | null;
  time_cap_seconds: number | null;
  interval_seconds: number | null;
  rest_between_exercises_seconds: number | null;
  rest_between_rounds_seconds: number | null;
  notes: string | null;
};

/** Settings on their way to a write: every field but the format may be absent. */
export type GroupSettingsInput = {
  format: GroupFormat;
  rounds?: number | null;
  timeCapSeconds?: number | null;
  intervalSeconds?: number | null;
  restBetweenExercisesSeconds?: number | null;
  restBetweenRoundsSeconds?: number | null;
  notes?: string | null;
};

function isGroupFormat(value: string): value is GroupFormat {
  return (GROUP_FORMATS as readonly string[]).includes(value);
}

/**
 * A group as a log snapshot records it (migration 178): its id, its place in
 * the session and its settings, in the row's own spelling. An exercise
 * snapshot carries one under `group`; a timed group's score row carries one
 * as `prescribed_group_snapshot` (migration 186).
 */
export type GroupSnapshot = GroupSettingsRow & { id: string; order_index: number };

/** The format a group snapshot records, or null when the snapshot has none this reader trusts. */
export function groupSnapshotFormat(snapshot: Readonly<Record<string, unknown>>): GroupFormat | null {
  const format = snapshot.format;
  return typeof format === "string" && isGroupFormat(format) ? format : null;
}

export function groupSettingsFromRow(row: GroupSettingsRow): GroupSettings {
  // The CHECK refuses any other value, so one reaching here means the list and
  // the constraint have drifted apart.
  if (!isGroupFormat(row.format)) {
    throw new Error(`Unknown group format "${row.format}"`);
  }
  return {
    format: row.format,
    rounds: row.rounds ?? null,
    timeCapSeconds: row.time_cap_seconds ?? null,
    intervalSeconds: row.interval_seconds ?? null,
    restBetweenExercisesSeconds: row.rest_between_exercises_seconds ?? null,
    restBetweenRoundsSeconds: row.rest_between_rounds_seconds ?? null,
    notes: row.notes ?? null,
  };
}

export function groupSettingsToRow(settings: GroupSettingsInput): GroupSettingsRow & {
  format: GroupFormat;
} {
  return {
    format: settings.format,
    rounds: settings.rounds ?? null,
    time_cap_seconds: settings.timeCapSeconds ?? null,
    interval_seconds: settings.intervalSeconds ?? null,
    rest_between_exercises_seconds: settings.restBetweenExercisesSeconds ?? null,
    rest_between_rounds_seconds: settings.restBetweenRoundsSeconds ?? null,
    notes: settings.notes ?? null,
  };
}

/** Only a group's settings, taken off anything that carries them. */
export function groupSettingsOf(group: GroupSettings): GroupSettings {
  return {
    format: group.format,
    rounds: group.rounds,
    timeCapSeconds: group.timeCapSeconds,
    intervalSeconds: group.intervalSeconds,
    restBetweenExercisesSeconds: group.restBetweenExercisesSeconds,
    restBetweenRoundsSeconds: group.restBetweenRoundsSeconds,
    notes: group.notes,
  };
}

/** Every exercise of a session in order: group by group, each group's exercises in turn. */
export function sessionExercises<E>(session: {
  groups: ReadonlyArray<{ exercises: ReadonlyArray<E> }>;
}): E[] {
  return session.groups.flatMap((group) => group.exercises);
}

/** How many exercises a session holds. */
export function countSessionExercises(session: {
  groups: ReadonlyArray<{ exercises: ReadonlyArray<unknown> }>;
}): number {
  return session.groups.reduce((sum, group) => sum + group.exercises.length, 0);
}

/**
 * A session's live groups as a workout lists them: every setting kept, each
 * exercise marked live. The client's workout read and the tracker's swapped
 * session go through this one mapping, so neither can drop a setting.
 */
export function asLiveGroups<E>(
  groups: ReadonlyArray<GroupSettings & { id: string; orderIndex: number; exercises: ReadonlyArray<E> }>,
): Array<GroupSettings & { id: string; orderIndex: number; exercises: Array<{ source: "live"; exercise: E }> }> {
  return groups.map((group) => ({
    id: group.id,
    orderIndex: group.orderIndex,
    ...groupSettingsOf(group),
    exercises: group.exercises.map((exercise) => ({ source: "live" as const, exercise })),
  }));
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The group a logged exercise sat in, read off its prescription snapshot, with
 * the exercise's place in it.
 *
 * A snapshot written since migration 178 records its group. One written before
 * records none — or a group this reader cannot trust — and reads as a
 * straight-sets group of one whose id is the exercise's own and whose place is
 * the exercise's old place in the session: exactly what the migration's
 * backfill made of the row.
 */
export function snapshotGroup(
  snapshot: Readonly<Record<string, unknown>>,
  exerciseId: string,
): { id: string; orderIndex: number; settings: GroupSettings; exerciseOrderIndex: number } {
  const place = numberOrNull(snapshot.order_index) ?? 0;
  const group = snapshot.group;
  if (
    group !== null &&
    typeof group === "object" &&
    "id" in group &&
    typeof group.id === "string" &&
    "order_index" in group &&
    typeof group.order_index === "number" &&
    "format" in group &&
    typeof group.format === "string" &&
    isGroupFormat(group.format)
  ) {
    const row = group as Record<string, unknown>;
    return {
      id: group.id,
      orderIndex: group.order_index,
      settings: {
        format: group.format,
        rounds: numberOrNull(row.rounds),
        timeCapSeconds: numberOrNull(row.time_cap_seconds),
        intervalSeconds: numberOrNull(row.interval_seconds),
        restBetweenExercisesSeconds: numberOrNull(row.rest_between_exercises_seconds),
        restBetweenRoundsSeconds: numberOrNull(row.rest_between_rounds_seconds),
        notes: typeof row.notes === "string" ? row.notes : null,
      },
      exerciseOrderIndex: place,
    };
  }
  return { id: exerciseId, orderIndex: place, settings: { ...STRAIGHT_SETS }, exerciseOrderIndex: 0 };
}

type Ordered = { id: string; order_index: number };

const byPosition = (a: Ordered, b: Ordered) =>
  a.order_index - b.order_index || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Exercise rows, each read with the group it sits in, as the session's groups
 * in order with each group's exercises in order. A group is known only through
 * the exercises that point at it, so a group none of `rows` points at (one whose
 * exercises were all retired) is not among the result.
 */
export function nestRowsIntoGroups<G extends Ordered, E extends Ordered>(
  rows: ReadonlyArray<{ group: G; exercise: E }>,
): Array<{ group: G; exercises: E[] }> {
  const byGroup = new Map<string, { group: G; exercises: E[] }>();
  for (const { group, exercise } of rows) {
    const entry = byGroup.get(group.id);
    if (entry) entry.exercises.push(exercise);
    else byGroup.set(group.id, { group, exercises: [exercise] });
  }
  return [...byGroup.values()]
    .sort((a, b) => byPosition(a.group, b.group))
    .map((entry) => ({ ...entry, exercises: [...entry.exercises].sort(byPosition) }));
}
