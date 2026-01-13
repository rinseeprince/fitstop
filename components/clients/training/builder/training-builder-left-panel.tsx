"use client";

import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import { AIPromptPanel } from "./ai-prompt-panel";
import { ManualWorkoutBuilder } from "./manual-workout-builder";
import { ModeToggle } from "./mode-toggle";

type TrainingBuilderLeftPanelProps = {
  clientWeightKg: number;
};

export function TrainingBuilderLeftPanel({ clientWeightKg }: TrainingBuilderLeftPanelProps) {
  const builder = useTrainingBuilderContext();

  return (
    <div className="flex flex-col h-full">
      <ModeToggle className="mb-5" />

      {/* Content */}
      <div className="flex-1 overflow-y-auto pr-1">
        {builder.mode === "ai" ? (
          <AIPromptPanel clientWeightKg={clientWeightKg} />
        ) : (
          <ManualWorkoutBuilder clientWeightKg={clientWeightKg} />
        )}
      </div>
    </div>
  );
}
