"use client";

import { useState } from "react";
import { Sparkles, AlertCircle } from "lucide-react";
import { useNutritionBuilderContext } from "@/contexts/nutrition-builder-context";

type DrawerFooterProps = {
  /** Fires only on a plan that actually SAVED (Session 7.4's return trip). */
  onSaved?: () => void;
};

export function DrawerFooter({ onSaved }: DrawerFooterProps) {
  const builder = useNutritionBuilderContext();
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
    // The Starts on field's `min` greys the days out; a typed date gets the
    // sentence here rather than the server's 400. The server stays the belt.
    if (
      builder.effectiveFrom &&
      builder.clientToday &&
      builder.effectiveFrom < builder.clientToday
    ) {
      setSubmitError("The start date can't be in the past.");
      return;
    }
    setSubmitError(null);
    // The day the plan takes effect is a drawer setting the coach set before
    // reaching this button (Starts on), so Generate saves directly — a FIRST
    // plan queued ahead of the client's start included, exactly as training
    // placement allows. The server accepts any future date and rejects past ones.
    void builder.generatePlan(isManual).then((saved) => {
      // The BOOLEAN is the success signal, never the drawer closing. A coach
      // can close the drawer without saving, and since Session 6 a save can
      // return false AFTER the plan committed (a failed note insert) — leaving
      // them here with their note intact, which is correct. Bouncing on either
      // would be a lie about what happened.
      if (saved) onSaved?.();
    });
  };

  return (
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
  );
}
