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

// Styled confirm for the plan delete. Danger styling stays on the documented
// pair — #c06060 text + rgba(192,96,96,0.08) washes — there is no filled
// destructive button in the design system.
const DANGER_CTA =
  "border border-[rgba(192,96,96,0.3)] text-[#c06060] hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]";

type DeleteNutritionPlanDialogProps = {
  open: boolean;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeleteNutritionPlanDialog({
  open,
  isDeleting,
  onCancel,
  onConfirm,
}: DeleteNutritionPlanDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !isDeleting && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-[rgba(192,96,96,0.08)]">
              <Trash2 className="h-4 w-4 text-[#c06060]" strokeWidth={1.5} />
            </div>
            <DialogTitle>Delete nutrition plan?</DialogTitle>
          </div>
        </DialogHeader>
        <p className="text-sm text-[#5a7d82]">
          Removes this client&apos;s nutrition plan and all upcoming daily
          targets, including edited days. Today and past days are kept.
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            variant="outline"
            className={DANGER_CTA}
            disabled={isDeleting}
            onClick={onConfirm}
          >
            {isDeleting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Delete plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
