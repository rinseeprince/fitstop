"use client";

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import { AIPromptPanel } from "./ai-prompt-panel";
import { ManualWorkoutBuilder } from "./manual-workout-builder";
import { DraftEditor } from "./draft-editor";
import { useSavedPlans } from "@/hooks/use-saved-plans";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  BookOpen,
  Pencil,
  X,
  Loader2,
  ArrowLeft,
  ArrowRight,
  Save,
  Trash2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { BuilderMode, SavedPlan } from "@/types/training";

type TrainingPlanBuilderOverlayProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientWeightKg: number;
  weightUnit?: "lbs" | "kg";
};

const MODE_OPTIONS: { value: BuilderMode; label: string; Icon: typeof Sparkles; description: string }[] = [
  {
    value: "ai",
    label: "AI Generation",
    Icon: Sparkles,
    description: "Describe your goals, let AI draft the programme.",
  },
  {
    value: "manual",
    label: "Manual Creation",
    Icon: Pencil,
    description: "Build sessions and exercises from scratch.",
  },
  {
    value: "saved",
    label: "Saved Plans",
    Icon: BookOpen,
    description: "Apply an existing plan from your library.",
  },
];

export function TrainingPlanBuilderOverlay({
  open,
  onOpenChange,
  clientWeightKg,
  weightUnit: _weightUnit = "lbs",
}: TrainingPlanBuilderOverlayProps) {
  const builder = useTrainingBuilderContext();
  const hasDraft = !!builder.savedPlanId;

  const title = hasDraft
    ? "Review Plan"
    : builder.plan
      ? "Regenerate Training Plan"
      : "Create Training Plan";

  const handleClose = () => {
    // If a draft is loaded, clear it. If the user closes the overlay completely,
    // reset builder state so next open starts fresh.
    if (hasDraft) {
      builder.setSavedPlanId(null);
    }
    onOpenChange(false);
  };

  const handleBackToBuilder = () => {
    builder.setSavedPlanId(null);
  };

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : handleClose())}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-[rgba(15,32,39,0.35)] backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:duration-200 data-[state=closed]:duration-200"
        />
        <DialogPrimitive.Content
          className="fixed inset-y-0 right-0 z-50 w-[920px] max-w-[100vw] flex flex-col bg-[#f4f7f6] shadow-[-8px_0_24px_rgba(15,32,39,0.12)] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right data-[state=open]:duration-250 data-[state=closed]:duration-200"
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Build or review a training plan for this client.
          </DialogPrimitive.Description>

          <OverlayHeader
            title={title}
            hasDraft={hasDraft}
            onBack={handleBackToBuilder}
            onClose={handleClose}
          />

          <div className="flex-1 min-h-0 overflow-hidden">
            {hasDraft ? (
              <DraftEditor
                // Keying on savedPlanId forces a full unmount/mount when the
                // active plan changes. This is the canonical React pattern
                // for resetting per-entity component state and prevents any
                // working-copy edits from the previous plan from leaking in.
                key={builder.savedPlanId}
                savedPlanId={builder.savedPlanId!}
                clientId={builder.clientId}
                onDiscard={() => {
                  builder.setSavedPlanId(null);
                  void builder.fetchPlan();
                }}
                onApplied={() => {
                  // Refresh the client's active-plan view — the apply landed
                  // something on the calendar. Keep the editor open so the
                  // coach can continue working.
                  void builder.fetchPlan();
                }}
              />
            ) : (
              <BuilderBody clientWeightKg={clientWeightKg} />
            )}
          </div>

          {!hasDraft && <OverlayFooter />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Header
// ═══════════════════════════════════════════════════════════════════════════

function OverlayHeader({
  title,
  hasDraft,
  onBack,
  onClose,
}: {
  title: string;
  hasDraft: boolean;
  onBack: () => void;
  onClose: () => void;
}) {
  return (
    <div className="bg-[#0f2027] px-6 py-4 flex-shrink-0 flex items-center gap-4">
      {hasDraft && (
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.7)] text-[12.5px] font-medium transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>
      )}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="w-[36px] h-[36px] rounded-[6px] bg-[rgba(13,148,136,0.15)] flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-[18px] h-[18px] text-[#0d9488]" strokeWidth={1.5} />
        </div>
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold text-white leading-tight truncate">{title}</h2>
          <p className="text-[12px] text-[rgba(255,255,255,0.5)] mt-0.5 leading-[1.4] truncate">
            {hasDraft
              ? "Edit sessions and exercises, then save or apply to the client."
              : "Build a structured training programme. Your current plan stays active until you apply the new one."}
          </p>
        </div>
      </div>
      <button
        onClick={onClose}
        className="w-[32px] h-[32px] rounded-[6px] bg-[rgba(255,255,255,0.06)] flex items-center justify-center flex-shrink-0 hover:bg-[rgba(255,255,255,0.1)] transition-colors"
        aria-label="Close"
      >
        <X className="w-4 h-4 text-[rgba(255,255,255,0.6)]" strokeWidth={1.5} />
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Builder body (shown when no draft is loaded)
// ═══════════════════════════════════════════════════════════════════════════

function BuilderBody({ clientWeightKg }: { clientWeightKg: number }) {
  const builder = useTrainingBuilderContext();

  return (
    <div className="grid h-full grid-cols-[240px_1fr]">
      {/* Left rail: mode toggle */}
      <aside className="border-r border-[rgba(13,148,136,0.08)] bg-white/60 p-5 overflow-y-auto">
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#5a7d82] mb-3">
            Builder Mode
          </h3>
          {MODE_OPTIONS.map(({ value, label, Icon, description }) => {
            const active = builder.mode === value;
            return (
              <button
                key={value}
                onClick={() => builder.setMode(value)}
                className={cn(
                  "w-full text-left p-3 rounded-[8px] transition-all border",
                  active
                    ? "bg-white border-[rgba(13,148,136,0.3)] shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
                    : "bg-transparent border-transparent hover:bg-white/80 hover:border-[rgba(13,148,136,0.1)]"
                )}
              >
                <div className="flex items-center gap-2.5">
                  <Icon
                    className={cn(
                      "h-4 w-4 flex-shrink-0",
                      active ? "text-[#0d9488]" : "text-[#5a7d82]"
                    )}
                    strokeWidth={1.8}
                  />
                  <span
                    className={cn(
                      "text-[13.5px] font-semibold",
                      active ? "text-[#0c1a1e]" : "text-[#5a7d82]"
                    )}
                  >
                    {label}
                  </span>
                </div>
                <p
                  className={cn(
                    "text-[12px] mt-1.5 leading-[1.4]",
                    active ? "text-[#5a7d82]" : "text-[#93b0b4]"
                  )}
                >
                  {description}
                </p>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Main pane */}
      <main className="overflow-y-auto">
        <div className="px-7 py-6">
          {builder.mode === "ai" && <AIPromptPanel clientWeightKg={clientWeightKg} />}
          {builder.mode === "manual" && (
            <ManualWorkoutBuilder clientWeightKg={clientWeightKg} />
          )}
          {builder.mode === "saved" && <SavedPlansList />}
        </div>
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Saved plans list (extracted from drawer-form-body.tsx)
// ═══════════════════════════════════════════════════════════════════════════

function SavedPlansList() {
  const builder = useTrainingBuilderContext();
  const { toast } = useToast();
  const { plans, isLoading, mutate } = useSavedPlans();
  const [planToDelete, setPlanToDelete] = useState<SavedPlan | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async (plan: SavedPlan) => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/training/saved-plans/${plan.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete template");
      }
      toast({ title: "Template deleted" });
      setPlanToDelete(null);
      await mutate();
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to delete template",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-[72px] rounded-[6px] bg-[rgba(13,148,136,0.04)] animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <div className="text-center py-20">
        <BookOpen className="w-10 h-10 text-[#93b0b4] mx-auto mb-4" strokeWidth={1.5} />
        <p className="text-[13px] text-[#5a7d82] leading-[1.5] max-w-sm mx-auto">
          No saved plans yet. Generate a plan with AI or build one manually, then save it to your library for reuse.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#5a7d82] mb-3">
        Your Library ({plans.length})
      </h3>
      {plans.map((plan) => (
        <div
          key={plan.id}
          className="group relative bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] hover:border-[rgba(13,148,136,0.25)] hover:shadow-[0_1px_4px_rgba(0,0,0,0.04)] transition-all"
        >
          <button
            onClick={() => builder.setSavedPlanId(plan.id)}
            className="w-full text-left px-4 py-3 pr-12"
          >
            <p className="text-[13.5px] font-semibold text-[#0c1a1e] truncate">
              {plan.name}
            </p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {plan.splitType && (
                <Badge
                  variant="outline"
                  className="text-[10.5px] px-1.5 py-0 h-[18px] border-[rgba(13,148,136,0.15)] text-[#5a7d82]"
                >
                  {plan.splitType}
                </Badge>
              )}
              <span className="text-[11.5px] text-[#93b0b4]">
                {plan.sessions.length} session{plan.sessions.length !== 1 && "s"}
              </span>
              {plan.cycleLength && (
                <span className="text-[11.5px] text-[#93b0b4]">
                  · {plan.cycleLength}-day cycle
                </span>
              )}
            </div>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setPlanToDelete(plan);
            }}
            className="absolute top-1/2 -translate-y-1/2 right-3 p-1.5 rounded-[4px] text-[#93b0b4] opacity-0 group-hover:opacity-100 hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060] transition-all focus:opacity-100"
            aria-label={`Delete ${plan.name}`}
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>
      ))}

      <ConfirmDialog
        open={!!planToDelete}
        onOpenChange={(open) => !open && setPlanToDelete(null)}
        title={`Delete "${planToDelete?.name ?? ""}"?`}
        description="This removes the template from your library. Clients who already have this plan applied keep their current schedule. This cannot be undone."
        confirmLabel={isDeleting ? "Deleting..." : "Delete"}
        destructive
        onConfirm={() => {
          if (planToDelete) void handleDelete(planToDelete);
        }}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Footer (Generate / Save button - hidden in saved-plans mode)
// ═══════════════════════════════════════════════════════════════════════════

function OverlayFooter() {
  const builder = useTrainingBuilderContext();
  const [showConfirm, setShowConfirm] = useState(false);
  const [showTemplateConfirm, setShowTemplateConfirm] = useState(false);

  if (builder.mode === "saved") return null;

  const isAiMode = builder.mode === "ai";
  const isScratchMode = builder.mode === "manual" && builder.manualMode === "scratch";
  const isGenerating = builder.isGenerating;
  const isSaving = builder.isSavingManual;
  const isSavingTemplate = builder.isSavingTemplate;
  const isBusy = isGenerating || isSaving || isSavingTemplate;
  const hasPlan = !!builder.plan;

  const planNameFilled = builder.planName.trim().length > 0;

  const isPrimaryDisabled =
    isBusy ||
    (isAiMode && !builder.prompt.trim()) ||
    (!isAiMode && builder.manualSessions.length === 0) ||
    // Scratch requires a plan name (template mode falls back to template name)
    (isScratchMode && !planNameFilled);

  const doPrimary = () => {
    if (isAiMode) {
      void builder.generate();
    } else {
      void builder.saveManualPlan();
    }
  };

  const handlePrimaryClick = () => {
    if (hasPlan) {
      setShowConfirm(true);
    } else {
      doPrimary();
    }
  };

  const primaryLabel = isGenerating
    ? "Generating..."
    : isSaving
      ? "Saving..."
      : isAiMode
        ? "Generate Plan"
        : "Add Exercises";

  const PrimaryIcon = isAiMode ? Sparkles : ArrowRight;

  return (
    <>
      <div className="flex-shrink-0 border-t border-[rgba(13,148,136,0.08)] bg-white px-6 py-4 flex items-center justify-end gap-3">
        {/* Secondary: Save as Template — only in scratch mode with at least one session */}
        {isScratchMode && builder.manualSessions.length > 0 && (
          <button
            onClick={() => setShowTemplateConfirm(true)}
            disabled={isBusy || !planNameFilled}
            className="inline-flex items-center gap-2 text-[#5a7d82] border border-[rgba(13,148,136,0.2)] text-[13px] font-medium rounded-[6px] px-4 py-2.5 transition-colors hover:bg-[rgba(13,148,136,0.04)] hover:text-[#0c1a1e] hover:border-[rgba(13,148,136,0.35)] disabled:opacity-50 disabled:pointer-events-none bg-white"
          >
            {isSavingTemplate ? (
              <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} />
            ) : (
              <Save className="w-4 h-4" strokeWidth={1.8} />
            )}
            Save as Template
          </button>
        )}

        {/* Primary action */}
        <button
          onClick={handlePrimaryClick}
          disabled={isPrimaryDisabled}
          className="inline-flex items-center gap-2 bg-[#0d9488] text-white text-[13.5px] font-semibold rounded-[6px] px-5 py-2.5 transition-all hover:-translate-y-px hover:shadow-[0_4px_16px_rgba(13,148,136,0.25)] hover:bg-gradient-to-br hover:from-[#0d9488] hover:to-[#0a7c72] disabled:opacity-50 disabled:pointer-events-none"
        >
          {isBusy && !isSavingTemplate ? (
            <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} />
          ) : (
            <PrimaryIcon className="w-4 h-4" strokeWidth={1.5} />
          )}
          {primaryLabel}
        </button>
      </div>

      <ConfirmDialog
        open={showConfirm}
        onOpenChange={setShowConfirm}
        title="Create new draft?"
        description="This will create a new draft in your library. Your current plan stays active until you apply the new one."
        confirmLabel="Continue"
        onConfirm={() => {
          setShowConfirm(false);
          doPrimary();
        }}
      />

      <ConfirmDialog
        open={showTemplateConfirm}
        onOpenChange={setShowTemplateConfirm}
        title="Save this structure to your library?"
        description="This saves the sessions as a reusable template (no exercises). You can add exercises later from Saved Plans."
        confirmLabel="Save as Template"
        onConfirm={() => {
          setShowTemplateConfirm(false);
          void builder.saveManualPlanAsTemplate();
        }}
      />
    </>
  );
}
