"use client";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/programs/shared/segmented-control";
import {
  LABEL_CLASS,
  MONO,
  MONO_INPUT_CLASS,
  FOCUS_RING,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { useEditTargetsForm, DeltaMode } from "./use-edit-targets-form";

type AdjustByTabProps = {
  form: ReturnType<typeof useEditTargetsForm>;
};

const QUICK_CHIPS: Record<DeltaMode, number[]> = {
  kcal: [-300, -200, -100, 100, 200],
  percent: [-10, -5, -2, 2, 5],
};

const STEP: Record<DeltaMode, number> = { kcal: 50, percent: 5 };

const STEPPER_CLASS =
  "rounded-[6px] border border-[rgba(13,148,136,0.08)] p-1.5 text-[#93b0b4] transition-colors hover:bg-[rgba(13,148,136,0.05)] hover:text-[#0d9488]";

function chipLabel(value: number, mode: DeltaMode): string {
  return `${value > 0 ? "+" : ""}${value}${mode === "percent" ? "%" : ""}`;
}

/** Relative tab: kcal/% adjustment with steppers + quick chips, the
 * hold-protein switch, and the per-day preview list. */
export function NutritionAdjustByTab({ form }: AdjustByTabProps) {
  const { deltaMode, previewRows } = form;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <SegmentedControl
          options={[
            { value: "kcal", label: "kcal" },
            { value: "percent", label: "%" },
          ]}
          value={deltaMode}
          onChange={(v) => form.switchDeltaMode(v as DeltaMode)}
        />
        <div className="flex-1" />
        <button
          type="button"
          aria-label="Decrease adjustment"
          className={STEPPER_CLASS}
          onClick={() => form.stepDelta(-STEP[deltaMode])}
        >
          <Minus className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
        <Input
          type="number"
          inputMode="numeric"
          aria-label="Adjustment amount"
          value={form.deltaValue}
          onChange={(e) => form.setDeltaValue(e.target.value)}
          placeholder={deltaMode === "kcal" ? "e.g. -200" : "e.g. -10"}
          className={cn(MONO_INPUT_CLASS, FOCUS_RING, "h-8 w-24 text-[12px]")}
        />
        <button
          type="button"
          aria-label="Increase adjustment"
          className={STEPPER_CLASS}
          onClick={() => form.stepDelta(STEP[deltaMode])}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {QUICK_CHIPS[deltaMode].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => form.setDeltaValue(String(value))}
            className={cn(
              MONO,
              "rounded-[4px] bg-[#f0f5f4] px-2 py-1 text-[11px] font-medium text-[#5a7d82] transition-colors hover:bg-[rgba(13,148,136,0.08)] hover:text-[#0a5c55]"
            )}
          >
            {chipLabel(value, deltaMode)}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 rounded-[6px] border border-[rgba(13,148,136,0.08)] px-3 py-2.5">
        <div>
          <p className="text-[13px] font-medium text-[#0c1a1e]">Hold protein steady</p>
          <p className="mt-0.5 text-[11px] text-[#93b0b4]">
            {form.holdProtein
              ? "The adjustment comes out of carbs and fat, keeping their ratio."
              : "All three macros scale with the calorie change."}
          </p>
        </div>
        <Switch
          checked={form.holdProtein}
          onCheckedChange={form.setHoldProtein}
          aria-label="Hold protein steady"
        />
      </div>

      <div className="space-y-1.5">
        <span className={LABEL_CLASS}>Preview</span>
        {previewRows.length === 0 ? (
          <p className="text-xs text-[#93b0b4]">Enter an adjustment to preview each day.</p>
        ) : (
          <div className="max-h-[240px] overflow-y-auto rounded-[6px] border border-[rgba(13,148,136,0.08)]">
            {previewRows.map((row) => (
              <div
                key={row.date}
                className="flex items-center gap-2 border-b border-[rgba(13,148,136,0.06)] px-3 py-1.5 last:border-b-0"
              >
                <span className={cn(MONO, "w-14 shrink-0 text-[11px] text-[#5a7d82]")}>
                  {row.label}
                </span>
                <span className={cn(MONO, "flex-1 text-center text-[11px]")}>
                  <span className="text-[#93b0b4]">{row.base.toLocaleString()}</span>
                  <span className="mx-1 text-[#93b0b4]">→</span>
                  <span className="font-semibold text-[#0c1a1e]">
                    {row.next.toLocaleString()}
                  </span>
                  <span className="ml-1 text-[9px] text-[#93b0b4]">kcal</span>
                </span>
                <span
                  className={cn(
                    MONO,
                    "shrink-0 rounded-[4px] px-1.5 py-0.5 text-[10px] font-medium",
                    row.delta < 0
                      ? "bg-[rgba(13,148,136,0.08)] text-[#0d9488]"
                      : row.delta > 0
                        ? "bg-[rgba(245,158,11,0.07)] text-[#d97706]"
                        : "bg-[rgba(0,0,0,0.03)] text-[#93b0b4]"
                  )}
                >
                  {row.delta > 0 ? "+" : ""}
                  {row.delta.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
