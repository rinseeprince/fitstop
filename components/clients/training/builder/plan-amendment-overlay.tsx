"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import { ProgramDraftProvider } from "@/components/clients/training/program-builder/program-draft-provider";
import { ProgramBuilder } from "@/components/clients/training/program-builder/program-builder";
import { ClientDraftLeaveGuard } from "./client-draft-leave-guard";
import { useInvalidateTrainingData } from "@/hooks/use-calendar-events";
import { useInvalidateNutritionCalendar } from "@/hooks/use-nutrition-calendar-events";
import { cn } from "@/lib/utils";

// The plan-amendment surface (Job 2): the SHARED Program builder mounted
// full-screen over a client's PLACED plan (target="placed-plan" — past slots
// locked, saves go through the amendment PUT). Clone of the client-draft
// overlay's editor state: non-modal so the 52px nav rail stays clickable,
// Escape/outside-click neutralized so a stray key can never silently drop
// unsaved changes — the coach leaves via the builder's guarded back arrow.
type PlanAmendmentOverlayProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  planId: string | null;
  clientName?: string;
};

export function PlanAmendmentOverlay({
  open,
  onOpenChange,
  clientId,
  planId,
  clientName,
}: PlanAmendmentOverlayProps) {
  const builder = useTrainingBuilderContext();
  const invalidateTrainingData = useInvalidateTrainingData();
  const invalidateNutritionCalendar = useInvalidateNutritionCalendar();

  return (
    <DialogPrimitive.Root
      open={open && planId != null}
      modal={false}
      onOpenChange={(next) => {
        if (!next) onOpenChange(false);
      }}
    >
      <DialogPrimitive.Portal>
        {/* No dim and pointer-events-none: the transparent overlay must not
            swallow clicks to the nav rail (ClientDraftLeaveGuard confirms
            before a rail navigation drops a dirty draft). */}
        <DialogPrimitive.Overlay className="pointer-events-none fixed inset-0 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:duration-200 data-[state=closed]:duration-200" />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-y-0 right-0 left-0 z-50 flex flex-col bg-[#f4f7f6] outline-none lg:left-[52px]",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:duration-250 data-[state=closed]:duration-200 data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          )}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogPrimitive.Title className="sr-only">
            Edit training plan
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Edit the remaining weeks of this client&apos;s placed training plan.
          </DialogPrimitive.Description>

          {planId != null && (
            <ProgramDraftProvider
              // Keyed so switching plans fully resets the working tree.
              key={planId}
              target="placed-plan"
              placedPlanId={planId}
              clientId={clientId}
              clientName={clientName}
              onAmended={() => {
                // The future window was re-laid: refresh the client's plan
                // read AND both calendar caches, then close.
                void builder.fetchPlan();
                void invalidateTrainingData(clientId);
                void invalidateNutritionCalendar(clientId);
                onOpenChange(false);
              }}
            >
              <ClientDraftLeaveGuard description="You have unsaved changes to this plan. Leaving now will discard them — they only reach the calendar when you save." />
              <ProgramBuilder onExit={() => onOpenChange(false)} />
            </ProgramDraftProvider>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
