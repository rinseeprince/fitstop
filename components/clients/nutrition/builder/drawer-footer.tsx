"use client";

import { useState } from "react";
import { Sparkles, AlertCircle } from "lucide-react";
import { useNutritionBuilderContext } from "@/contexts/nutrition-builder-context";
import { ApplyDateDialog } from "@/components/ui/apply-date-dialog";

export function DrawerFooter() {
  const builder = useNutritionBuilderContext();
  const [showApplyDialog, setShowApplyDialog] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const hasPlan = builder.hasPlan;
  // Manual mode posts the coach's typed grams as the custom-macro override;
  // otherwise the server recalculates from the same pickers the preview used.
  const isManual = builder.manualEnabled;
  const cannotCalculate = builder.calcInputs?.status === "incomplete";

  /**
   * The gate. Deliberately here and not on the inputs: the coach types freely,
   * and the numbers are only judged when they ask to save. Blocking mid-edit is
   * what made the fields unusable — a partially-typed value is not a wrong
   * value, it is an unfinished one.
   */
  const handleClick = () => {
    if (cannotCalculate) {
      setSubmitError("This client is missing data the calculator needs — see above.");
      return;
    }
    if (isManual && builder.manualBlockingError) {
      setSubmitError(builder.manualBlockingError);
      return;
    }
    setSubmitError(null);
    // Always ask when this takes effect, including for a FIRST plan: a coach
    // often sets a client up before their start date, exactly as training
    // placement already allows. The server accepts any future effectiveFrom and
    // rejects past ones.
    setShowApplyDialog(true);
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
            disabled={builder.isGenerating}
            className="w-full flex items-center justify-center gap-2 bg-[#0d9488] text-white text-[13.5px] font-semibold rounded-[6px] px-4 py-2.5 transition-all hover:-translate-y-px hover:shadow-[0_4px_16px_rgba(13,148,136,0.25)] hover:bg-gradient-to-br hover:from-[#0d9488] hover:to-[#0a7c72] disabled:opacity-50 disabled:pointer-events-none"
          >
            <Sparkles className={`w-4 h-4 ${builder.isGenerating ? "animate-pulse" : ""}`} strokeWidth={1.5} />
            {builder.isGenerating
              ? "Generating..."
              : hasPlan
                ? "Regenerate Plan"
                : "Generate Plan"}
          </button>

          {submitError && (
            <div className="bg-[rgba(245,158,11,0.07)] rounded-[6px] p-3.5 mt-3 flex items-start gap-2.5">
              <AlertCircle className="h-3 w-3 text-[#d97706] mt-0.5 flex-shrink-0" strokeWidth={1.5} />
              <p className="text-[11.5px] font-medium text-[#d97706] leading-[1.4]">
                {submitError}
              </p>
            </div>
          )}

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
        title={hasPlan ? "When should changes take effect?" : "When should this plan start?"}
        description={
          hasPlan
            ? "The new nutrition plan will replace the current one. Choose when the updated targets should start."
            : "Targets are generated from this date forward. Choose a future date if you are setting this client up ahead of time."
        }
        nowLabel={hasPlan ? "Apply Now" : "Start Today"}
        fromLabel={hasPlan ? "Apply From Date" : "Start From Date"}
        onApply={handleApply}
      />
    </>
  );
}
