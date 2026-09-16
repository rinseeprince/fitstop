"use client";

import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDialogSubject } from "@/hooks/use-dialog-subject";
import { useInvalidateTrainingData } from "@/hooks/use-calendar-events";
import { useInvalidateNutritionCalendar } from "@/hooks/use-nutrition-calendar-events";
import { useClearClientOverview } from "@/hooks/use-client-overview";
import { useClearAttentionFeed } from "@/hooks/use-attention-feed";
import { useClearBlockFacts } from "@/components/clients/metrics/hooks/use-client-blocks";
import { InlineMono } from "@/components/clients/overview/overview-primitives";
import { formatDateOnlyWeekday } from "@/components/clients/overview/overview-format";
import { FOCUS_RING } from "@/components/clients/training/program-builder/builder-tokens";
import { StartDateCalendar } from "./start-date-calendar";
import { MovePlanDialog, type PlanMoveChoice } from "./move-plan-dialog";

type PlanStartLineProps = {
  clientId: string;
  program: { id: string; name: string; startsOn: string };
  /** "start": the hero's own program. "next": the program that starts after it. */
  kind: "start" | "next";
  /** The client's today, on their calendar. */
  clientToday: string;
  /** The first day a program may start: a program starting before it has started. */
  floor: string;
};

/** What the calendar was opened on, kept through its close so it fades out as it was. */
type PickerSubject = { startsOn: string; today: string; floor: string };

const MOVE_FAILED = "Something went wrong. Try again.";

/**
 * A program's start under the Plans hero's name — "Starts Mon, 28 Sep",
 * "Starts today", or "Next: Strength, starts Mon, 5 Oct" — with a pencil that
 * moves the whole program to another start date.
 *
 * Only a program that hasn't started has the pencil: its start is on or after
 * the client's deletion floor (their today, or tomorrow once they've logged a
 * workout today). A running program's start line is gone; the next program
 * always starts later, so its line always has one.
 *
 * Picking a day closes the calendar and opens the confirm in the same click;
 * picking the current start closes the calendar and asks nothing. The confirm
 * carries the wait: Move program spins until the move and the Training tab's
 * refetch are done, then the dialog closes onto the new dates. The dialog
 * lives beside the line rather than inside it, so a line that hides while it
 * is open doesn't take the dialog with it.
 */
export function PlanStartLine({ clientId, program, kind, clientToday, floor }: PlanStartLineProps) {
  const picker = useDialogSubject<PickerSubject>();
  const confirm = useDialogSubject<PlanMoveChoice>();
  const invalidateTrainingData = useInvalidateTrainingData();
  const invalidateNutritionCalendar = useInvalidateNutritionCalendar();
  const clearClientOverview = useClearClientOverview();
  const clearAttentionFeed = useClearAttentionFeed();
  const clearBlockFacts = useClearBlockFacts();

  const movable = program.startsOn >= floor;
  const startsToday = program.startsOn === clientToday;

  function pick(startsOn: string) {
    picker.close();
    const shown = picker.subject?.startsOn;
    if (!shown || startsOn === shown) return;
    confirm.show({ programName: program.name, fromDate: shown, toDate: startsOn });
  }

  async function move(startsOn: string) {
    try {
      const res = await fetch(`/api/clients/${clientId}/training/${program.id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startsOn }),
      });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || !body.success) {
        confirm.close();
        toast.error("Program not moved", { description: body.error ?? MOVE_FAILED });
        return;
      }
      // Everything that reads the moved dates. The Overview, the feed and the
      // block card render definite answers, so they are cleared; the nutrition
      // month recomputes its training days. The Training tab's reads — the
      // calendar and this hero's plan — revalidate in place, awaited, so the
      // confirm closes onto the new dates.
      void invalidateNutritionCalendar(clientId);
      void clearClientOverview(clientId);
      void clearAttentionFeed();
      void clearBlockFacts(clientId);
      await invalidateTrainingData(clientId);
      confirm.close();
      toast.success("Program moved");
    } catch (error) {
      console.error("Failed to move the program:", error);
      confirm.close();
      toast.error("Program not moved", { description: MOVE_FAILED });
    }
  }

  return (
    <>
      {(kind === "next" || movable) && (
        <p className="mt-1 flex min-w-0 items-center text-[11px] font-medium text-[rgba(255,255,255,0.45)]">
          <span className={kind === "next" ? "truncate" : "shrink-0"}>
            {kind === "next" ? `Next: ${program.name}, starts` : "Starts"}
            {startsToday && " today"}
          </span>
          {/* No space before InlineMono — it owns its own gap. */}
          {!startsToday && (
            <span className="shrink-0">
              <InlineMono>{formatDateOnlyWeekday(program.startsOn)}</InlineMono>
            </span>
          )}
          {movable && (
            <Popover
              open={picker.open}
              onOpenChange={(open) =>
                open
                  ? picker.show({ startsOn: program.startsOn, today: clientToday, floor })
                  : picker.close()
              }
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={kind === "next" ? `Change ${program.name}'s start date` : "Change start date"}
                  className={cn(
                    "ml-1.5 grid h-4 w-4 shrink-0 place-items-center rounded-[4px] text-[rgba(255,255,255,0.45)] transition-colors hover:text-white",
                    FOCUS_RING,
                  )}
                >
                  <Pencil className="h-3 w-3" strokeWidth={1.5} />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                sideOffset={6}
                className="w-auto rounded-[6px] border-[rgba(13,148,136,0.08)] bg-white p-3"
              >
                {picker.subject && (
                  <StartDateCalendar
                    key={`start-date-${picker.openKey}`}
                    selected={picker.subject.startsOn}
                    today={picker.subject.today}
                    min={picker.subject.floor}
                    onPick={pick}
                  />
                )}
              </PopoverContent>
            </Popover>
          )}
        </p>
      )}
      <MovePlanDialog
        key={`move-plan-${confirm.openKey}`}
        open={confirm.open}
        choice={confirm.subject}
        onCancel={confirm.close}
        onConfirm={() => (confirm.subject ? move(confirm.subject.toDate) : Promise.resolve())}
      />
    </>
  );
}
