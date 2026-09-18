"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useUnits } from "@/contexts/units-context";
import { SET_SPEC_MEASURES, type SetSpecMeasure } from "@/utils/exercise-set-specs";
import { BOX_WORDS, SET_LOG_MEASURES } from "@/utils/set-log-measures";
import { formatEntryRange, formatTargetRange, type TargetRange } from "@/utils/target-range";
import type { UnitSystem } from "@/utils/unit-conversions";
import { commitEntryRange, commitRange } from "./commit-input";
import { FOCUS_RING, MONO_INPUT_CLASS } from "./builder-tokens";

// One box for one measure of one set: a value or a range, in the grammar the
// measure's box speaks everywhere (utils/set-log-measures.ts names it, the
// client's log form types it the same way). A plain number — RPE, RIR,
// calories, cadence, stroke rate, resistance, target HR, power, % FTP — is the
// range grammar with the column's bounds ("7-8"); a distance, duration, pace,
// split or zone is the entry grammar at each end, typed and read in the
// viewer's units and stored canonically ("400-800 m", "3:45-3:50 /km",
// "2:00-2:30", "Z2-Z3"). Reps and Load keep their own boxes: reps for its
// legacy target handling, load for its type selector and kilogram guard.
//
// Uncontrolled and committed on blur behind the seeded-string guard, like
// every box in the set grid: a focus-through writes nothing, a typo reverts,
// and the box shows what it recorded when the coach leaves it.
type MeasureColumn = Exclude<SetSpecMeasure, "reps" | "load">;

/** The hint in an empty box: the viewer's unit, or the measure's own word. */
function placeholderFor(measure: MeasureColumn, viewer: UnitSystem): string {
  switch (measure) {
    case "rpe":
      return "RPE";
    case "rir":
      return "RIR";
    case "distance":
      return viewer === "imperial" ? "mi" : "km";
    case "duration":
      return "mm:ss";
    case "pace":
      return viewer === "imperial" ? "/mi" : "/km";
    case "split":
      return "/500m";
    case "calories":
      return "kcal";
    case "cadence":
      return "rpm";
    case "stroke_rate":
      return "spm";
    case "resistance":
      return "level";
    case "heart_rate_zone":
      return "zone";
    case "heart_rate":
      return "bpm";
    case "power":
      return "W";
    case "ftp_percent":
      return "%";
  }
}

type MeasureRangeInputProps = {
  measure: MeasureColumn;
  /** The stored pair, canonical. */
  min: number | null;
  max: number | null;
  setNumber: number;
  disabled?: boolean;
  className?: string;
  /** Fired only when the pair actually changed. */
  onCommit: (range: TargetRange) => void;
};

export function MeasureRangeInput({
  measure,
  min,
  max,
  setNumber,
  disabled = false,
  className,
  onCommit,
}: MeasureRangeInputProps) {
  const { preference } = useUnits();
  const entry = SET_LOG_MEASURES[measure].entry;
  const bounds = SET_SPEC_MEASURES[measure];
  const stored = { min, max };
  const plainNumber = entry === "number";

  return (
    <Input
      maxLength={plainNumber ? 15 : 32}
      disabled={disabled}
      defaultValue={
        plainNumber ? formatTargetRange(stored) : formatEntryRange(entry, stored, preference)
      }
      placeholder={placeholderFor(measure, preference)}
      aria-label={`Set ${setNumber} ${BOX_WORDS[measure]}`}
      className={cn(MONO_INPUT_CLASS, "h-7 px-1 text-[11px]", FOCUS_RING, className)}
      onFocus={(e) => {
        // Select-all so a prefilled value is typed over, not deleted.
        e.target.select();
      }}
      onBlur={(e) => {
        const commit = plainNumber
          ? commitRange(e, stored, bounds)
          : commitEntryRange(e, stored, entry, preference, bounds);
        if (commit.changed) onCommit(commit.range);
      }}
    />
  );
}
