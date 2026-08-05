"use client";

import { useState } from "react";
import { Sparkles, AlertCircle } from "lucide-react";
import { useNutritionBuilderContext } from "@/contexts/nutrition-builder-context";
import { ApplyDateDialog } from "@/components/ui/apply-date-dialog";

export function DrawerFooter() {
  const builder = useNutritionBuilderContext();
  const [showApplyDialog, setShowApplyDialog] = useState(false);

  const hasPlan = builder.hasPlan;
  // Manual mode posts the coach's typed grams as the custom-macro override;
  // otherwise the server recalculates from the same pickers the preview used.
  const isManual = builder.manualEnabled;

  // Nothing to generate from until the client has weight/BMR/gender/unit.
  const cannotCalculate = builder.calcInputs?.status === "incomplete";
  const blockingError = isManual ? builder.manualValidationError : null;

  const handleClick = () => {
    if (hasPlan) {
      // Regeneration — show the "apply now or later" popup
      setShowApplyDialog(true);
    } else {
      // First creation — no popup, effective_from resolves server-side
      void builder.generatePlan(isManual);
    }
  };

  const handleApply = (effectiveFrom: string | null) => {
    void builder.generatePlan(isManual, effectiveFrom);
  };

  return (
    <>
      <div className="flex-shrink-0 pointer-events-none" style={{ background: "linear-gradient(to top, #f4f7f6 70%, transparent)" }}>
        <div className="pointer-events-auto px-6 pb-6 pt-4">
          <button
            onClick={handleClick}
            disabled={builder.isGenerating || cannotCalculate || !!blockingError}
            title={
              blockingError ??
              (cannotCalculate
                ? "This client is missing data the calculator needs"
                : undefined)
            }
            className="w-full flex items-center justify-center gap-2 bg-[#0d9488] text-white text-[13.5px] font-semibold rounded-[6px] px-4 py-2.5 transition-all hover:-translate-y-px hover:shadow-[0_4px_16px_rgba(13,148,136,0.25)] hover:bg-gradient-to-br hover:from-[#0d9488] hover:to-[#0a7c72] disabled:opacity-50 disabled:pointer-events-none"
          >
            <Sparkles className={`w-4 h-4 ${builder.isGenerating ? "animate-pulse" : ""}`} strokeWidth={1.5} />
            {builder.isGenerating
              ? "Generating..."
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
      />
    </>
  );
}
