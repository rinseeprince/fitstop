import { sanitizeForAIPrompt } from "./ai-prompt-sanitizer";
import { snapshotToSpecs } from "./exercise-set-specs";
import { formatRestDuration } from "./exercise-group-display";
import { snapshotGroup } from "./exercise-groups";
import { takesScore } from "./group-scores";
import {
  buildLoggedSetRows,
  loggedColumns,
  type LoggedSetInput,
  type LoggedSetRow,
} from "./logged-set-rows";
import { boxHeader, formatBoxActual, formatBoxTarget } from "./measure-readout";
import { snapshotPrescribedFields } from "./prescribed-fields";
import { buildPrescribedRows } from "./set-spec-rows";
import { boxGap, restGap, restTarget, type TargetGap } from "./target-gap";
import type { UnitSystem } from "./unit-conversions";

// One logged exercise as the check-in AI reads it (owner, 2026-09-18): the
// working sets done against those prescribed, then measure by measure what the
// client did beside what the coach set, naming every measure outside its
// target. The measures, their words and the judgement are the coach's
// logged-workout table's (`loggedColumns`, utils/measure-readout.ts,
// utils/target-gap.ts), in the COACH's units, so the review and the table
// cannot describe one set two ways. Warm-ups are left out — recorded, never
// scored — and a value nobody recorded reads "not recorded", never a zero. An
// exercise in an AMRAP or For time — a group done by its score — reads its
// rows as the work of a round ("per round"), never as a count of sets done;
// the group's own line carries the score (services/check-in-context-service.ts).
//
//   Barbell Back Squat — 3 of 3 working sets: Load (kg) 102.5, 102.5, 107.5
//   (target 100–105 kg; 1 of 3 above target); Reps 5, 5, 4 (target 5; 1 of 3
//   below target); RPE 8, 9, 10 (target 8; 2 of 3 above target)
//   Kettlebell Swing — per round: Reps 10 (target 10); Load (kg) 24 (target 24 kg)

const DASH = "—";

