"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { DraftEditor } from "../builder/draft-editor";

type PlanPreviewDrawerProps = {
  savedPlanId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscard?: () => void;
  clientId?: string;
  onApplySuccess?: () => void;
};

/**
 * Thin wrapper that hosts DraftEditor inside a right-side Sheet.
 * Used by the standalone training library page where a lighter preview fits better
 * than the full-screen builder overlay. The in-client training builder opens the
 * same DraftEditor inline via TrainingPlanBuilderOverlay instead.
 */
export function PlanPreviewDrawer({
  savedPlanId,
  open,
  onOpenChange,
  onDiscard,
  clientId,
  onApplySuccess,
}: PlanPreviewDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:w-[600px] md:w-[700px] p-0 flex flex-col [&>[data-slot=sheet-close]]:hidden"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Plan Preview</SheetTitle>
        </SheetHeader>

        <DraftEditor
          // Force a full remount when the drawer is reused for a different
          // plan — guarantees working-copy state is clean per plan id.
          key={savedPlanId}
          savedPlanId={savedPlanId}
          clientId={clientId}
          onDiscard={() => {
            onDiscard?.();
            onOpenChange(false);
          }}
          onApplied={() => {
            // Refresh the caller's list — the apply landed on a client's
            // calendar. Keep the drawer open so the coach can continue.
            onApplySuccess?.();
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
