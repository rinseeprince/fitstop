"use client";

import { memo, useState } from "react";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import { Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useInvalidateNutritionCalendar } from "@/hooks/use-nutrition-calendar-events";
import { TrainingCalendarView } from "../calendar/training-calendar-view";
import { TrainingPlanHero } from "@/components/clients/training/training-plan-hero";

type TrainingBuilderRightPanelProps = {
  clientId: string;
  onOpenGenerator?: () => void;
};

// The Plans-subtab surface: dark hero (both branches) + the month calendar.
// Owns the client-level "Delete future sessions" flow (relocated from the
// old TopContentBar) — the trigger renders in the calendar toolbar's
// Schedule divider, the confirm dialog lives here.
export const TrainingBuilderRightPanel = memo(function TrainingBuilderRightPanel({
  clientId,
  onOpenGenerator,
}: TrainingBuilderRightPanelProps) {
  const builder = useTrainingBuilderContext();
  const { editMode, setEditMode } = builder;
  const { toast } = useToast();
  const invalidateNutritionCalendar = useInvalidateNutritionCalendar();
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const handleClearPlan = async () => {
    if (!builder.plan) return;
    setIsClearing(true);
    try {
      // Client-level clear: removes future sessions across ALL coexisting plans.
      const res = await fetch(`/api/clients/${clientId}/training`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? "Failed to clear plan");
      }
      toast({ title: "Future sessions deleted" });
      setShowClearConfirm(false);
      // Deleting training sessions cascade-rewrites nutrition_events.
      void invalidateNutritionCalendar(clientId);
      await builder.fetchPlan();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to clear plan";
      toast({ title: "Error", description: message, variant: "destructive" });
    } finally {
      setIsClearing(false);
    }
  };

  // Loading state
  if (builder.isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-[#93b0b4]" />
      </div>
    );
  }

  // Error state
  if (builder.loadError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(192,96,96,0.08)]">
          <AlertTriangle className="h-6 w-6 text-[#c06060]" />
        </div>
        <h3 className="mb-2 text-base font-semibold text-[#0c1a1e]">
          Failed to load training plan
        </h3>
        <p className="mb-6 max-w-sm text-sm text-[#93b0b4]">
          {builder.loadError}
        </p>
        <button
          onClick={() => builder.fetchPlan()}
          className="inline-flex items-center gap-1.5 rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#5a7d82] transition-colors hover:bg-[#f0f5f4]"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Try again
        </button>
      </div>
    );
  }

  // Calendar is always visible — the hero owns both plan/empty branches.
  return (
    <div className="space-y-5">
      <TrainingPlanHero clientId={clientId} onOpenGenerator={onOpenGenerator} />

      <TrainingCalendarView
        clientId={clientId}
        plan={builder.plan ?? null}
        phases={builder.phases}
        editMode={editMode}
        clientTimezone={builder.clientTimezone}
        onUpdate={builder.fetchPlan}
        onEditModeChange={setEditMode}
        onDeleteFuture={
          builder.plan ? () => setShowClearConfirm(true) : undefined
        }
      />

      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(192,96,96,0.08)]">
                <AlertTriangle className="h-4 w-4 text-[#c06060]" />
              </div>
              <DialogTitle>Delete all future sessions?</DialogTitle>
            </div>
            <DialogDescription className="pt-2">
              This removes every upcoming session from this client&apos;s calendar, across all placed plans. Completed and past sessions are kept for history. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setShowClearConfirm(false)}
              disabled={isClearing}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              className="border border-[rgba(192,96,96,0.3)] text-[#c06060] hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]"
              onClick={handleClearPlan}
              disabled={isClearing}
            >
              {isClearing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Delete future sessions"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});
