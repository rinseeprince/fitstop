"use client";

import { useEffect, useRef } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

type NutritionEditTargetsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The selection resolved against loaded events — exactly the days an Apply
   * will write (the hook's applyEdit sends the same resolved set). */
  days: ResolvedSelectedDay[];
  isSaving: boolean;
  onApply: (payload: RangeEditPayload) => void;
};

/** "Edit targets" modal — centred, landscape and sized to its content,
 * carrying the plan generator's hero (the dark band, the teal icon square,
 * the title scale, its own close). The macro balancer sits left — one calorie
 * target and split, the same four numbers for every selected day — and the
 * note sits beside it on the right, stretched to the balancer's height. */
export function NutritionEditTargetsDialog({
  open,
  onOpenChange,
  days,
  isSaving,
  onApply,
}: NutritionEditTargetsDialogProps) {
  // Latch the days while open: a successful apply clears the selection in the
  // same commit that starts the exit animation, and the closing dialog must
  // not flash "0 days selected" (the selection bar's exit latch, same reason).
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Block dismissal mid-save so a half-applied edit can't lose its form.
        if (!isSaving) onOpenChange(next);
      }}
    >
      {/* Content-sized: the card is as tall as the form, and only a viewport
          shorter than it scrolls the body inside. p-0 + overflow-hidden so the
          hero takes the card's rounded top edge. Landscape: wide enough for
          the balancer beside the note. */}
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100vh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
      >
        {/* The generator's hero: the dark band, the teal icon square, the title
            scale and its own close, since the built-in one is off. */}
        <DialogHeader className="shrink-0 flex-row items-start gap-3 bg-[#0f2027] px-6 pb-5 pt-5 text-left">
          <div className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[6px] bg-[rgba(13,148,136,0.15)]">
            <SlidersHorizontal className="h-[15px] w-[15px] text-[#0d9488]" strokeWidth={1.5} />
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[16px] font-bold leading-tight tracking-normal text-white">
              Edit targets
            </DialogTitle>
            <DialogDescription
              className={cn(MONO, "mt-1 text-[12px] leading-[1.4] text-[rgba(255,255,255,0.4)]")}
            >
              {dayCount} day{dayCount === 1 ? "" : "s"} selected
            </DialogDescription>
          </div>
          <DialogClose className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[6px] bg-[rgba(255,255,255,0.06)] transition-colors hover:bg-[rgba(255,255,255,0.1)]">
            <X className="h-4 w-4 text-[rgba(255,255,255,0.5)]" strokeWidth={1.5} />
            <span className="sr-only">Close</span>
          </DialogClose>
        </DialogHeader>

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

          {/* The balancer left, the note right at the same height: the grid
              stretches both columns to the taller one, and the textarea fills
              its column under the label. */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-[minmax(0,1fr)_280px]">
            <NutritionSetTargetsTab form={form} />
            <div className="flex min-h-0 flex-col gap-1.5">
              <label htmlFor="et-note" className={LABEL_CLASS}>
                Note <span className="normal-case tracking-normal">· Optional · shown to the client</span>
              </label>
              <Textarea
                id="et-note"
                maxLength={500}
                value={form.note}
                onChange={(e) => form.setNote(e.target.value)}
                placeholder={
                  form.singleDay
                    ? "e.g. Deload week — go easy"
                    : "Applies one note to every selected day"
                }
                className={cn(FOCUS_RING, "min-h-0 flex-1 resize-none text-sm")}
              />
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[rgba(13,148,136,0.08)] px-6 py-3">
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
      </DialogContent>
    </Dialog>
  );
}
