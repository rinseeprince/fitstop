"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  LABEL_CLASS,
  MONO,
  MONO_INPUT_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import {
  MACRO_ORDER,
  setGrams,
  splitToGrams,
  splitToThumbs,
  thumbsToSplit,
  type Macro,
  type MacroBalanceValue,
  type MacroGrams,
} from "@/lib/nutrition/macro-balance";

type MacroBalanceProps = {
  value: MacroBalanceValue;
  onChange: (next: MacroBalanceValue) => void;
};

const MACRO_META: Record<Macro, { label: string; dot: string; gramKey: keyof MacroGrams }> = {
  carbs: { label: "Carbs", dot: "bg-carbs", gramKey: "carbG" },
  fat: { label: "Fat", dot: "bg-fat", gramKey: "fatG" },
  protein: { label: "Protein", dot: "bg-protein", gramKey: "proteinG" },
};

/** The two boundaries, in the slider's order — the thumbs' accessible names. */
const THUMB_LABELS = ["Carbs and fat boundary", "Fat and protein boundary"] as const;

/** "" is EMPTY, not 0; anything that is not a whole non-negative number is empty too. */
function parseWhole(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/**
 * The macro balancer — MyFitnessPal's goal setter (owner decision 2026-09-10).
 * ONE calorie target over a two-thumb slider that splits it across carbs, fat
 * and protein; grams derive at 4 / 4 / 9 kcal per gram; the calories are held
 * whatever the thumbs do. The arithmetic is `lib/nutrition/macro-balance.ts`;
 * this renders it and nothing else. Coach-facing, shared by the builder's
 * "Edit manually" and the per-day editor's Set targets tab, so the four
 * numbers either one saves cannot disagree.
 *
 * A manual edit is the coach's hand alone: no presets, no diet type. The diet
 * type belongs to the calculated path (owner, 2026-09-10).
 *
 * Controlled: the parent owns the value. The three gram inputs are the one
 * place a draft lives — while a coach is typing "180" the field shows the
 * keystrokes and the thumbs follow each one, and on blur the field reads the
 * grams the (whole-percent) split now derives.
 */
export function MacroBalance({ value, onChange }: MacroBalanceProps) {
  const caloriesId = useId();
  const { calories, split } = value;
  const hasCalories = calories != null && calories > 0;
  const grams = splitToGrams(calories ?? 0, split);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor={caloriesId} className={LABEL_CLASS}>
          Calories
        </label>
        <Input
          id={caloriesId}
          type="number"
          inputMode="numeric"
          min={0}
          value={calories ?? ""}
          onChange={(e) => onChange({ ...value, calories: parseWhole(e.target.value) })}
          className={cn(MONO_INPUT_CLASS, "h-9 text-[15px] font-semibold")}
        />
      </div>

      <div className="space-y-3 rounded-[6px] border border-[rgba(13,148,136,0.08)] p-3.5">
        <span className={LABEL_CLASS}>Macro split</span>

        {/* The track IS the split: three colour bands whose boundaries are the
            thumbs, in MFP's order. 1% steps; the thumbs may touch but never
            cross, so fat can shrink to a percent and no further by dragging. */}
        <Slider
          value={splitToThumbs(split)}
          min={0}
          max={100}
          step={1}
          minStepsBetweenThumbs={1}
          onValueChange={(thumbs) => onChange({ ...value, split: thumbsToSplit(thumbs) })}
          thumbLabels={THUMB_LABELS}
          trackContent={
            <div className="flex h-full w-full" aria-hidden>
              {MACRO_ORDER.map((macro) => (
                <div
                  key={macro}
                  className={cn("h-full", MACRO_META[macro].dot)}
                  style={{ width: `${split[macro]}%` }}
                />
              ))}
            </div>
          }
        />

        <div className="grid grid-cols-3 gap-3">
          {MACRO_ORDER.map((macro) => (
            <MacroCell
              key={macro}
              macro={macro}
              percent={split[macro]}
              grams={grams[MACRO_META[macro].gramKey]}
              disabled={!hasCalories}
              onGrams={(next) =>
                onChange({ ...value, split: setGrams(split, calories ?? 0, macro, next) })
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function MacroCell({
  macro,
  percent,
  grams,
  disabled,
  onGrams,
}: {
  macro: Macro;
  percent: number;
  grams: number;
  disabled: boolean;
  onGrams: (grams: number) => void;
}) {
  const id = useId();
  // The typed text while the field has focus; null shows the derived grams.
  const [draft, setDraft] = useState<string | null>(null);
  const meta = MACRO_META[macro];

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", meta.dot)} aria-hidden />
        <label htmlFor={id} className="text-[11px] font-medium text-[#5a7d82]">
          {meta.label}
        </label>
      </div>
      <p className={cn(MONO, "mt-1 text-[15px] font-semibold text-[#0c1a1e]")}>{percent}%</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={0}
          disabled={disabled}
          value={draft ?? (disabled ? "" : String(grams))}
          onFocus={() => setDraft(String(grams))}
          onChange={(e) => {
            setDraft(e.target.value);
            const next = parseWhole(e.target.value);
            if (next != null) onGrams(next);
          }}
          onBlur={() => setDraft(null)}
          className={cn(MONO_INPUT_CLASS, "h-8 text-[12px]")}
        />
        <span className="text-[11px] text-[#93b0b4]">g</span>
      </div>
    </div>
  );
}
