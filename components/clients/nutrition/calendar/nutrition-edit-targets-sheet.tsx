"use client";

import { useEffect, useRef } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Pin, SlidersHorizontal } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/programs/shared/segmented-control";
import {
  LABEL_CLASS,
  MONO,
  MONO_LABEL_CLASS,
  THUMB_CLASS,
  CHIP_NEUTRAL_CLASS,
  FOCUS_RING,
} from "@/components/clients/training/program-builder/builder-tokens";
import { useEditTargetsForm, type EditTargetsTab } from "./use-edit-targets-form";
import { NutritionSetTargetsTab } from "./nutrition-set-targets-tab";
import { NutritionAdjustByTab } from "./nutrition-adjust-by-tab";
import type {
  ResolvedSelectedDay,
  RangeEditPayload,
} from "@/utils/nutrition-range-edit-model";

const MAX_DAY_CHIPS = 6;

type NutritionEditTargetsSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The selection resolved against loaded events — exactly the days an Apply
   * will write (the hook's applyEdit sends the same resolved set). */
  days: ResolvedSelectedDay[];
  isSaving: boolean;
  onApply: (payload: RangeEditPayload) => void;
};

/** "Edit targets" right sheet — the training placed-session editor's 780px
 * structure, hosting the Set targets / Adjust by tabs. */
export function NutritionEditTargetsSheet({
  open,
  onOpenChange,
  days,
  isSaving,
  onApply,
}: NutritionEditTargetsSheetProps) {
  // Latch the days while open: a successful apply clears the selection in the
  // same commit that starts the exit animation, and the closing sheet must not
  // flash "0 days selected" (the selection bar's exit latch, same reason).
  const latchedDays = useRef(days);
  useEffect(() => {
    if (open) latchedDays.current = days;
  });
  const viewDays = open ? days : latchedDays.current;
  const dayCount = viewDays.length;

  const form = useEditTargetsForm(open, viewDays);

  const dayChips = viewDays.slice(0, MAX_DAY_CHIPS);
  const overflow = viewDays.length - dayChips.length;

  function handleApply() {
    const payload = form.buildPayload();
    if (payload) onApply(payload);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        // Block dismissal mid-save so a half-applied edit can't lose its form.
        if (!isSaving) onOpenChange(next);
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 bg-white p-0 sm:w-[780px] sm:max-w-full"
      >
        <SheetHeader className="flex-row items-center gap-3 space-y-0 border-b border-[rgba(13,148,136,0.08)] px-5 py-3.5">
          <span className={cn(THUMB_CLASS, "h-8 w-8")}>
            <SlidersHorizontal className="h-4 w-4" strokeWidth={1.5} />
          </span>
          <div className="min-w-0">
            <SheetTitle className="text-[15px] font-semibold tracking-[-0.01em] text-[#0c1a1e]">
              Edit targets
            </SheetTitle>
            <SheetDescription className={MONO_LABEL_CLASS}>
              {dayCount} day{dayCount === 1 ? "" : "s"} selected
            </SheetDescription>
          </div>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          {/* Which days this edit touches */}
          <div className="flex flex-wrap gap-1.5">
            {dayChips.map((d) => (
              <span key={d.date} className={cn(CHIP_NEUTRAL_CLASS, MONO)}>
                {format(new Date(d.date + "T00:00:00"), "EEE d")}
              </span>
            ))}
            {overflow > 0 && (
              <span className={cn(CHIP_NEUTRAL_CLASS, MONO, "text-[#93b0b4]")}>
                +{overflow} more
              </span>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-[rgba(13,148,136,0.05)] px-3 py-2">
            <Pin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#0d9488]" strokeWidth={1.5} />
            <p className="text-xs text-[#5a7d82]">
              Changes freeze these days — regeneration and the training surplus
              leave them alone. Unfreeze them anytime by selecting them and
              choosing <span className="font-medium text-[#0c1a1e]">Revert to auto</span>.
            </p>
          </div>

          <SegmentedControl
            fullWidth
            options={[
              { value: "set", label: "Set targets" },
              { value: "adjust", label: "Adjust by" },
            ]}
            value={form.tab}
            onChange={(v) => form.setTab(v as EditTargetsTab)}
          />

          {form.tab === "set" ? (
            <NutritionSetTargetsTab form={form} />
          ) : (
            <NutritionAdjustByTab form={form} />
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-[rgba(13,148,136,0.08)] px-5 py-3">
          <div className="space-y-1.5">
            <label htmlFor="et-note" className={LABEL_CLASS}>
              Note <span className="normal-case tracking-normal">· Optional · shown to the client</span>
            </label>
            <Textarea
              id="et-note"
              rows={2}
              maxLength={500}
              value={form.note}
              onChange={(e) => form.setNote(e.target.value)}
              placeholder={
                form.singleDay
                  ? "e.g. Deload week — go easy"
                  : "Applies one note to every selected day"
              }
              className={cn(FOCUS_RING, "resize-none text-sm")}
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
              onClick={handleApply}
              disabled={!form.valid || isSaving || dayCount === 0}
            >
              {isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Apply to {dayCount} day{dayCount === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
