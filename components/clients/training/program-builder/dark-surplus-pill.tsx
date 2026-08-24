"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  FOCUS_RING,
  MONO_INPUT_CLASS,
  STAT_LABEL_DARK_CLASS,
} from "./builder-tokens";

// The bordered surplus pill that sits on the right of a dark hero band: word
// label, borderless mono input, % suffix. Extracted from program-top-bar when
// the session-editor hero needed the same control — one component so the two
// heroes cannot drift apart.
//
// The label is SANS (STAT_LABEL_DARK_CLASS), not mono: "Surplus" is a word-only
// string and mono is numbers only. The design doc's prose still says mono here;
// the shipped program hero has always been sans and shipped code wins.
//
// Blank means "inherit" (null) and must NEVER be coerced to a number — dropping
// a session's surplus silently reverts that client's nutrition to rest-day
// calories.
type DarkSurplusPillProps = {
  // Keyed by the caller so reseeding a different draft re-reads defaultValue.
  inputKey: string;
  value: number | null;
  disabled: boolean;
  // What blank inherits FROM, shown as the placeholder ("—", "Default 12%").
  placeholder: string;
  ariaLabel: string;
  onChange: (pct: number | null) => void;
};

export function DarkSurplusPill({
  inputKey,
  value,
  disabled,
  placeholder,
  ariaLabel,
  onChange,
}: DarkSurplusPillProps) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 rounded-[6px] border border-[rgba(255,255,255,0.14)] px-2.5 py-1">
      <span className={STAT_LABEL_DARK_CLASS}>Surplus</span>
      <Input
        key={inputKey}
        type="number"
        min={0}
        max={100}
        step={0.5}
        disabled={disabled}
        defaultValue={value ?? ""}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={cn(
          MONO_INPUT_CLASS,
          "h-6 w-10 border-0 bg-transparent px-0 text-xs text-white shadow-none placeholder:text-[rgba(255,255,255,0.35)]",
          FOCUS_RING,
        )}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          if (raw === "") {
            onChange(null);
            return;
          }
          const parsed = Number(raw);
          const clamped = Number.isFinite(parsed)
            ? Math.min(100, Math.max(0, parsed))
            : null;
          onChange(clamped);
          e.target.value = clamped == null ? "" : String(clamped);
        }}
      />
      <span className="text-[10px] text-[rgba(255,255,255,0.4)]">%</span>
    </div>
  );
}
