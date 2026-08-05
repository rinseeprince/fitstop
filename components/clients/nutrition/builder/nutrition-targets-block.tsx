"use client";

import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/programs/shared/segmented-control";
import {
  FOCUS_RING,
  LABEL_CLASS,
  MONO,
  SECTION_LABEL_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { MacroTargets, ManualDraft } from "@/hooks/use-manual-targets";
import type { NutritionPlan } from "@/services/nutrition-service";

type NutritionTargetsBlockProps = {
  /** What the fields show. Values may be null while the coach is mid-edit. */
  draft: ManualDraft | null;
  /** The live auto result, kept available in manual mode for the hint line. */
  autoPlan: NutritionPlan | null;
  autoTargets: MacroTargets | null;
  manualEnabled: boolean;
  onEnableManual: (from: MacroTargets) => void;
  onRevertToAuto: () => void;
  onFieldChange: (key: keyof ManualDraft, value: number | null) => void;
  /** 4/4/9 over the entered macros, or null while incomplete. */
  macroTotal: number | null;
  caloriesMismatch: boolean;
  onMatchMacros: () => void;
  /** `validateClientForNutrition` messages when the client lacks the data the
   *  calculator needs. Non-empty means nothing can be previewed at all. */
  missing: string[];
};

const FIELD_CLASS =
  "w-full rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-white px-2 py-1.5 text-center text-[15px] font-semibold text-[#0c1a1e] transition-all read-only:bg-[#f7faf9] read-only:text-[#5a7d82] hover:border-[rgba(13,148,136,0.25)] read-only:hover:border-[rgba(13,148,136,0.08)]";

/** "" is EMPTY, not 0 — conflating them is what made these fields unwritable. */
function parseField(value: string): number | null {
  if (value.trim() === "") return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * The calorie + macro targets, live.
 *
 * Replaces the old Auto/Custom tab pair. Those were a false choice: the Auto
 * tab showed the pickers but never what they produced (the calculation was
 * server-side, so the numbers only appeared after saving), and the Custom tab
 * showed editable numbers but hid the pickers — while still posting them. The
 * coach had to choose between seeing the controls and seeing the result.
 *
 * Now the pickers are always visible above this block and these fields update
 * as they move. "Edit manually" hands the numbers over without hiding anything.
 */
export function NutritionTargetsBlock({
  draft,
  autoPlan,
  autoTargets,
  manualEnabled,
  onEnableManual,
  onRevertToAuto,
  onFieldChange,
  macroTotal,
  caloriesMismatch,
  onMatchMacros,
  missing,
}: NutritionTargetsBlockProps) {
  // Nothing can be calculated for this client yet. Say which data is missing
  // rather than rendering a plausible-looking zero — a browser has no
  // equivalent of the server's validate-then-assert, so an ungated calculation
  // here yields NaN (undefined bmr) or 0 (null bmr), and 0 reads as a number.
  if (missing.length > 0) {
    return (
      <div className="space-y-2">
        <label className={SECTION_LABEL_CLASS}>Targets</label>
        <div className="flex items-start gap-2.5 rounded-[6px] bg-[rgba(245,158,11,0.07)] p-3.5">
          <AlertCircle
            className="mt-0.5 h-3 w-3 flex-shrink-0 text-[#d97706]"
            strokeWidth={1.5}
          />
          <div className="space-y-1">
            {missing.map((m) => (
              <p key={m} className="text-[11.5px] font-medium leading-[1.4] text-[#d97706]">
                {m}
              </p>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const readOnly = !manualEnabled;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <label className={SECTION_LABEL_CLASS}>Targets</label>
        <SegmentedControl
          options={[
            { value: "auto", label: "Auto" },
            { value: "manual", label: "Edit manually" },
          ]}
          value={manualEnabled ? "manual" : "auto"}
          onChange={(v) => {
            if (v === "manual") {
              // Seed from what is on screen RIGHT NOW, not from whatever the
              // plan happened to store. Switching to manual on an auto plan
              // used to present a row of zeros instead of the live numbers.
              if (autoTargets) onEnableManual(autoTargets);
            } else {
              onRevertToAuto();
            }
          }}
        />
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Field label="kcal" value={draft?.calories ?? null} readOnly={readOnly}
          onChange={(v) => onFieldChange("calories", v)} />
        <Field label="Protein" suffix="g" value={draft?.proteinG ?? null} readOnly={readOnly}
          onChange={(v) => onFieldChange("proteinG", v)} />
        <Field label="Carbs" suffix="g" value={draft?.carbG ?? null} readOnly={readOnly}
          onChange={(v) => onFieldChange("carbG", v)} />
        <Field label="Fat" suffix="g" value={draft?.fatG ?? null} readOnly={readOnly}
          onChange={(v) => onFieldChange("fatG", v)} />
      </div>

      {/* What the calculation is doing, so the number is explicable rather than
          arbitrary. Numerals in mono; the words around them stay sans. */}
      {autoPlan && !manualEnabled && (
        <p className="text-[11px] leading-[1.4] text-[#93b0b4]">
          TDEE <span className={cn(MONO, "text-[#5a7d82]")}>{autoPlan.tdee.toLocaleString()}</span>
          {autoPlan.requiredDailyDeficit !== 0 && (
            <>
              {" · "}
              <span className={cn(MONO, "text-[#5a7d82]")}>
                {autoPlan.requiredDailyDeficit > 0 ? "−" : "+"}
                {Math.abs(Math.round(autoPlan.requiredDailyDeficit)).toLocaleString()}
              </span>
              /day
            </>
          )}
          {autoPlan.weeklyWeightChangeKg !== 0 && (
            <>
              {" · "}
              <span className={cn(MONO, "text-[#5a7d82]")}>
                {autoPlan.weeklyWeightChangeKg > 0 ? "+" : "−"}
                {Math.abs(autoPlan.weeklyWeightChangeKg).toFixed(2)}
              </span>
              {" kg/week"}
            </>
          )}
        </p>
      )}

      {/* Manual wins: a picker change recalculates in the background and is
          offered here, never written into the coach's typed numbers. */}
      {manualEnabled && autoTargets && (
        <p className="text-[11px] leading-[1.4] text-[#93b0b4]">
          Auto suggests{" "}
          <span className={cn(MONO, "text-[#5a7d82]")}>
            {autoTargets.calories.toLocaleString()}
          </span>{" "}
          kcal ·{" "}
          <button
            type="button"
            onClick={onRevertToAuto}
            className={cn(
              FOCUS_RING,
              "rounded-[4px] font-medium text-[#0d9488] transition-colors hover:text-[#0b7f75]"
            )}
          >
            Revert to auto
          </button>
        </p>
      )}

      {/* Passive coherence readout. NOT a block — the coach types freely and the
          gate is at Generate. When the macros disagree with the entered calorie
          target by more than the server tolerates, say so and offer the fix,
          rather than silently rewriting fields as they type. */}
      {manualEnabled && macroTotal !== null && (
        <p className="text-[11px] leading-[1.4] text-[#93b0b4]">
          Macros total{" "}
          <span className={cn(MONO, caloriesMismatch ? "text-[#d97706]" : "text-[#5a7d82]")}>
            {macroTotal.toLocaleString()}
          </span>{" "}
          kcal
          {caloriesMismatch && (
            <>
              {" · "}
              <button
                type="button"
                onClick={onMatchMacros}
                className={cn(
                  FOCUS_RING,
                  "rounded-[4px] font-medium text-[#0d9488] transition-colors hover:text-[#0b7f75]"
                )}
              >
                Match macros to calories
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  suffix,
  value,
  readOnly,
  onChange,
}: {
  label: string;
  suffix?: string;
  value: number | null;
  readOnly: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="space-y-1">
      <input
        type="number"
        inputMode="numeric"
        readOnly={readOnly}
        tabIndex={readOnly ? -1 : undefined}
        value={value ?? ""}
        onChange={(e) => onChange(parseField(e.target.value))}
        className={cn(MONO, FIELD_CLASS, FOCUS_RING)}
      />
      <p className={cn(LABEL_CLASS, "text-center")}>
        {label}
        {suffix ? ` (${suffix})` : ""}
      </p>
    </div>
  );
}
