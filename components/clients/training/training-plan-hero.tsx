"use client";

import { Pencil, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import { HEADER_EYEBROW_CLASS } from "@/components/clients/training/program-builder/builder-tokens";

type TrainingPlanHeroProps = {
  clientId: string;
  onOpenGenerator?: () => void;
  /** The teal "Edit plan" primary renders only when provided. */
  onEditPlan?: () => void;
  /** When set, the Edit-plan button renders disabled with this tooltip
   *  (e.g. a fully-elapsed plan can't be amended). */
  editPlanDisabledReason?: string | null;
};

// The Plans-subtab hero in the shared hero anatomy (Metrics / Exercise Data):
// eyebrow + title cluster on top, actions in the bottom row under a hairline.
// No stat row (owner call; week numbers live on the Data tab's
// TrainingSummaryHero). Owns the empty branch too, so the right panel has a
// single hero mount.
export function TrainingPlanHero({
  clientId: _clientId,
  onOpenGenerator,
  onEditPlan,
  editPlanDisabledReason,
}: TrainingPlanHeroProps) {
  const { plan } = useTrainingBuilderContext();

  return (
    <div className="rounded-[6px] bg-[#0f2027] px-5 py-[18px]">
      <div className="min-w-0">
        <p className={HEADER_EYEBROW_CLASS}>Training plan</p>
        <h2
          className={cn(
            "mt-0.5 truncate text-[15px] font-medium",
            plan ? "text-white" : "text-[rgba(255,255,255,0.4)]",
          )}
        >
          {plan ? plan.name : "No active training plan"}
        </h2>
      </div>

      {/* Action row — the hero's "underneath" slot (the Exercise hero's lens
          row position); filled primaries are the sanctioned hero register */}
      <div className="mt-3 flex items-center gap-2 border-t border-[rgba(255,255,255,0.06)] pt-3">
        {plan ? (
          <>
            {onEditPlan && (
              <button
                onClick={editPlanDisabledReason ? undefined : onEditPlan}
                disabled={!!editPlanDisabledReason}
                title={editPlanDisabledReason ?? undefined}
                className="inline-flex items-center gap-1.5 rounded-[6px] bg-[#0d9488] px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-[#0b7f75] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                Edit plan
              </button>
            )}
            {onOpenGenerator && (
              <button
                onClick={onOpenGenerator}
                className="inline-flex items-center gap-1.5 rounded-[6px] bg-[rgba(255,255,255,0.06)] px-3 py-1.5 text-[12.5px] font-medium text-[rgba(255,255,255,0.85)] transition-colors hover:bg-[rgba(255,255,255,0.1)]"
              >
                <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
                Apply program
              </button>
            )}
          </>
        ) : (
          onOpenGenerator && (
            <button
              onClick={onOpenGenerator}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-[6px] bg-[#0d9488] px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-[#0b7f75]"
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
              Browse programs
            </button>
          )
        )}
      </div>
    </div>
  );
}
