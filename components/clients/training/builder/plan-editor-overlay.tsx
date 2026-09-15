"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ProgramDraftProvider } from "@/components/clients/training/program-builder/program-draft-provider";
import { ProgramBuilder } from "@/components/clients/training/program-builder/program-builder";
import { ClientDraftLeaveGuard } from "./client-draft-leave-guard";
import { useInvalidateTrainingData } from "@/hooks/use-calendar-events";
import { useInvalidateNutritionCalendar } from "@/hooks/use-nutrition-calendar-events";
import { useClearClientOverview } from "@/hooks/use-client-overview";
import { useClearAttentionFeed } from "@/hooks/use-attention-feed";
import { useClearBlockFacts } from "@/components/clients/metrics/hooks/use-client-blocks";

// The plan editor: the SHARED Program builder mounted full-screen over one of
// a client's plans as it is laid on the calendar (target="placed-plan" —
// locked and greyed days refused, saved through the plan editor's PUT). Its
// open state is the host's address (`?plan=<planId>`). Non-modal so the 52px
// nav rail stays clickable; Escape and outside clicks are neutralized so a
// stray key can never silently drop unsaved changes — the coach leaves by the
// builder's guarded back arrow.
type PlanEditorOverlayProps = {
  clientId: string;
  /** The plan the address opens; null = closed. */
  planId: string | null;
  clientName?: string;
  /** The builder's back arrow. */
  onExit: () => void;
  /** After a clean save, once the calendar reads have the saved plan. */
  onSaved: () => void;
};

export function PlanEditorOverlay({
  clientId,
  planId,
  clientName,
  onExit,
  onSaved,
}: PlanEditorOverlayProps) {
  const invalidateTrainingData = useInvalidateTrainingData();
  const invalidateNutritionCalendar = useInvalidateNutritionCalendar();
  const clearClientOverview = useClearClientOverview();
  const clearAttentionFeed = useClearAttentionFeed();
  const clearBlockFacts = useClearBlockFacts();

  return (
    <DialogPrimitive.Root
      open={planId != null}
      modal={false}
      onOpenChange={(next) => {
        if (!next) onExit();
      }}
    >
      <DialogPrimitive.Portal>
        {/* No overlay element: a non-modal Root mounts none, and the nav rail
            stays clickable (ClientDraftLeaveGuard confirms before a rail
            navigation drops a dirty draft). No animation token either: a
            full-screen editor is a place and the program builder does not
            animate, so it appears and goes in the frame its address does
            (CONVENTIONS §7 → "No frame disagrees"). */}
        <DialogPrimitive.Content
          className="fixed inset-y-0 right-0 left-0 z-50 flex flex-col bg-[#f4f7f6] outline-none lg:left-[52px]"
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogPrimitive.Title className="sr-only">
            Edit training plan
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Edit this client&apos;s training plan from its first editable day.
          </DialogPrimitive.Description>

          {planId != null && (
            <ProgramDraftProvider
              // Keyed so switching plans fully resets the working tree.
              key={planId}
              target="placed-plan"
              placedPlanId={planId}
              clientId={clientId}
              clientName={clientName}
              onSaved={async () => {
                // The save rewrote the calendar: the training area (the
                // calendar, the Plans pane's plan) is refetched before the
                // editor closes, so the first frame after it is the saved
                // plan. The screens off this one refresh on their own time.
                void invalidateNutritionCalendar(clientId);
                void clearClientOverview(clientId);
                void clearAttentionFeed();
                // The Journey block cards are derived from the plan's window.
                void clearBlockFacts(clientId);
                await invalidateTrainingData(clientId);
                onSaved();
              }}
            >
              <ClientDraftLeaveGuard description="You have unsaved changes to this plan. Leaving now will discard them — they only reach the calendar when you save." />
              <ProgramBuilder onExit={onExit} />
            </ProgramDraftProvider>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
