"use client";

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { getTodayDateString } from "@/lib/date-helpers";
import { LABEL_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import { formatDateOnlyShort } from "@/components/clients/overview/overview-format";

type ApplyDateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  onApply: (effectiveFrom: string | null) => void;
  maxDate?: string;
  /** Verb for the single confirm. An EDIT reads as "apply"; a first plan reads
   *  as "start". */
  applyLabel?: string;
  /** The date a queued change is scheduled for (the GET's `scheduledFor`).
   *  When the picked date lands ON or BEFORE it, the save ABSORBS that queued
   *  change — one sentence says so, then the apply does what was asked (warn,
   *  never block; same register as the amendment surface's re-lay warning). */
  queuedChangeDate?: string | null;
};

export function ApplyDateDialog({
  open,
  onOpenChange,
  title = "When should changes take effect?",
  description = "Changes apply from the date below — leave it on today to apply now, or pick a future date.",
  onApply,
  maxDate,
  applyLabel = "Apply",
  queuedChangeDate,
}: ApplyDateDialogProps) {
  // One picker, one button. The old two-action layout ("Apply Now" over a
  // date + "Apply From Date") saved on the second button's click, which read
  // as the control that OPENS the picker — coaches applied before setting the
  // date. Defaulting the picker to today keeps apply-now one click.
  const today = getTodayDateString();
  const [selectedDate, setSelectedDate] = useState(today);

  const handleApply = () => {
    // Today means NOW, and now is sent as null, not as the date string: the
    // picker renders the COACH's calendar day, but plan dates live on the
    // CLIENT's. Across a midnight offset (coach Tuesday, client Monday) the
    // literal string would schedule the client's TOMORROW; null lets the
    // server resolve today in the client's stored timezone, exactly as the
    // old Apply Now did. A genuinely future pick is unambiguous — the same
    // calendar square everywhere — and is sent as typed.
    onApply(selectedDate === today ? null : selectedDate);
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-2 py-2">
          <span className={LABEL_CLASS}>Takes effect</span>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={selectedDate}
              min={today}
              max={maxDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="flex-1 border border-[rgba(13,148,136,0.15)] rounded-[6px] px-3 py-2 text-[13px] text-[#0c1a1e] focus:outline-none focus:ring-1 focus:ring-[#0d9488]"
            />
            <button
              onClick={handleApply}
              disabled={!selectedDate || selectedDate < today}
              className="flex items-center justify-center gap-2 bg-[#0d9488] text-white text-[13px] font-semibold rounded-[6px] px-4 py-2 transition-all hover:bg-[#0a7c72] disabled:opacity-40 disabled:pointer-events-none"
            >
              {applyLabel}
            </button>
          </div>
          {queuedChangeDate && selectedDate && selectedDate <= queuedChangeDate && (
            <p className="text-[12px] leading-relaxed text-[#b45309]">
              This replaces the change queued for{" "}
              {formatDateOnlyShort(queuedChangeDate)}.
            </p>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
