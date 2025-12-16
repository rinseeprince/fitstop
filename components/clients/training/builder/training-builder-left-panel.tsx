"use client";

import { cn } from "@/lib/utils";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import { AIPromptPanel } from "./ai-prompt-panel";
import { ManualWorkoutBuilder } from "./manual-workout-builder";
import { Sparkles, PencilLine } from "lucide-react";

type TrainingBuilderLeftPanelProps = {
  clientWeightKg: number;
};

export function TrainingBuilderLeftPanel({ clientWeightKg }: TrainingBuilderLeftPanelProps) {
  const builder = useTrainingBuilderContext();

  return (
    <div className="flex flex-col h-full">
      {/* Mode Toggle */}
      <div className="flex p-1 bg-slate-100 rounded-lg mb-4">
        <button
          onClick={() => builder.setMode("ai")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-all",
            builder.mode === "ai"
              ? "bg-gradient-to-r from-indigo-600 to-sky-500 text-white shadow-sm"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-200"
          )}
        >
          <Sparkles className="h-4 w-4" />
          AI Generation
        </button>
        <button
          onClick={() => builder.setMode("manual")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-all",
            builder.mode === "manual"
              ? "bg-gradient-to-r from-indigo-600 to-sky-500 text-white shadow-sm"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-200"
          )}
        >
          <PencilLine className="h-4 w-4" />
          Manual Creation
        </button>
      </div>

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
