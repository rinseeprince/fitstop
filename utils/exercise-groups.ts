// Groups (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md section 4.2, migration 178).
//
// A session is an ordered list of groups; a group is an ordered list of
// exercises; every exercise sits in a group. A group with one exercise on
// straight sets is exactly a lone exercise. Pure and client-safe: the builder,
// the services and the client read the same shape through this module.

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
