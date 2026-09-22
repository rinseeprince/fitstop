import {
  EXERCISE_TYPE_LABELS,
  EXERCISE_TYPES,
  type ExerciseType,
} from "./exercise-types";
import {
  DEFAULT_PRESCRIBED_FIELDS,
  PRESCRIBED_FIELD_LABELS,
  PRESCRIBED_FIELDS,
  type PrescribedField,
} from "./prescribed-fields";

// The column presets and the column selector's vocabulary
// (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md section 4.4): a fixed set, one per
// exercise type plus Circuit, that a coach applies to one exercise or to a
// whole group as a starting point — any column can then be ticked or unticked.
// Coaches don't save their own. The builder's selector, the assistant's tools
// and the group edit (program-builder-groups.ts) all read this one table, so a
// preset means the same columns whoever applies it.

/** One preset per exercise type (utils/exercise-types.ts), plus Circuit. */
export const COLUMN_PRESETS = [...EXERCISE_TYPES, "circuit"] as const;

export type ColumnsPreset = (typeof COLUMN_PRESETS)[number];

export const COLUMN_PRESET_LABELS: Record<ColumnsPreset, string> = {
  ...EXERCISE_TYPE_LABELS,
  circuit: "Circuit",
};

/**
 * Each preset's exact columns (confirmed by the owner, 2026-09-19). Strength's
 * are `DEFAULT_PRESCRIBED_FIELDS`; a new exercise starts on its type's
 * (`presetColumnsForType`). Circuit carries no Rest, because a superset's or
 * circuit's rests are the group's, and no Set type, because a circuit's rows
 * are its rounds.
 */
export const COLUMN_PRESET_FIELDS: Record<ColumnsPreset, readonly PrescribedField[]> = {
  strength: DEFAULT_PRESCRIBED_FIELDS,
  bodyweight: ["set_type", "reps", "rpe", "rest"],
  endurance: ["set_type", "distance", "duration", "pace", "heart_rate_zone", "rest"],
  erg: ["set_type", "distance", "duration", "split", "stroke_rate", "resistance", "rest"],
  carry_sled: ["set_type", "load", "distance", "duration", "rest"],
  holds: ["set_type", "rpe", "duration", "rest"],
  circuit: ["reps", "load"],
};

/**
 * The columns a new exercise starts on: its catalog type's preset. A fresh
 * array, never the shared preset.
 */
export function presetColumnsForType(type: ExerciseType): PrescribedField[] {
  return [...COLUMN_PRESET_FIELDS[type]];
}

const PRESET_SET: ReadonlySet<string> = new Set(COLUMN_PRESETS);

export function isColumnsPreset(value: unknown): value is ColumnsPreset {
  return typeof value === "string" && PRESET_SET.has(value);
}

/** The selector's three groups, in the order it lists them. */
export const COLUMN_GROUPS: readonly {
  key: "strength" | "endurance" | "framework";
  label: string;
  fields: readonly PrescribedField[];
}[] = [
  { key: "strength", label: "Strength", fields: ["load", "reps", "rpe", "rir", "tempo"] },
  {
    key: "endurance",
    label: "Endurance",
    fields: [
      "distance",
      "duration",
      "pace",
      "split",
      "calories",
      "cadence",
      "stroke_rate",
      "resistance",
      "heart_rate_zone",
      "heart_rate",
      "power",
      "ftp_percent",
    ],
  },
  { key: "framework", label: "Framework", fields: ["set_type", "rest"] },
];

/**
 * The order the builder's set grid shows columns in, and the order a stored
 * list takes: set type first, then reps before load as the grid has always
 * read, then every other measure as the column list defines it, rest last. A
 * ticked column joins in its place, never at the end.
 */
export const BUILDER_COLUMN_ORDER: readonly PrescribedField[] = [
  "set_type",
  "reps",
  "load",
  ...PRESCRIBED_FIELDS.filter(
    (field) => field !== "set_type" && field !== "reps" && field !== "load" && field !== "rest",
  ),
  "rest",
];

/** A set of columns as a list in the builder's order. */
export function orderColumns(fields: Iterable<PrescribedField>): PrescribedField[] {
  const chosen = new Set(fields);
  return BUILDER_COLUMN_ORDER.filter((field) => chosen.has(field));
}

/**
 * The columns an exercise takes from a preset: exactly the preset's, except a
 * column the selector doesn't offer where the exercise sits (Rest in a
 * superset or circuit, whose rests are the group's), which keeps the
 * exercise's own stored choice.
 */
export function presetColumns(
  preset: ColumnsPreset,
  current: ReadonlySet<PrescribedField>,
  hidden: readonly PrescribedField[] = [],
): PrescribedField[] {
  const next = new Set(COLUMN_PRESET_FIELDS[preset]);
  for (const field of hidden) {
    if (current.has(field)) next.add(field);
    else next.delete(field);
  }
  return orderColumns(next);
}

/**
 * The preset a column list is exactly, or null when it matches none. A column
 * hidden where the exercise sits (Rest in a superset or circuit) is left out
 * of the comparison on both sides, since the selector neither shows nor sets
 * it there: an exercise on reps, load and a kept Rest is on Circuit.
 */
export function presetOf(
  fields: Iterable<PrescribedField>,
  hidden: readonly PrescribedField[] = [],
): ColumnsPreset | null {
  const visible = (columns: Iterable<PrescribedField>) =>
    new Set([...columns].filter((field) => !hidden.includes(field)));
  const chosen = visible(fields);
  return (
    COLUMN_PRESETS.find((preset) => {
      const columns = visible(COLUMN_PRESET_FIELDS[preset]);
      return columns.size === chosen.size && [...columns].every((field) => chosen.has(field));
    }) ?? null
  );
}

/** "Set type · Reps · Load · RPE · Rest" — a preset's columns, for a hint or a tool's reply. */
export function describePresetColumns(preset: ColumnsPreset): string {
  return COLUMN_PRESET_FIELDS[preset].map((field) => PRESCRIBED_FIELD_LABELS[field]).join(" · ");
}
