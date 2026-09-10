"use client";

import { useEffect, useRef } from "react";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Pin, SlidersHorizontal, X } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  LABEL_CLASS,
  MONO,
  CHIP_NEUTRAL_CLASS,
  FOCUS_RING,
} from "@/components/clients/training/program-builder/builder-tokens";
import { useEditTargetsForm } from "./use-edit-targets-form";
import { NutritionSetTargetsTab } from "./nutrition-set-targets-tab";
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

/** "Edit targets" right sheet — the plan generator's drawer shell (the same
 * width, page-tint body, overlay and slide, and the same dark hero band),
 * hosting the macro balancer over the selection: one calorie target and
 * split, the same four numbers for every selected day. */
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
        hideClose
        overlayClassName="bg-[rgba(15,32,39,0.35)] backdrop-blur-[2px]"
        className="w-[420px] bg-[#f4f7f6] p-0 gap-0 flex flex-col inset-y-0 right-0 h-full data-[state=open]:animate-none data-[state=closed]:animate-none data-[state=open]:slide-in-from-right-0 animate-drawer-slide-in data-[state=closed]:slide-out-to-right data-[state=closed]:duration-300"
      >
        {/* The generator's hero: the dark band, the teal icon square, the title
            scale and its own close, since the built-in one is hidden. */}
        <SheetHeader className="shrink-0 flex-row items-start gap-3 bg-[#0f2027] px-6 pb-5 pt-5">
          <div className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[6px] bg-[rgba(13,148,136,0.15)]">
            <SlidersHorizontal className="h-[15px] w-[15px] text-[#0d9488]" strokeWidth={1.5} />
          </div>
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-[16px] font-bold leading-tight text-white">
              Edit targets
            </SheetTitle>
            <SheetDescription
              className={cn(MONO, "mt-1 text-[12px] leading-[1.4] text-[rgba(255,255,255,0.4)]")}
            >
              {dayCount} day{dayCount === 1 ? "" : "s"} selected
            </SheetDescription>
          </div>
          <SheetClose className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[6px] bg-[rgba(255,255,255,0.06)] transition-colors hover:bg-[rgba(255,255,255,0.1)]">
            <X className="h-4 w-4 text-[rgba(255,255,255,0.5)]" strokeWidth={1.5} />
            <span className="sr-only">Close</span>
          </SheetClose>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
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

          <NutritionSetTargetsTab form={form} />
        </div>

        <div className="flex flex-col gap-3 border-t border-[rgba(13,148,136,0.08)] px-6 py-3">
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
              className={cn(FOCUS_RING, "resize-none bg-white text-sm")}
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
