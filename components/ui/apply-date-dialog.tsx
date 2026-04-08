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

type ApplyDateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  onApply: (effectiveFrom: string | null) => void;
};

export function ApplyDateDialog({
  open,
  onOpenChange,
  title = "When should changes take effect?",
  description = "Choose when the updated schedule should start. Today's existing data will be preserved if you choose a future date.",
  onApply,
}: ApplyDateDialogProps) {
  const today = getTodayDateString();
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  });

  const handleApplyNow = () => {
    onApply(null);
    onOpenChange(false);
  };

  const handleApplyFrom = () => {
    onApply(selectedDate);
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-3 py-2">
          <button
            onClick={handleApplyNow}
            className="w-full flex items-center justify-center gap-2 bg-[#0d9488] text-white text-[13px] font-semibold rounded-[6px] px-4 py-2.5 transition-all hover:bg-[#0a7c72]"
          >
            Apply Now
          </button>

          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-[rgba(0,0,0,0.06)]" />
            <span className="text-[11px] text-[#93b0b4] uppercase tracking-wider">or</span>
            <div className="flex-1 h-px bg-[rgba(0,0,0,0.06)]" />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={selectedDate}
              min={today}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="flex-1 border border-[rgba(13,148,136,0.15)] rounded-[6px] px-3 py-2 text-[13px] text-[#0c1a1e] focus:outline-none focus:ring-1 focus:ring-[#0d9488]"
            />
            <button
              onClick={handleApplyFrom}
              disabled={!selectedDate || selectedDate <= today}
              className="bg-white border border-[rgba(13,148,136,0.15)] text-[#0c1a1e] text-[13px] font-medium rounded-[6px] px-4 py-2 transition-all hover:bg-[#f0f5f4] disabled:opacity-40 disabled:pointer-events-none"
            >
              Apply From Date
            </button>
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