const GAP_WORDS: Record<TargetGap, [one: string, many: string]> = {
  above: ["above target", "above target"],
  below: ["below target", "below target"],
  differs: ["differs from target", "differ from target"],
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** One measure across the logged working sets: a value, target and gap per set. */
type Measure = {
  label: string;
  values: (string | null)[];
  targets: (string | null)[];
  gaps: (TargetGap | null)[];
};

/** "(target 5; 1 of 3 below target)": the targets, one when they agree, then every side a set fell outside. */
function targetClause({ values, targets, gaps }: Measure): string | null {
  const set = targets.filter((target): target is string => target != null);
  if (set.length === 0) return null;
  const readout = new Set(targets).size === 1 ? set[0] : targets.map((t) => t ?? DASH).join(", ");
  const recorded = values.filter((value) => value != null).length;
  const sides = (["above", "below", "differs"] as const).flatMap((side) => {
    const count = gaps.filter((gap) => gap === side).length;
    if (count === 0) return [];
    const [one, many] = GAP_WORDS[side];
    if (count < recorded) return [`${count} of ${recorded} ${count === 1 ? one : many}`];
    if (recorded === 1) return [one];
    return [recorded === 2 ? `both ${many}` : `all ${recorded} ${many}`];
  });
  return `(target ${[readout, ...sides].join("; ")})`;
}

/** "RPE 8, 9, 10 (target 8; 2 of 3 above target)", or null for a measure with nothing to say. */
function measureClause(measure: Measure): string | null {
  const target = targetClause(measure);
  if (measure.values.every((value) => value == null)) {
    return target ? `${measure.label} not recorded ${target}` : null;
  }
  const values = measure.values.map((value) => value ?? DASH).join(", ");
  return target ? `${measure.label} ${values} ${target}` : `${measure.label} ${values}`;
}

/** The snapshot's group's format (`snapshotGroup`; only the format is read, so the fallback id is moot). */
function groupFormatOf(snapshot: Record<string, unknown> | null) {
  return snapshot == null ? "straight_sets" : snapshotGroup(snapshot, "").settings.format;
}

/**
 * Whether the snapshot's group loops round by round, so its rests are the
 * group's rather than the exercise's own. A snapshot records its group's format
 * but not its size, and a group of one is stored as straight sets unless it is
 * timed, so every format but straight sets loops.
 */
function loopsRounds(snapshot: Record<string, unknown> | null): boolean {
  return groupFormatOf(snapshot) !== "straight_sets";
}

/**
 * Whether the exercise sits in a group done by its score — an AMRAP or a For
 * time — so its rows are the work of a round and not a count of sets done.
 */
function scoredByGroup(snapshot: Record<string, unknown> | null): boolean {
  return takesScore(groupFormatOf(snapshot));
}

/**
 * The line for one logged exercise. `sets` are its set_logs rows' actuals by
 * wire key, with their set numbers; `snapshot` is the prescription as logged.
 */
export function describeLoggedExercise({
  performedName,
  snapshot,
  sets,
  viewer,
}: {
  performedName: string | null;
  snapshot: Record<string, unknown> | null;
  sets: readonly LoggedSetInput[];
  viewer: UnitSystem;
}): string {
  const prescribedName = typeof snapshot?.name === "string" && snapshot.name ? snapshot.name : null;
  const performed = performedName || null;
  const name = sanitizeForAIPrompt(performed ?? prescribedName ?? "Unknown exercise");
  // A swap is named, so a dumbbell's load is never read against a barbell's target.
  const head =
    performed != null && prescribedName != null && performed !== prescribedName
      ? `${name}, in place of ${sanitizeForAIPrompt(prescribedName)}`
      : name;

  const prescribedRows = buildPrescribedRows(snapshotToSpecs(snapshot));
  const rows = buildLoggedSetRows(prescribedRows, sets);
  const done = rows.filter(
    (row): row is LoggedSetRow & { actual: NonNullable<LoggedSetRow["actual"]> } =>
      row.actual !== null && row.prescribed?.setType !== "warmup",
  );
  if (done.length === 0) return `${head} — warm-up sets only`;

  const prescribed = prescribedRows.filter((row) => row.setType !== "warmup").length;
  // In an AMRAP or For time the group's score says how much was done; the
  // exercise's rows are the work of a round, so they are read as that.
  const count = scoredByGroup(snapshot)
    ? "per round"
    : prescribed === 0
      ? `${plural(done.length, "set")}, not in the plan`
      : done.length > prescribed
        ? `${done.length} working sets (${prescribed} prescribed)`
        : `${done.length} of ${plural(prescribed, "working set")}`;

  const fields = snapshotPrescribedFields(snapshot);
  const columns = loggedColumns(fields, rows, viewer);
  // A target can be the legacy free-text rep target a coach typed, so it is
  // sanitised like a name; every other word is composed here from numbers.
  const target = (text: string | null) => (text == null ? null : sanitizeForAIPrompt(text) || null);
  const measures: Measure[] = columns.boxes.map((box) => ({
    label: boxHeader(box, viewer),
    values: done.map((row) => formatBoxActual(box, row.actual, viewer)),
    targets: done.map((row) => target(formatBoxTarget(box, row.prescribed, viewer))),
    gaps: done.map((row) => boxGap(box, row.prescribed, row.actual, viewer)),
  }));
  if (columns.rest) {
    const ownRestApplies = fields.has("rest") && !loopsRounds(snapshot);
    const readout = (seconds: number | null) => (seconds == null ? null : formatRestDuration(seconds));
    measures.push({
      label: "Rest",
      values: done.map((row) => readout(row.actual.restSeconds)),
      targets: done.map((row) => readout(restTarget(row.prescribed, ownRestApplies))),
      gaps: done.map((row) =>
        restGap(restTarget(row.prescribed, ownRestApplies), row.actual.restSeconds),
      ),
    });
  }

  const clauses = measures.map(measureClause).filter((clause): clause is string => clause != null);
  return clauses.length > 0
    ? `${head} — ${count}: ${clauses.join("; ")}`
    : `${head} — ${count}, no values recorded`;
}
