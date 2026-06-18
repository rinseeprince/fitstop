"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Calendar, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PhaseReviewDrawer } from "./phase-review-drawer";
import { EditPhaseDialog } from "./edit-phase-dialog";
import { PhaseExpandedContent } from "./phase-expanded-content";
import { weightFromKg } from "@/utils/nutrition-helpers";
import type { Phase, PhaseStatus } from "@/types/roadmap";

const statusBadgeVariant: Record<
  PhaseStatus,
  "secondary" | "default" | "success" | "neutral"
> = {
  planned: "secondary",
  active: "default",
  completed: "success",
  skipped: "neutral",
};

const statusBorderClass: Record<PhaseStatus, string> = {
  active: "border border-[rgba(13,148,136,0.08)]",
  completed: "border border-[rgba(13,148,136,0.08)]",
  planned: "border border-dashed border-[rgba(13,148,136,0.10)] opacity-[0.85]",
  skipped: "border border-[rgba(13,148,136,0.08)] opacity-60",
};

type PhaseCardProps = {
  phase: Phase;
  clientId: string;
  hasActivePhase: boolean;
  weightUnit: "lbs" | "kg";
  onUpdate: () => void;
  defaultExpanded?: boolean;
  index?: number;
  isReadOnly?: boolean;
};

export const PhaseCard = ({
  phase,
  clientId,
  hasActivePhase,
  weightUnit,
  onUpdate,
  defaultExpanded,
  index = 0,
  isReadOnly = false,
}: PhaseCardProps) => {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  const [isActivating, setIsActivating] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/roadmap/phases/${phase.id}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        // Planned-only: a started/completed phase returns 400 ("archive instead").
        throw new Error(data.error || "Failed to delete phase");
      }
      toast({ title: `"${phase.name}" deleted` });
      setShowDeleteConfirm(false);
      onUpdate();
    } catch (error) {
      toast({
        title: "Couldn't delete phase",
        description:
          error instanceof Error ? error.message : "Failed to delete phase",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleActivate = async () => {
    setIsActivating(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/roadmap/phases/${phase.id}/activate`,
        { method: "POST" }
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to activate phase");
      }

      toast({ title: `"${phase.name}" activated` });
      onUpdate();
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to activate phase",
        variant: "destructive",
      });
    } finally {
      setIsActivating(false);
    }
  };

  const showActivate = phase.status === "planned" && !isReadOnly;
  const activateDisabled = hasActivePhase || isActivating;

  const msPerDay = 24 * 60 * 60 * 1000;
  const totalDays =
    phase.startDate && phase.endDate
      ? Math.round((new Date(phase.endDate).getTime() - new Date(phase.startDate).getTime()) / msPerDay) + 1
      : null;
  const totalWeeks =
    phase.durationWeeks ??
    (totalDays != null ? Math.ceil(totalDays / 7) : null);
  const currentWeek =
    phase.status === "active" && phase.startDate
      ? Math.max(1, Math.ceil(
          (Math.round((Date.now() - new Date(phase.startDate).getTime()) / msPerDay) + 1) / 7
        ))
      : null;

  const goalParts: string[] = [];
  if (phase.phaseGoalWeight != null)
    goalParts.push(`${weightFromKg(phase.phaseGoalWeight, weightUnit).toFixed(1)}${weightUnit}`);
  if (phase.phaseGoalBodyFatPercentage != null)
    goalParts.push(`${phase.phaseGoalBodyFatPercentage}%`);

  return (
    <div
      className={`bg-white rounded-[6px] ${statusBorderClass[phase.status]}`}
      style={{
        animation: "slideUp 0.35s ease forwards",
        animationDelay: `${index * 0.04}s`,
        opacity: 0,
      }}
    >
      <div className="px-4 py-3">
        {/* Header row */}
        <div className="flex items-center gap-3">
          {/* Left: chevron + name + badge */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 min-w-0 flex-1"
          >
            <ChevronRight
              className={`h-4 w-4 shrink-0 text-[#5a7d82] transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
            />
            <span className="text-[14px] font-semibold text-[#0c1a1e] truncate">
              {phase.name}
            </span>
            <Badge variant={statusBadgeVariant[phase.status]}>
              {phase.status}
            </Badge>
          </button>

          {/* Middle: goals + dates */}
          <div className="hidden sm:flex items-center gap-3 shrink-0">
            {goalParts.length > 0 && (
              <span className="font-mono-display text-[12px] text-[#93b0b4]">
                Goal: {goalParts.join(" / ")}
              </span>
            )}
            {(phase.startDate || phase.endDate) && (
              <span className="flex items-center gap-1 font-mono-display text-[12px] text-[#93b0b4]">
                <Calendar className="h-3 w-3" />
                {phase.startDate ?? ""}
                {phase.startDate && phase.endDate ? " → " : ""}
                {phase.endDate ?? ""}
                {totalDays != null && (
                  <span className="text-[#93b0b4]">
                    ({totalDays < 14 ? `${totalDays}d` : `${totalWeeks}wk`})
                  </span>
                )}
              </span>
            )}
          </div>

          {/* Right: week badge + actions */}
          <div className="flex items-center gap-2 shrink-0">
            {currentWeek != null && totalWeeks != null && (
              <span className="text-[11px] font-mono-display bg-[rgba(13,148,136,0.05)] text-[#0d9488] px-2 py-0.5 rounded-[6px] font-semibold">
                {Math.min(currentWeek, totalWeeks)}/{totalWeeks} weeks
              </span>
            )}

            {!isReadOnly &&
              (phase.status === "planned" || phase.status === "active") && (
                <button
                  onClick={() => setEditOpen(true)}
                  className="p-1.5 rounded-[6px] text-[#93b0b4] hover:text-[#5a7d82] hover:bg-[rgba(13,148,136,0.05)] transition-colors"
                  title="Edit phase"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              )}

            {!isReadOnly && phase.status === "planned" && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="p-1.5 rounded-[6px] text-[#93b0b4] hover:text-[#c06060] hover:bg-[rgba(192,96,96,0.05)] transition-colors"
                title="Delete phase"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}

            {showActivate && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleActivate}
                disabled={activateDisabled}
                className="bg-white border-[rgba(13,148,136,0.08)] text-[#5a7d82] hover:text-[#0d9488] hover:border-[#0d9488]"
                title={
                  hasActivePhase
                    ? "Complete the current active phase first"
                    : "Activate now (phases also auto-activate on their start date)"
                }
              >
                {isActivating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Activate"
                )}
              </Button>
            )}

            {!isReadOnly && phase.status === "active" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReviewOpen(true)}
                className="bg-white border-[rgba(13,148,136,0.08)] text-[#5a7d82] hover:text-[#0d9488] hover:border-[#0d9488]"
              >
                Complete Phase
              </Button>
            )}
          </div>
        </div>

        {/* Completed phase meta */}
        {phase.status === "completed" && (
          <div className="flex items-center gap-3 mt-2">
            {phase.milestones.length > 0 && (
              <span className="text-[12px] font-semibold bg-[rgba(13,148,136,0.05)] text-[#0d9488] px-1.5 py-0.5 rounded-[6px]">
                {phase.milestones.filter((m) => m.completed).length}/{phase.milestones.length} milestones
              </span>
            )}
            {phase.coachReflection && (
              <span className="text-[#93b0b4] text-[12px] italic truncate">
                {phase.coachReflection.length > 80 ? phase.coachReflection.slice(0, 80) + "..." : phase.coachReflection}
              </span>
            )}
          </div>
        )}

        {/* Expanded content */}
        {expanded && (
          <PhaseExpandedContent
            phase={phase}
            clientId={clientId}
            weightUnit={weightUnit}
            onMutate={onUpdate}
            isReadOnly={isReadOnly}
          />
        )}
      </div>

      <PhaseReviewDrawer
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        phase={phase}
        clientId={clientId}
        weightUnit={weightUnit}
        onTransitionComplete={onUpdate}
      />

      <EditPhaseDialog
        phase={phase}
        clientId={clientId}
        weightUnit={weightUnit}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSuccess={onUpdate}
      />

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-[rgba(192,96,96,0.08)] flex items-center justify-center">
                <Trash2 className="h-4 w-4 text-[#c06060]" />
              </div>
              <DialogTitle>Delete {phase.name}?</DialogTitle>
            </div>
            <DialogDescription className="pt-2">
              This permanently removes this planned phase. Any plans linked to it
              are unlinked (not deleted). This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteConfirm(false)}
              disabled={isDeleting}
            >
              Keep phase
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete phase"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
