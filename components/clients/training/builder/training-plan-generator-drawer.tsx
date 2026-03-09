"use client";

import { useEffect, useRef } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import { AIPromptPanel } from "./ai-prompt-panel";
import { ManualWorkoutBuilder } from "./manual-workout-builder";
import { ModeToggle } from "./mode-toggle";

type TrainingPlanGeneratorDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientWeightKg: number;
};

export function TrainingPlanGeneratorDrawer({
  open,
  onOpenChange,
  clientWeightKg,
}: TrainingPlanGeneratorDrawerProps) {
  const builder = useTrainingBuilderContext();
  const wasGenerating = useRef(false);
  const previousPlanId = useRef(builder.plan?.id);

  // Auto-close drawer on successful generation
  useEffect(() => {
    // Close when generation completes and we have a new/updated plan
    if (wasGenerating.current && !builder.isGenerating && builder.plan) {
      // Only close if plan was created/changed (new plan ID or updated)
      if (builder.plan.id !== previousPlanId.current || previousPlanId.current === undefined) {
        onOpenChange(false);
      }
    }
    wasGenerating.current = builder.isGenerating;
    previousPlanId.current = builder.plan?.id;
  }, [builder.isGenerating, builder.plan, onOpenChange]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="!inset-y-auto !h-auto !right-4 !top-4 !bottom-4 max-h-[calc(100vh-2rem)] w-[420px] rounded-lg border border-border shadow-md p-5 flex flex-col bg-card"
      >
        <SheetHeader className="pb-4 border-b border-border px-0">
          <SheetTitle className="text-lg font-semibold">
            Generate Training Plan
          </SheetTitle>
        </SheetHeader>

        <div className="pt-5 flex-1 overflow-y-auto px-0.5">
          <ModeToggle className="w-full mb-5" />

          {/* Content */}
          <div>
            {builder.mode === "ai" ? (
              <AIPromptPanel clientWeightKg={clientWeightKg} />
            ) : (
              <ManualWorkoutBuilder clientWeightKg={clientWeightKg} />
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
