"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useClientGoalHistory } from "@/hooks/use-client-goals";
import { formatDateOnlyShort } from "./overview-format";
import {
  MONO,
  MONO_LABEL_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { useUnits } from "@/contexts/units-context";
import { formatWeight } from "@/utils/unit-conversions";

/**
 * The client's past goals: each goal that has ended, newest first, with the
 * deadline it ended with and its last day. Read-only.
 *
 * The fetch is LAZY: it backs a popover, so reading it on every Overview load
 * would buy a request nobody opened. Only goals that have ended come back, so
 * the goal in force, shown on the band above, is never repeated here.
 */
export function GoalHistoryPopover({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const { history, isLoading } = useClientGoalHistory(clientId, open);
  const { preference } = useUnits();

  const weight = (kg: number | null) =>
    kg == null ? null : formatWeight(kg, preference);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-[11px] font-medium text-[#93b0b4] transition-colors hover:text-white"
        >
          Goal history
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[320px] rounded-[6px] border-[rgba(13,148,136,0.08)] p-0"
      >
        <div className="px-3.5 pb-2 pt-3">
          <p className="text-sm font-semibold text-[#0c1a1e]">Goal history</p>
          <p className={cn(MONO_LABEL_CLASS, "mt-0.5 normal-case tracking-normal")}>
            Previous versions, newest first
          </p>
        </div>

        <div className="max-h-[260px] overflow-y-auto px-1.5 pb-1.5">
          {isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-[#93b0b4]" strokeWidth={1.5} />
            </div>
          ) : history.length === 0 ? (
            // Word-only, so sans. A client whose goal has never been changed has
            // no history — that is not an error and does not need an action.
            <p className="px-2 py-6 text-center text-xs text-[#93b0b4]">
              This goal has not been changed yet.
            </p>
          ) : (
            history.map((past) => {
              const shown = weight(past.targetWeight);
              return (
                <div
                  key={past.id}
                  className="rounded-[4px] px-2 py-1.5 hover:bg-[rgba(13,148,136,0.05)]"
                >
                  {/* Standalone data lines, not sentences — the numerals are the
                      information, so they carry mono. */}
                  <p className={cn(MONO, "text-[12px] font-medium text-[#0c1a1e]")}>
                    {shown ? `${shown.value.toFixed(1)} ${shown.unit}` : "Maintenance"}
                    {past.deadline ? ` by ${formatDateOnlyShort(past.deadline)}` : ""}
                  </p>
                  {/* The goal's last day, a YYYY-MM-DD on the client's calendar. */}
                  <p className={cn(MONO, "mt-0.5 text-[10px] text-[#93b0b4]")}>
                    {`Until ${formatDateOnlyShort(past.endsOn)}`}
                  </p>
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
