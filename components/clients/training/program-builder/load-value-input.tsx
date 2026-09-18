"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { loadTypeBounds, type SetSpec } from "@/utils/exercise-set-specs";
import { useUnits } from "@/contexts/units-context";
import { formatLoad } from "@/utils/unit-conversions";
import { formatTargetRange } from "@/utils/target-range";
import {
  commitLoad,
  commitLoadRange,
  commitNum,
  commitRange,
  displayLoad,
  displayLoadRange,
} from "./commit-input";
import { FOCUS_RING, MONO_INPUT_CLASS } from "./builder-tokens";

// The controls for "a prescribed load": one value on a drop row, a value or a
// range ("100-105", "70-75") on a set row.
//
// They exist because the value's meaning depends on the load TYPE, and four
// behaviours have to move together or the control lies:
//
//   1. the suffix  — the viewer's unit for an absolute load, "%" otherwise;
//   2. disabled    — no type chosen means no value can be prescribed, because
//                    "what unit is this in?" has no answer yet;
//   3. the seed    — an UNSNAPPED conversion for kilograms (CONVENTIONS §20:
//                    seeding from formatLoad would round-trip the snap into
//                    set_specs), the raw number for a percentage;
//   4. the commit  — commitLoad / commitLoadRange convert the viewer's unit to
//                    canonical kilograms behind a dirty guard; a percentage is
//                    unitless and MUST NOT convert.
//
// The drop editor used to hardcode all four to kilograms. That was correct only
// while a drop could not hold a percentage; the moment it can, an imperial coach
// typing 60 for "60% 1RM" would have it read as 60 lb and stored as 27.2.

/**
 * The absolute option's label and suffix are the VIEWER's unit; the percentage
 * options are unitless. Built per render rather than as a module constant
 * because it depends on who is looking.
 */
export const loadOptions = (loadUnit: string) =>
  [
    { value: "absolute", label: loadUnit, suffix: loadUnit },
    { value: "pct_1rm", label: "% 1RM", suffix: "%" },
    { value: "pct_top", label: "% top set", suffix: "%" },
  ] as const;

type LoadValueInputProps = {
  /** The load type this value is expressed in. Null disables the field. */
  loadType: SetSpec["load_type"];
  /** Canonical kilograms for an absolute load, a raw percentage otherwise. */
  value: number | null;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
  /** Fired only when the value actually changed. */
  onCommit: (value: number | null) => void;
};

/** One load value: a drop's, in its parent set's load type. */
export function LoadValueInput({
  loadType,
  value,
  disabled = false,
  ariaLabel,
  className,
  onCommit,
}: LoadValueInputProps) {
  const { preference } = useUnits();
  const loadUnit = formatLoad(0, preference).unit;
  const isAbsolute = loadType === "absolute";
  const suffix =
    loadOptions(loadUnit).find((o) => o.value === loadType)?.suffix ?? "";
  const bounds = loadTypeBounds(loadType);

  return (
    <Input
      type="number"
      min={bounds.floor}
      max={bounds.ceiling}
      disabled={disabled || !loadType}
      // Keyed on the load type so switching it re-seeds the field: the same
      // digits mean a different thing under a new unit, and a stale
      // defaultValue would leave the old rendering in place.
      key={loadType ?? "none"}
      defaultValue={isAbsolute ? displayLoad(value, preference) : (value ?? "")}
      placeholder={suffix}
      aria-label={ariaLabel}
      className={cn(MONO_INPUT_CLASS, "h-7 px-1 text-[11px]", FOCUS_RING, className)}
      onBlur={(e) => {
        if (!isAbsolute) {
          onCommit(commitNum(e, { min: bounds.floor, max: bounds.ceiling }));
          return;
        }
        // Guarded: a focus-through must not write. Display rounding is lossy in
        // both directions, so re-committing an untouched field would drift the
        // coach's prescription with nobody editing it.
        const commit = commitLoad(e, value, preference, {
          min: bounds.floor,
          max: bounds.ceiling,
        });
        if (commit.changed) onCommit(commit.valueKg);
      }}
    />
  );
}

type LoadRangeInputProps = {
  loadType: SetSpec["load_type"];
  /** The stored pair: canonical kilograms for an absolute load, percentages otherwise. */
  min: number | null;
  max: number | null;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
  /** Fired only when the pair actually changed. */
  onCommit: (range: { min: number | null; max: number | null }) => void;
};

/** A set's load: one value or a range, in its load type's unit. */
export function LoadRangeInput({
  loadType,
  min,
  max,
  disabled = false,
  ariaLabel,
  className,
  onCommit,
}: LoadRangeInputProps) {
  const { preference } = useUnits();
  const loadUnit = formatLoad(0, preference).unit;
  const isAbsolute = loadType === "absolute";
  const suffix =
    loadOptions(loadUnit).find((o) => o.value === loadType)?.suffix ?? "";
  const bounds = loadTypeBounds(loadType);

  return (
    <Input
      maxLength={19}
      disabled={disabled || !loadType}
      key={loadType ?? "none"}
      defaultValue={
        isAbsolute
          ? displayLoadRange(min, max, preference)
          : formatTargetRange({ min, max })
      }
      placeholder={suffix}
      aria-label={ariaLabel}
      className={cn(MONO_INPUT_CLASS, "h-7 px-1 text-[11px]", FOCUS_RING, className)}
      onFocus={(e) => {
        // Select-all so a prefilled range is typed over, not deleted.
        e.target.select();
      }}
      onBlur={(e) => {
        if (!isAbsolute) {
          const commit = commitRange(e, { min, max }, bounds);
          if (commit.changed) onCommit(commit.range);
          return;
        }
        const commit = commitLoadRange(e, min, max, preference);
        if (commit.changed) onCommit({ min: commit.minKg, max: commit.maxKg });
      }}
    />
  );
}
