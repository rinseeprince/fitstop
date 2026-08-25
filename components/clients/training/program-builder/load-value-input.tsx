"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SetSpec } from "@/utils/exercise-set-specs";
import { useUnits } from "@/contexts/units-context";
import { formatLoad } from "@/utils/unit-conversions";
import { commitLoad, commitNum, displayLoad } from "./commit-input";
import { FOCUS_RING, MONO_INPUT_CLASS } from "./builder-tokens";

// The one control for "a prescribed load value", shared by a set row and by the
// drop rows underneath it.
//
// It exists because the value's meaning depends on the load TYPE, and four
// behaviours have to move together or the control lies:
//
//   1. the suffix  — the viewer's unit for an absolute load, "%" otherwise;
//   2. disabled    — no type chosen means no value can be prescribed, because
//                    "what unit is this in?" has no answer yet;
//   3. the seed    — an UNSNAPPED conversion for kilograms (CONVENTIONS §20:
//                    seeding from formatLoad would round-trip the snap into
//                    set_specs), the raw number for a percentage;
//   4. the commit  — commitLoad converts the viewer's unit to canonical
//                    kilograms behind a dirty guard; a percentage is unitless
//                    and MUST NOT convert.
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

/** Bounds describe STORAGE, so they are applied after conversion (§20). */
const LOAD_VALUE_MIN = 0;
const LOAD_VALUE_MAX = 2000;

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

  return (
    <Input
      type="number"
      min={LOAD_VALUE_MIN}
      max={LOAD_VALUE_MAX}
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
          onCommit(commitNum(e, { min: LOAD_VALUE_MIN, max: LOAD_VALUE_MAX }));
          return;
        }
        // Guarded: a focus-through must not write. Display rounding is lossy in
        // both directions, so re-committing an untouched field would drift the
        // coach's prescription with nobody editing it.
        const commit = commitLoad(e, value, preference, {
          min: LOAD_VALUE_MIN,
          max: LOAD_VALUE_MAX,
        });
        if (commit.changed) onCommit(commit.valueKg);
      }}
    />
  );
}
