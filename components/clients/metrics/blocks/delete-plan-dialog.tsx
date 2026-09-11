"use client";

import { Loader2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatBlockRange } from "@/lib/blocks/block-format";
import { planDeleteVerb, type BlockPlanDeleteTarget } from "./block-timeline";

// The per-plan delete's confirm (C3), exactly the design system's destructive
// confirm (the delete-event-dialog silhouette): the styled Dialog — never
// AlertDialog — a danger thumb with Trash2, ONE plain-sans sentence naming what
// happens with the subject semibold, ghost Cancel + a danger-OUTLINE CTA that
// repeats the verb, Loader2 while pending. There is no filled destructive
// button in this system.
//
// The sentence scopes the verb and stops: a running plan ENDS and its upcoming
// days go (a workout already logged today is completed, never among them); a
// queued plan is REMOVED with its range. Nothing about what survives — "done
// days keep it" is the filler the design system retired.

const DANGER_CTA =
  "border border-[rgba(192,96,96,0.3)] text-[#c06060] hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]";

type PlanDeleteCopy = {
  title: string;
  body: React.ReactNode;
  cta: string;
};

/** The four sentences: track × running/queued. */
export function describePlanDelete(plan: BlockPlanDeleteTarget): PlanDeleteCopy {
  const verb = planDeleteVerb(plan);
  const range = formatBlockRange(plan.startsOn, plan.endsOn);
  const subject = (text: string) => (
    <span className="font-semibold text-[#0c1a1e]">{text}</span>
  );
  if (plan.track === "training") {
    const name = plan.name ?? "this plan";
    return verb === "End"
      ? {
          title: "End plan?",
          body: <>Ends {subject(name)}. Its upcoming sessions are removed.</>,
          cta: "End plan",
        }
      : {
          title: "Remove plan?",
          body: <>Removes {subject(name)}, {range}.</>,
          cta: "Remove plan",
        };
  }
  return verb === "End"
    ? {
        title: "End targets?",
        body: <>Ends the nutrition targets running {subject(range)}. Targets from today are removed.</>,
        cta: "End targets",
      }
    : {
        title: "Remove targets?",
        body: <>Removes the nutrition targets for {subject(range)}.</>,
        cta: "Remove targets",
      };
}

type DeletePlanDialogProps = {
  plan: BlockPlanDeleteTarget | null; // null = closed
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: (plan: BlockPlanDeleteTarget) => void;
};

export function DeletePlanDialog({ plan, isDeleting, onCancel, onConfirm }: DeletePlanDialogProps) {
  const copy = plan ? describePlanDelete(plan) : null;
  return (
    <Dialog open={plan != null} onOpenChange={(open) => !open && !isDeleting && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-[rgba(192,96,96,0.08)]">
              <Trash2 className="h-4 w-4 text-[#c06060]" strokeWidth={1.5} />
            </div>
            <DialogTitle>{copy?.title ?? "End plan?"}</DialogTitle>
          </div>
        </DialogHeader>
        {copy && <p className="text-sm text-[#5a7d82]">{copy.body}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            variant="outline"
            className={DANGER_CTA}
            disabled={isDeleting || !plan}
            onClick={() => plan && onConfirm(plan)}
          >
            {isDeleting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {copy?.cta ?? "End plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
