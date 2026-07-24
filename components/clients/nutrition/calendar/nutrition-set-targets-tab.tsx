"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  LABEL_CLASS,
  MONO_INPUT_CLASS,
  FOCUS_RING,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { useEditTargetsForm } from "./use-edit-targets-form";

type SetTargetsTabProps = {
  form: ReturnType<typeof useEditTargetsForm>;
};

const MACRO_INPUT = cn(MONO_INPUT_CLASS, FOCUS_RING, "h-8 text-[12px]");

/** Absolute tab: dominant calories field, macro trio, live split bar and the
 * macros-vs-calories reconcile line. */
export function NutritionSetTargetsTab({ form }: SetTargetsTabProps) {
  const { seed, macroState, macroCals, diff, matched, cal, p, c, f } = form;
  const anyMixed =
    seed.calories.mixed || seed.protein.mixed || seed.carbs.mixed || seed.fat.mixed;

  // kcal shares for the split bar (verbatim trio only — it needs all three).
  const p4 = (p ?? 0) * 4;
  const c4 = (c ?? 0) * 4;
  const f9 = (f ?? 0) * 9;

  return (
    <div className="space-y-3">
      {anyMixed && (
        <div className="rounded-[6px] bg-[#f0f5f4] px-3 py-2 text-xs text-[#5a7d82]">
          {seed.calorieRange && (
            <>
              Selected days currently range{" "}
              <span className="font-semibold">
                {seed.calorieRange.min.toLocaleString()} – {seed.calorieRange.max.toLocaleString()} kcal
              </span>
              .{" "}
            </>
          )}
          Blank protein keeps each day&apos;s own value; blank carbs and fat are
          rebalanced per day around the new calories.
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="et-cal" className={LABEL_CLASS}>
          Calories
        </label>
        <Input
          id="et-cal"
          type="number"
          inputMode="numeric"
          value={form.calories}
          onChange={(e) => form.onCaloriesChange(e.target.value)}
          placeholder={seed.calories.mixed ? "Mixed" : undefined}
          className={cn(MONO_INPUT_CLASS, FOCUS_RING, "h-9 text-[13px] font-semibold")}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="et-p" className={LABEL_CLASS}>
            Protein (g)
          </label>
          <Input
            id="et-p"
            type="number"
            inputMode="numeric"
            value={form.protein}
            onChange={(e) => form.setProtein(e.target.value)}
            placeholder={seed.protein.mixed ? "Mixed" : undefined}
            className={MACRO_INPUT}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="et-c" className={LABEL_CLASS}>
            Carbs (g)
          </label>
          <Input
            id="et-c"
            type="number"
            inputMode="numeric"
            value={form.carbs}
            onChange={(e) => form.setCarbs(e.target.value)}
            placeholder={seed.carbs.mixed ? "Mixed" : undefined}
            className={MACRO_INPUT}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="et-f" className={LABEL_CLASS}>
            Fat (g)
          </label>
          <Input
            id="et-f"
            type="number"
            inputMode="numeric"
            value={form.fat}
            onChange={(e) => form.setFat(e.target.value)}
            placeholder={seed.fat.mixed ? "Mixed" : undefined}
            className={MACRO_INPUT}
          />
        </div>
      </div>

      {macroState === "verbatim" && macroCals > 0 && (
        <div className="flex h-1.5 overflow-hidden rounded-full">
          <div className="bg-protein" style={{ width: `${(p4 / macroCals) * 100}%` }} />
          <div className="bg-carbs" style={{ width: `${(c4 / macroCals) * 100}%` }} />
          <div className="bg-fat" style={{ width: `${(f9 / macroCals) * 100}%` }} />
        </div>
      )}

      {/* Reconcile line — meaningful only when all three macros are present. */}
      {macroState === "verbatim" && (
        <p className={cn("text-[11px] font-medium", matched ? "text-[#0d9488]" : "text-[#d97706]")}>
          {cal != null && cal > 0 ? (
            matched ? (
              <>Macros = {macroCals.toLocaleString()} kcal · matches calories</>
            ) : (
              <>
                Macros = {macroCals.toLocaleString()} kcal · {Math.abs(diff)}{" "}
                {diff > 0 ? "over" : "under"} calories{" "}
                <button
                  type="button"
                  onClick={form.setCaloriesToMacros}
                  className="font-medium text-[#0d9488] transition-colors hover:text-[#0b7f75]"
                >
                  Set calories to {macroCals.toLocaleString()}
                </button>
              </>
            )
          ) : (
            <span className="text-[#93b0b4]">Macros = {macroCals.toLocaleString()} kcal</span>
          )}
        </p>
      )}

      {macroState === "invalid" && (
        <p className="text-[11px] font-medium text-[#d97706]">
          Fill protein, carbs and fat together to set macros exactly — or clear
          carbs and fat to auto-balance each day.
        </p>
      )}
    </div>
  );
}
