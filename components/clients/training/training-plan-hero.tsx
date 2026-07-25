"use client";

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

      {/* Action row — the hero's "underneath" slot, in the Exercise Data
          hero's lens-row register (owner call, retiring the filled-primary
          register here): primary action = the active-lens teal chip,
          secondary = the muted lens text. Text-only, no icons. */}
      <div className="mt-3 flex items-center gap-1 border-t border-[rgba(255,255,255,0.06)] pt-3">
        {plan ? (
          <>
            {onEditPlan && (
              <button
                onClick={editPlanDisabledReason ? undefined : onEditPlan}
                disabled={!!editPlanDisabledReason}
                title={editPlanDisabledReason ?? undefined}
                className="rounded-[4px] bg-[rgba(13,148,136,0.15)] px-2 py-1 text-[11px] font-medium text-[#0d9488] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                Edit plan
              </button>
            )}
            {onOpenGenerator && (
              <button
                onClick={onOpenGenerator}
                className="rounded-[4px] px-2 py-1 text-[11px] font-medium text-[rgba(255,255,255,0.45)] transition-colors hover:text-white"
              >
                Apply program
              </button>
            )}
          </>
        ) : (
          onOpenGenerator && (
            <button
              onClick={onOpenGenerator}
              className="rounded-[4px] bg-[rgba(13,148,136,0.15)] px-2 py-1 text-[11px] font-medium text-[#0d9488] transition-colors"
            >
              Browse programs
            </button>
          )
        )}
      </div>
    </div>
  );
}
