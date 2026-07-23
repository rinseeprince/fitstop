"use client";

import { useState, useEffect } from "react";
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
import { LABEL_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import { calculateDailyMacros } from "@/utils/nutrition-helpers";
import type { DietType } from "@/types/check-in";

/** The materialized-edit payload sent to PATCH …/nutrition/events/range.
 * `note`: omitted = preserve existing notes; "" = clear; string = set (D-B). */
export type RangeEditPayload =
  | { mode: "absolute"; calories: number; proteinG?: number; carbG?: number; fatG?: number; note?: string }
  | { mode: "delta"; percent?: number; calorieDelta?: number; note?: string };

// Macros must sum to within this many kcal of the calorie target before applying.
const CALORIE_MATCH_TOLERANCE = 15;

type NutritionRangeEditDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dayCount: number;
  /** First selected day's diet type — drives the carb/fat auto-rebalance. */
  dietType: DietType;
  /** First selected day's current values — seed the form on open. */
  defaultCalories: number;
  defaultProtein: number;
  defaultCarbs: number;
  defaultFat: number;
  /** First selected day's current note — seeded only for a single-day edit. */
  defaultNote?: string | null;
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
  defaultCalories,
  defaultProtein,
  defaultCarbs,
  defaultFat,
  defaultNote,
  isSaving,
  onApply,
}: NutritionRangeEditDialogProps) {
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [percent, setPercent] = useState("");
  const [calorieDelta, setCalorieDelta] = useState("");
  const [note, setNote] = useState("");

  const singleDay = dayCount === 1;

  // Seed from the first selected day's CURRENT values when the dialog opens so the
  // coach edits from real numbers (and they already sum consistently). The note
  // is seeded only for a single-day edit (a multi-day range starts blank — empty
  // = preserve each day's note; typing applies one note to all).
  useEffect(() => {
    if (!open) return;
    const s = (n: number) => (n > 0 ? String(n) : "");
    setCalories(s(defaultCalories));
    setProtein(s(defaultProtein));
    setCarbs(s(defaultCarbs));
    setFat(s(defaultFat));
    setPercent("");
    setCalorieDelta("");
    setNote(singleDay ? defaultNote ?? "" : "");
  }, [open, defaultCalories, defaultProtein, defaultCarbs, defaultFat, defaultNote, singleDay]);

  const p = toInt(protein) ?? 0;
  const c = toInt(carbs) ?? 0;
  const f = toInt(fat) ?? 0;
  const target = toInt(calories) ?? 0;
  const macroCals = p * 4 + c * 4 + f * 9;
  const diff = macroCals - target;
  const matched = target > 0 && Math.abs(diff) <= CALORIE_MATCH_TOLERANCE;
  // The fat that hits the calorie target given the current protein + carbs.
  const fatForTarget = Math.max(0, Math.round((target - p * 4 - c * 4) / 9));

  const pct = toInt(percent);
  const cd = toInt(calorieDelta);
  const adjustActive = pct != null || cd != null;

  // Guard: absolute edits require macros to match the calorie target (within
  // tolerance); the relative "adjust by" path only needs a percent or delta.
  const valid = adjustActive ? true : target > 0 && matched;

  function onCaloriesChange(v: string) {
    setCalories(v);
    const cal = toInt(v) ?? 0;
    if (cal > 0) {
      const m = calculateDailyMacros(cal, toInt(protein) ?? defaultProtein, false, dietType);
      setCarbs(String(m.carbsG));
      setFat(String(m.fatG));
    }
  }

  // D-B: single-day edits are authoritative (send the field value — "" clears);
  // multi-day edits send a note only when the coach typed one (empty = preserve
  // each day's existing note).
  const noteValue = singleDay ? note : note.trim() !== "" ? note : undefined;

  function handleApply() {
    if (!valid) return;
    if (adjustActive) {
      onApply({ mode: "delta", percent: pct ?? undefined, calorieDelta: cd ?? undefined, note: noteValue });
    } else {
      onApply({ mode: "absolute", calories: target, proteinG: p, carbG: c, fatG: f, note: noteValue });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Edit {dayCount} {dayCount === 1 ? "day" : "days"}
          </DialogTitle>
          <DialogDescription>
            Set the targets on the selected days. Edited days freeze — training
            surplus stops stacking.
          </DialogDescription>
        </DialogHeader>

        {/* Absolute: calories + per-macro grams (disabled while adjusting by %) */}
        <fieldset disabled={adjustActive} className={cn("space-y-3", adjustActive && "opacity-50")}>
          <div className="space-y-1.5">
            <Label htmlFor="re-cal" className="text-xs font-medium text-foreground">
              Calories
            </Label>
            <Input
              id="re-cal"
              type="number"
              inputMode="numeric"
              value={calories}
              onChange={(e) => onCaloriesChange(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="re-p" className="text-xs font-medium text-foreground">
                Protein (g)
              </Label>
              <Input id="re-p" type="number" inputMode="numeric" value={protein} onChange={(e) => setProtein(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="re-c" className="text-xs font-medium text-foreground">
                Carbs (g)
              </Label>
              <Input id="re-c" type="number" inputMode="numeric" value={carbs} onChange={(e) => setCarbs(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="re-f" className="text-xs font-medium text-foreground">
                Fat (g)
              </Label>
              <Input id="re-f" type="number" inputMode="numeric" value={fat} onChange={(e) => setFat(e.target.value)} className="h-9" />
            </div>
          </div>

          {/* Live guidance */}
          <div className="text-[11px] space-y-0.5">
            <p className={cn("font-medium", matched ? "text-[#0d9488]" : "text-[#d97706]")}>
              Macros = {macroCals} kcal
              {target > 0 && (matched ? " · on target" : ` · ${diff > 0 ? "+" : ""}${diff} vs ${target}`)}
            </p>
            {target > 0 && !matched && (
              <p className="text-[#93b0b4]">
                Set fat to {fatForTarget}g to hit {target} kcal.
              </p>
            )}
          </div>
        </fieldset>

        {/* Relative */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-px bg-[rgba(13,148,136,0.08)]" />
          <span className={LABEL_CLASS}>or adjust by</span>
          <div className="flex-1 h-px bg-[rgba(13,148,136,0.08)]" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="re-pct" className="text-xs font-medium text-foreground">
              Percent (%)
            </Label>
            <Input id="re-pct" type="number" inputMode="numeric" placeholder="e.g. -10" value={percent} onChange={(e) => setPercent(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="re-cd" className="text-xs font-medium text-foreground">
              Calorie change
            </Label>
            <Input id="re-cd" type="number" inputMode="numeric" placeholder="e.g. -200" value={calorieDelta} onChange={(e) => setCalorieDelta(e.target.value)} className="h-9" />
          </div>
        </div>
        {adjustActive && (
          <p className="text-[11px] text-[#93b0b4]">
            Applies a relative change to each day. Clear to set absolute values.
          </p>
        )}

        {/* Optional coach note — shows on the client's day view + program card. */}
        <div className="space-y-1.5">
          <Label htmlFor="re-note" className="text-xs font-medium text-foreground">
            Note <span className="text-[#93b0b4]">(optional, shown to the client)</span>
          </Label>
          <Input
            id="re-note"
            type="text"
            maxLength={500}
            placeholder={singleDay ? "e.g. Deload week — go easy" : "Applies one note to every selected day"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="h-9"
          />
        </div>

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
