"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import { ApplyDateDialog } from "@/components/ui/apply-date-dialog";

export function TrainingDrawerFooter() {
  const builder = useTrainingBuilderContext();
  const [showApplyDialog, setShowApplyDialog] = useState(false);

  const isAiMode = builder.mode === "ai";
  const isGenerating = builder.isGenerating;
  const isSaving = builder.isSavingManual;
  const isBusy = isGenerating || isSaving;
  const hasPlan = !!builder.plan;

  const isDisabled =
    isBusy ||
    builder.phaseBlocked ||
    (isAiMode && !builder.prompt.trim()) ||
    (!isAiMode && builder.manualSessions.length === 0);

  const handleClick = () => {
    if (hasPlan) {
      // Regeneration — show the "apply now or later" popup
      setShowApplyDialog(true);
    } else {
      // First creation — no popup, events start from phase start date (handled by API)
      if (isAiMode) {
        void builder.generate();
      } else {
        void builder.saveManualPlan();
      }
    }
  };

  const handleApply = (effectiveFrom: string | null) => {
    if (isAiMode) {
      void builder.generate(effectiveFrom);
    } else {
      void builder.saveManualPlan(effectiveFrom);
    }
  };

  const buttonText = isGenerating
    ? "Generating..."
    : isSaving
      ? "Saving..."
      : isAiMode
        ? "Generate Plan"
        : "Save Training Plan";

  return (
    <>
      <div
        className="flex-shrink-0 pointer-events-none"
        style={{ background: "linear-gradient(to top, #f4f7f6 70%, transparent)" }}
      >
        <div className="pointer-events-auto px-6 pb-6 pt-1">
          <button
            onClick={handleClick}
            disabled={isDisabled}
            className="w-full flex items-center justify-center gap-2 bg-[#0d9488] text-white text-[13.5px] font-semibold rounded-[6px] px-4 py-2.5 transition-all hover:-translate-y-px hover:shadow-[0_4px_16px_rgba(13,148,136,0.25)] hover:bg-gradient-to-br hover:from-[#0d9488] hover:to-[#0a7c72] disabled:opacity-50 disabled:pointer-events-none"
          >
            <Sparkles
              className={`w-4 h-4 ${isBusy ? "animate-pulse" : ""}`}
              strokeWidth={1.5}
            />
            {buttonText}
          </button>
        </div>
      </div>

      <ApplyDateDialog
        open={showApplyDialog}
        onOpenChange={setShowApplyDialog}
        description="The new plan will replace the current one. Choose when the updated schedule should start."
        onApply={handleApply}
      />
    </>
  );
}
