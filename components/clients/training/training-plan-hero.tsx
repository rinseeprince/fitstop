"use client";

import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import { useDialogSubject } from "@/hooks/use-dialog-subject";
import { useInvalidateTrainingData } from "@/hooks/use-calendar-events";
import { useInvalidateNutritionCalendar } from "@/hooks/use-nutrition-calendar-events";
import { useClearClientOverview } from "@/hooks/use-client-overview";
import { useClearAttentionFeed } from "@/hooks/use-attention-feed";
import { useClearBlockFacts } from "@/components/clients/metrics/hooks/use-client-blocks";
import { HEADER_EYEBROW_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import { TextSkeleton } from "@/components/text-skeleton";
import { PlanHeroLine } from "./plan-hero-line";
import { DeleteProgramDialog, type ProgramDeleteTarget } from "./delete-program-dialog";

type TrainingPlanHeroProps = {
  clientId: string;
  onOpenGenerator?: () => void;
  /** The teal "Edit plan" primary renders only when provided, and always
   *  enabled: the plan read answers with the program covering the client's
   *  today, else the next queued one, so an ended program never reaches the
   *  hero. */
  onEditPlan?: () => void;
};

const DELETE_FAILED = "Could not delete the plan";

// The Plans-subtab hero in the shared hero anatomy (Metrics / Exercise Data):
// eyebrow + title cluster on top, actions in the bottom row under a hairline.
// No stat row (owner call; week numbers live on the Data tab's
// TrainingSummaryHero). Under the name, a line for the program — "Starts" with
// a pencil and a bin before it starts, "Ends" with a bin once it has — and a
// line for the program after it (PlanHeroLine). Owns the empty branch too, so
// the right panel has a single hero mount — and the pending one: until the plan
// read answers, the hero is its own frame with the values held as placeholders,
// claiming neither a plan nor its absence.
//
// The hero owns the per-program delete's confirm: the delete removes the line
// that asked for it, so the confirm lives here, beside both frames, and closes
// onto the refetched hero.
export function TrainingPlanHero({
  clientId,
  onOpenGenerator,
  onEditPlan,
}: TrainingPlanHeroProps) {
  const { plan, nextPlan, clientToday, planStartFloor, isPending } = useTrainingBuilderContext();
  const deleteDialog = useDialogSubject<ProgramDeleteTarget>();
  const invalidateTrainingData = useInvalidateTrainingData();
  const invalidateNutritionCalendar = useInvalidateNutritionCalendar();
  const clearClientOverview = useClearClientOverview();
  const clearAttentionFeed = useClearAttentionFeed();
  const clearBlockFacts = useClearBlockFacts();

  // A running program ends yesterday and keeps its past; one that hasn't
  // started is removed. Both lose their sessions from the deletion floor.
  async function deleteProgram(target: ProgramDeleteTarget): Promise<boolean> {
    try {
      const res = await fetch(`/api/clients/${clientId}/training/${target.id}`, {
        method: "DELETE",
      });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || !body.success) {
        toast.error("Delete failed", { description: body.error ?? DELETE_FAILED });
        return false;
      }
      // Everything that reads the program: the Overview, the feed and the
      // block card render definite answers and are cleared; the nutrition
      // month recomputes its training days. The Training tab's reads — the
      // calendar and this hero's plan — revalidate in place, awaited, so the
      // confirm closes onto the hero without the program.
      void invalidateNutritionCalendar(clientId);
      void clearClientOverview(clientId);
      void clearAttentionFeed();
      void clearBlockFacts(clientId);
      await invalidateTrainingData(clientId);
      deleteDialog.close();
      toast.success(`"${target.name}" ${target.hasStarted ? "ended" : "removed"}`);
      return true;
    } catch (error) {
      console.error("Failed to delete the plan:", error);
      toast.error("Delete failed", { description: DELETE_FAILED });
      return false;
    }
  }

  const dialog = (
    <DeleteProgramDialog
      key={`delete-program-${deleteDialog.openKey}`}
      open={deleteDialog.open}
      target={deleteDialog.subject}
      onCancel={deleteDialog.close}
      onConfirm={() =>
        deleteDialog.subject ? deleteProgram(deleteDialog.subject) : Promise.resolve(false)
      }
    />
  );

  if (isPending) {
    return (
      <>
        <div className="rounded-[6px] bg-[#0f2027] px-5 py-[18px]">
          <div className="min-w-0">
            <p className={HEADER_EYEBROW_CLASS}>Training plan</p>
            <h2 className="mt-0.5 truncate text-[15px] font-medium text-white">
              <TextSkeleton className="w-44" />
            </h2>
          </div>
          <div className="mt-3 flex items-center gap-1 border-t border-[rgba(255,255,255,0.06)] pt-3">
            <span className="px-2 py-1 text-[11px] font-medium">
              <TextSkeleton className="w-16" />
            </span>
            <span className="px-2 py-1 text-[11px] font-medium">
              <TextSkeleton className="w-20" />
            </span>
          </div>
        </div>
        {dialog}
      </>
    );
  }

  return (
    <>
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
          {/* "Starts <date>" is the Overview queued card's wording and formatter,
              so the two surfaces read as one fact. Keyed by program, so a line
              never carries a pending move onto another program. */}
          {plan?.effectiveFrom && plan.effectiveUntil && clientToday && planStartFloor && (
            <PlanHeroLine
              key={plan.id}
              clientId={clientId}
              kind="plan"
              program={{
                id: plan.id,
                name: plan.name,
                startsOn: plan.effectiveFrom,
                endsOn: plan.effectiveUntil,
              }}
              clientToday={clientToday}
              floor={planStartFloor}
              onDelete={deleteDialog.show}
            />
          )}
          {plan && nextPlan && clientToday && planStartFloor && (
            <PlanHeroLine
              key={nextPlan.id}
              clientId={clientId}
              kind="next"
              program={{
                id: nextPlan.id,
                name: nextPlan.name,
                startsOn: nextPlan.effectiveFrom,
                endsOn: nextPlan.effectiveUntil,
              }}
              clientToday={clientToday}
              floor={planStartFloor}
              onDelete={deleteDialog.show}
            />
          )}
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
                  onClick={onEditPlan}
                  className="rounded-[4px] bg-[rgba(13,148,136,0.15)] px-2 py-1 text-[11px] font-medium text-[#0d9488] transition-colors"
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
      {dialog}
    </>
  );
}
