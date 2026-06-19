"use client";

import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { calculateDailyMacros } from "@/utils/nutrition-helpers";
import type { DietType } from "@/types/check-in";

type Mode = "absolute" | "delta";

/** The materialized-edit payload sent to PATCH …/nutrition/events/range. */
export type RangeEditPayload =
  | { mode: "absolute"; calories: number; proteinG?: number; carbG?: number; fatG?: number }
  | { mode: "delta"; percent?: number; calorieDelta?: number };

type NutritionRangeEditDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Number of eligible days the edit will apply to. */
  dayCount: number;
  /** Diet type of the first selected day — drives the macro auto-rebalance preview. */
  dietType: DietType;
  /** Protein (g) of the first selected day — the default "held" protein. */
  defaultProtein: number;
  isSaving: boolean;
  onApply: (payload: RangeEditPayload) => void;
};

function toInt(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function NutritionRangeEditDialog({
  open,
  onOpenChange,
  dayCount,
  dietType,
  defaultProtein,
  isSaving,
  onApply,
}: NutritionRangeEditDialogProps) {
  const [mode, setMode] = useState<Mode>("absolute");

  // Absolute
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [manualMacros, setManualMacros] = useState(false);
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");

  // Delta
  const [percent, setPercent] = useState("");
  const [calorieDelta, setCalorieDelta] = useState("");

  const caloriesNum = toInt(calories);
  const proteinNum = toInt(protein);
  const percentNum = toInt(percent);
  const calorieDeltaNum = toInt(calorieDelta);

  // Auto-rebalanced macro preview (protein held; carbs/fat split by diet type).
  const autoMacros = useMemo(() => {
    if (caloriesNum == null || caloriesNum <= 0) return null;
    return calculateDailyMacros(caloriesNum, proteinNum ?? defaultProtein, false, dietType);
  }, [caloriesNum, proteinNum, defaultProtein, dietType]);

  const valid =
    mode === "absolute"
      ? caloriesNum != null && caloriesNum > 0
      : percentNum != null || calorieDeltaNum != null;

  function reset() {
    setMode("absolute");
    setCalories("");
    setProtein("");
    setManualMacros(false);
    setCarbs("");
    setFat("");
    setPercent("");
    setCalorieDelta("");
  }

  function handleApply() {
    if (!valid) return;
    if (mode === "absolute") {
      const payload: RangeEditPayload = { mode: "absolute", calories: caloriesNum as number };
      if (manualMacros) {
        // Explicit macros win — send all three (server stores them verbatim).
        payload.proteinG = proteinNum ?? defaultProtein;
        payload.carbG = toInt(carbs) ?? autoMacros?.carbsG ?? 0;
        payload.fatG = toInt(fat) ?? autoMacros?.fatG ?? 0;
      } else if (proteinNum != null) {
        // Hold this protein; let the server rebalance carbs/fat to the new total.
        payload.proteinG = proteinNum;
      }
      onApply(payload);
    } else {
      onApply({
        mode: "delta",
        percent: percentNum ?? undefined,
        calorieDelta: calorieDeltaNum ?? undefined,
      });
    }
  }

  // Seed the manual carb/fat fields from the live auto preview when toggled on.
  function enableManual(on: boolean) {
    setManualMacros(on);
    if (on && autoMacros) {
      if (carbs.trim() === "") setCarbs(String(autoMacros.carbsG));
      if (fat.trim() === "") setFat(String(autoMacros.fatG));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {dayCount} {dayCount === 1 ? "day" : "days"}</DialogTitle>
          <DialogDescription>
            Sets the calorie target on the selected days; macros auto-rebalance
            (protein held). Edited days freeze — training surplus stops stacking.
          </DialogDescription>
        </DialogHeader>

        {/* Mode toggle */}
        <div className="inline-flex bg-[rgba(13,148,136,0.05)] rounded-[6px] p-[2px] self-start">
          {(["absolute", "delta"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "px-3 py-1.5 text-[12.5px] font-medium rounded-[4px] transition-all",
                mode === m
                  ? "bg-white text-[#0c1a1e] shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
                  : "text-[#5a7d82] hover:text-[#0c1a1e]"
              )}
            >
              {m === "absolute" ? "Set to" : "Adjust by"}
            </button>
          ))}
        </div>

        {mode === "absolute" ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="range-calories" className="text-xs font-medium text-foreground">
                Calories
              </Label>
              <Input
                id="range-calories"
                type="number"
                inputMode="numeric"
                value={calories}
                onChange={(e) => setCalories(e.target.value)}
                placeholder="e.g. 1800"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="range-protein" className="text-xs font-medium text-foreground">
                Protein (g) <span className="text-[#93b0b4] font-normal">— optional, held fixed</span>
              </Label>
              <Input
                id="range-protein"
                type="number"
                inputMode="numeric"
                value={protein}
                onChange={(e) => setProtein(e.target.value)}
                placeholder={`default ${defaultProtein}`}
                className="h-9"
              />
            </div>

            {/* Macro preview / manual override */}
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[#93b0b4]">
                {autoMacros
                  ? `Macros: ${autoMacros.proteinG}p · ${manualMacros ? toInt(carbs) ?? autoMacros.carbsG : autoMacros.carbsG}c · ${manualMacros ? toInt(fat) ?? autoMacros.fatG : autoMacros.fatG}f`
                  : "Enter calories to preview macros"}
              </span>
              <label className="flex items-center gap-1.5 text-[11px] text-[#5a7d82] cursor-pointer">
                <input
                  type="checkbox"
                  checked={manualMacros}
                  onChange={(e) => enableManual(e.target.checked)}
                />
                Set macros manually
              </label>
            </div>

            {manualMacros && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="range-carbs" className="text-xs font-medium text-foreground">
                    Carbs (g)
                  </Label>
                  <Input
                    id="range-carbs"
                    type="number"
                    inputMode="numeric"
                    value={carbs}
                    onChange={(e) => setCarbs(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="range-fat" className="text-xs font-medium text-foreground">
                    Fat (g)
                  </Label>
                  <Input
                    id="range-fat"
                    type="number"
                    inputMode="numeric"
                    value={fat}
                    onChange={(e) => setFat(e.target.value)}
                    className="h-9"
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="range-percent" className="text-xs font-medium text-foreground">
                Percent change (%) <span className="text-[#93b0b4] font-normal">— e.g. -10</span>
              </Label>
              <Input
                id="range-percent"
                type="number"
                inputMode="numeric"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                placeholder="e.g. -10"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="range-cal-delta" className="text-xs font-medium text-foreground">
                Calorie adjustment <span className="text-[#93b0b4] font-normal">— e.g. -200</span>
              </Label>
              <Input
                id="range-cal-delta"
                type="number"
                inputMode="numeric"
                value={calorieDelta}
                onChange={(e) => setCalorieDelta(e.target.value)}
                placeholder="e.g. -200"
                className="h-9"
              />
            </div>
            <p className="text-[11px] text-[#93b0b4]">
              Applied to each day&apos;s current total; macros rebalance per day.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={!valid || isSaving}>
            {isSaving ? "Applying…" : `Apply to ${dayCount} ${dayCount === 1 ? "day" : "days"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
