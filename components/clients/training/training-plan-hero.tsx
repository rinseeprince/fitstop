"use client";

import { Pencil, Sparkles } from "lucide-react";
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

// The Plans-subtab hero in the program-top-bar's dark language: eyebrow +
// plan name + actions only — no stat row (owner call; week numbers live on
// the Data tab's TrainingSummaryHero, which still serves that subtab). Owns
// the empty branch too, so the right panel has a single hero mount.
export function TrainingPlanHero({
  clientId: _clientId,
  onOpenGenerator,
  onEditPlan,
  editPlanDisabledReason,
}: TrainingPlanHeroProps) {
  const { plan } = useTrainingBuilderContext();

  if (!plan) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-[6px] bg-[#0f2027] p-5">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[rgba(13,148,136,0.15)]">
            <Sparkles className="h-5 w-5 text-[#0d9488]" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-white">
              No training plan yet
            </p>
            <p className="mt-0.5 text-[11.5px] text-[rgba(255,255,255,0.5)]">
              Apply a program from your library to this client&apos;s calendar.
            </p>
          </div>
        </div>
        {onOpenGenerator && (
          <button
            onClick={onOpenGenerator}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[6px] bg-[#0d9488] px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-[#0b7f75]"
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
            Browse programs
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 overflow-hidden rounded-[6px] bg-[#0f2027] px-5 py-3.5">
      <div className="min-w-0">
        <p className={HEADER_EYEBROW_CLASS}>Training plan</p>
        <h2 className="truncate text-[17px] font-semibold leading-tight tracking-[-0.01em] text-white">
          {plan.name}
        </h2>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
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
      </div>
    </div>
  );
}
