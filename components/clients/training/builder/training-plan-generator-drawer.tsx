"use client";

import { useEffect, useRef, useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import { TrainingDrawerHeader } from "./drawer-header";
import { TrainingDrawerFormBody } from "./drawer-form-body";
import { TrainingDrawerFooter } from "./drawer-footer";

type TrainingPlanGeneratorDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientWeightKg: number;
  weightUnit?: "lbs" | "kg";
};

export function TrainingPlanGeneratorDrawer({
  open,
  onOpenChange,
  clientWeightKg,
  weightUnit = "lbs",
}: TrainingPlanGeneratorDrawerProps) {
  const builder = useTrainingBuilderContext();
  const wasGenerating = useRef(false);
  const previousPlanId = useRef(builder.plan?.id);

  // Auto-close drawer on successful generation
  useEffect(() => {
    if (wasGenerating.current && !builder.isGenerating && builder.plan) {
      if (builder.plan.id !== previousPlanId.current || previousPlanId.current === undefined) {
        onOpenChange(false);
      }
    }
    wasGenerating.current = builder.isGenerating;
    previousPlanId.current = builder.plan?.id;
  }, [builder.isGenerating, builder.plan, onOpenChange]);

  const title = builder.plan ? "Regenerate Training Plan" : "Generate Training Plan";

  // Preview bar: show active plan data when available, fall back to selector values
  const previewStats = useMemo(() => {
    const plan = builder.plan;
    const sessions = builder.trainingSessions;
    if (plan && sessions.length > 0) {
      const totalMin = sessions.reduce(
        (sum, s) => sum + (s.estimatedDurationMinutes ?? 0),
        0
      );
      const totalExercises = sessions.reduce(
        (sum, s) => sum + s.exercises.length,
        0
      );
      return {
        sessions: plan.frequencyPerWeek,
        totalMinutes: totalMin,
        exercises: totalExercises,
      };
    }
    return {
      sessions: builder.sessionsPerWeek,
      totalMinutes: builder.totalMinutesPerWeek,
      exercises: builder.estimatedExercises,
    };
  }, [builder.plan, builder.trainingSessions, builder.sessionsPerWeek, builder.totalMinutesPerWeek, builder.estimatedExercises]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        overlayClassName="bg-[rgba(15,32,39,0.35)] backdrop-blur-[2px]"
        className="w-[420px] bg-[#f4f7f6] border-0 p-0 gap-0 flex flex-col inset-y-0 right-0 h-full data-[state=open]:animate-none data-[state=closed]:animate-none data-[state=open]:slide-in-from-right-0 [&>[data-slot=sheet-close]]:hidden animate-drawer-slide-in data-[state=closed]:slide-out-to-right data-[state=closed]:duration-300"
      >
        {/* Visually hidden title for accessibility */}
        <SheetHeader className="sr-only">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>

        <TrainingDrawerHeader
          title={title}
          sessionsPerWeek={previewStats.sessions}
          totalMinutes={previewStats.totalMinutes}
          estimatedExercises={previewStats.exercises}
        />

        <TrainingDrawerFormBody
          clientWeightKg={clientWeightKg}
          weightUnit={weightUnit}
        />

        <TrainingDrawerFooter />
      </SheetContent>
    </Sheet>
  );
}
