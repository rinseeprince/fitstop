import { SET_SPEC_MEASURE_KEYS, type LoadType, type SetSpecMeasure } from "./exercise-set-specs";
import { formatRestDuration, formatRoundReps } from "./exercise-group-display";
import { formatMeasureReadout, formatTempoReadout } from "./measure-readout";
import { PRESCRIBED_FIELDS, type PrescribedField } from "./prescribed-fields";
import type { PrescribedRow } from "./set-spec-rows";
import type { TargetRange } from "./target-range";
import type { UnitSystem } from "./unit-conversions";

// An exercise's one-line summary, for the client's tracker and their Program
// tab: "3 × 8–12 · 100–105 kg · RPE 7–8 · 1m 30s rest", "6 × 800 m ·
// 3:45–3:50 /km". It reads every column the coach prescribed as a readout
// (utils/measure-readout.ts), each measure as its span across the working
// sets — the lowest floor and the highest ceiling — so a 15-20 / 10-12 / 8-10
// prescription reads "3 × 8–20", as the compact projection always has.

/** The measure that leads the line, after the set count: what the sets are OF. */
const HEAD_MEASURES: readonly SetSpecMeasure[] = ["reps", "distance", "duration"];

function span(rows: PrescribedRow[], measure: SetSpecMeasure): TargetRange | null {
  let min: number | null = null;
  let max: number | null = null;
  for (const row of rows) {
    const range = row.ranges[measure];
    if (range.min != null) min = min == null ? range.min : Math.min(min, range.min);
    if (range.max != null) max = max == null ? range.max : Math.max(max, range.max);
  }
  return min == null && max == null ? null : { min, max };
}

/** The working sets' one load type, or null when they mix units or prescribe none. */
function loadTypeOf(rows: PrescribedRow[]): LoadType | null {
  const types = new Set(rows.map((row) => row.loadType).filter((type) => type != null));
  return types.size === 1 ? [...types][0] : null;
}

export function formatPrescriptionSummary(args: {
  rows: PrescribedRow[];
  fields: ReadonlySet<PrescribedField>;
  /** The exercise's own rest, gated by its Rest column; a group's rests are the heading's. */
  restSeconds: number | null | undefined;
  /** Where the exercise's rows are a group's rounds, the line reads its reps round by round. */
  roundsAreRows: boolean;
  viewer: UnitSystem;
}): string {
  const { rows, fields, restSeconds, roundsAreRows, viewer } = args;
  // A drop's rows belong to their set and a warm-up is never counted.
  const working = rows.filter((row) => row.dropIndex == null && row.setType !== "warmup");
  const parts: string[] = [];
  let head: SetSpecMeasure | null = null;

  if (roundsAreRows) {
    const reps = formatRoundReps(rows);
    if (reps) {
      parts.push(reps);
      head = "reps";
    }
  } else if (working.length > 0) {
    const legacyReps = working.find((row) => row.repsTarget)?.repsTarget ?? null;
    for (const measure of HEAD_MEASURES) {
      if (!fields.has(measure)) continue;
      const readout =
        measure === "reps" && legacyReps && span(working, "reps") == null
          ? legacyReps
          : formatMeasureReadout(measure, span(working, measure) ?? { min: null, max: null }, viewer);
      if (readout) {
        parts.push(`${working.length} × ${readout}`);
        head = measure;
        break;
      }
    }
    if (head == null) parts.push(`${working.length} sets`);
  }

  const loadType = loadTypeOf(working);
  for (const field of PRESCRIBED_FIELDS) {
    if (!fields.has(field) || field === head) continue;
    if (field === "tempo") {
      const tempo = formatTempoReadout(working.find((row) => row.tempo)?.tempo);
      if (tempo) parts.push(tempo);
      continue;
    }
    if (!SET_SPEC_MEASURE_KEYS.includes(field as SetSpecMeasure)) continue;
    const measure = field as SetSpecMeasure;
    if (measure === "load" && loadType == null) continue;
    const range = span(working, measure);
    if (!range) continue;
    const readout = formatMeasureReadout(measure, range, viewer, loadType);
    if (readout) parts.push(readout);
  }

  if (!roundsAreRows && fields.has("rest") && restSeconds != null) {
    parts.push(`${formatRestDuration(restSeconds)} rest`);
  }

  return parts.join(" · ");
}
