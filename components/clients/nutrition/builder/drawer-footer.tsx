"use client";

import { useState } from "react";
import { Sparkles, AlertCircle } from "lucide-react";
import { useNutritionBuilderContext } from "@/contexts/nutrition-builder-context";
import { ApplyDateDialog } from "@/components/ui/apply-date-dialog";

export function DrawerFooter() {
  const builder = useNutritionBuilderContext();
  const [showApplyDialog, setShowApplyDialog] = useState(false);
  const [preserveCalories, setPreserveCalories] = useState(false);

  const hasPlan = builder.hasPlan;

  const handleClick = () => {
    if (hasPlan) {
      // Regeneration — show the "apply now or later" popup
      setShowApplyDialog(true);
    } else {
      // First creation — no popup, effective_from uses phase start date
      builder.generatePlan(false);
    }
  };

  const handleApply = (effectiveFrom: string | null) => {
    builder.generatePlan(false, effectiveFrom, preserveCalories);
  };

  return (
    <>
      <div className="flex-shrink-0 pointer-events-none" style={{ background: "linear-gradient(to top, #f4f7f6 70%, transparent)" }}>
        <div className="pointer-events-auto px-6 pb-6 pt-4">
          <button
            onClick={handleClick}
            disabled={builder.isGenerating || builder.phaseBlocked || (builder.customDayDistribution && !builder.budgetValidation?.isValid)}
            title={
              builder.customDayDistribution && !builder.budgetValidation?.isValid
                ? "Save your custom day distribution first, or adjust calories to match the weekly budget"
                : undefined
            }
            className="w-full flex items-center justify-center gap-2 bg-[#0d9488] text-white text-[13.5px] font-semibold rounded-[6px] px-4 py-2.5 transition-all hover:-translate-y-px hover:shadow-[0_4px_16px_rgba(13,148,136,0.25)] hover:bg-gradient-to-br hover:from-[#0d9488] hover:to-[#0a7c72] disabled:opacity-50 disabled:pointer-events-none"
          >
            <Sparkles className={`w-4 h-4 ${builder.isGenerating ? "animate-pulse" : ""}`} strokeWidth={1.5} />
            {builder.isGenerating
              ? "Generating..."
              : builder.customDayDistribution
                ? "Apply Distribution & Regenerate"
                : builder.settingsChanged
                  ? "Save & Regenerate Plan"
                  : builder.hasPlan
                    ? "Regenerate Plan"
                    : "Generate Plan"}
          </button>

          {!builder.client.bmr && (
            <div className="bg-[rgba(13,148,136,0.08)] rounded-[6px] p-3.5 mt-3">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="h-4 w-4 text-[#0d9488] mt-0.5 flex-shrink-0" strokeWidth={1.5} />
                <div>
                  <p className="text-[12px] font-medium text-[#0c1a1e]">BMR not calculated</p>
                  <p className="text-[11px] text-[#93b0b4] mt-0.5">
                    Calculate BMR first using the button in the Profile tab.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <ApplyDateDialog
        open={showApplyDialog}
        onOpenChange={setShowApplyDialog}
        description="The new nutrition plan will replace the current one. Choose when the updated targets should start."
        onApply={handleApply}
        maxDate={builder.activePhase?.endDate}
        showPreserveCalories={true}
        preserveCalories={preserveCalories}
        onPreserveCaloriesChange={setPreserveCalories}
      />
    </>
  );
}
