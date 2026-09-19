import { expandSetSpecs } from "@/utils/exercise-set-specs";
import { buildPrescribedRows } from "@/utils/set-spec-rows";
import type { GroupFormat } from "@/utils/exercise-groups";
import {
  formatRoundReps,
  formatRoundRepsOnce,
  formatRoundRepsShort,
} from "@/utils/exercise-group-display";
import type { ExerciseDraft } from "./program-builder-types";

// Shared prescription summary for the builder. It prefers the maintained
// compact reps range over an exercise-level repsTarget once per-set specs
// exist (per-set edits re-project the range but never the target, so the
// target would show stale reps after editing sets).

// Dense "sets×reps" for session cards (mockup `.ex-s`): "3×8-12", "4×8" (a
// single number when min===max or only one bound is set), or "3 sets" when no
// reps are set. Hyphen + collapsed, matching the reference.
export function setsRepsShort(e: ExerciseDraft): string {
  const range =
    e.repsMin != null && e.repsMax != null
      ? e.repsMin === e.repsMax
        ? `${e.repsMin}`
        : `${e.repsMin}-${e.repsMax}`
      : e.repsMin != null
        ? `${e.repsMin}`
        : e.repsMax != null
          ? `${e.repsMax}`
          : null;
  const reps =
    e.setSpecs && e.setSpecs.length > 0
      ? range ?? e.repsTarget
      : e.repsTarget ?? range;
  return reps ? `${e.sets}×${reps}` : `${e.sets} sets`;
}

// The session editor card's summary, and its drag copy's: sets×reps, or where
// the exercise's rows are a group's rounds the reps round by round as the
// client reads them, "21-15-9 reps" — empty when a round asks no rep count, so
// nothing half-true is on screen.
export function exerciseCardSummary(e: ExerciseDraft, roundsAreRows: boolean): string {
  return roundsAreRows
    ? (formatRoundReps(buildPrescribedRows(expandSetSpecs(e))) ?? "")
    : setsRepsShort(e);
}

// A week-grid line for an exercise whose rows are its group's rounds: "3×8-10",
// or "21-15-9" when the rounds differ; in an AMRAP, whose one row is the work of
// a round, that round's reps alone, "10". Empty when a round asks no rep count.
export function roundsRepsShort(e: ExerciseDraft, format: GroupFormat): string {
  const rows = buildPrescribedRows(expandSetSpecs(e));
  return (format === "amrap" ? formatRoundRepsOnce(rows) : formatRoundRepsShort(rows)) ?? "";
}
