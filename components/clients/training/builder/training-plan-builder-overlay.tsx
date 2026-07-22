"use client";

import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import { ProgramDraftProvider } from "@/components/clients/training/program-builder/program-draft-provider";
import { ProgramBuilder } from "@/components/clients/training/program-builder/program-builder";
import { ClientDraftLeaveGuard } from "./client-draft-leave-guard";
import { useSavedPlans } from "@/hooks/use-saved-plans";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { BookOpen, X, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { SavedPlan } from "@/types/training";

// The client-attached training drawer (Phase 5). From-scratch authoring
// (AI / Manual) is gone — authoring lives only in /dashboard/programs. This
// drawer is a library browser: pick a template, and it opens the SHARED
// Program builder in client-draft mode (full-screen) as a per-client editor.
// Apply materializes the edited copy onto the client's calendar; the library
// template is never mutated (see ProgramBuilder's client-draft branch).
type TrainingPlanBuilderOverlayProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Titles the client editor's library panel ("Editing for {name}") so it reads
  // as the client editor, not the generic /dashboard/programs builder.
  clientName?: string;
};

export function TrainingPlanBuilderOverlay({
  open,
  onOpenChange,
  clientName,
}: TrainingPlanBuilderOverlayProps) {
  const builder = useTrainingBuilderContext();
  const hasDraft = !!builder.savedPlanId;
  const { setSavedPlanId } = builder;

  // Each fresh open starts at the library list. After an apply-and-close (or any
  // editor close) savedPlanId is deliberately LEFT set so the full-screen editor
  // fades out cleanly instead of morphing into the 920px drawer mid-exit; reset
  // it here on the next open so a stale editor never re-shows.
  useEffect(() => {
    if (open) setSavedPlanId(null);
  }, [open, setSavedPlanId]);

  const title = hasDraft ? "Edit training program for client" : "Apply a program";

  // The library browser is a 920px right drawer; opening a template for editing
  // expands to a full-screen surface (the 3-column builder needs the width).
  const backToLibrary = () => builder.setSavedPlanId(null);

  const handleClose = () => {
    // Closing the whole overlay from the library list. (While the editor is
    // open, the outer dialog's close is neutralized — see the Content guards —
    // so this only fires from the library browse state.)
    if (hasDraft) builder.setSavedPlanId(null);
    onOpenChange(false);
  };

  return (
    <DialogPrimitive.Root
      open={open}
      // Editor mode is non-modal so the app's 52px nav rail stays clickable
      // (the ClientDraftLeaveGuard below confirms before dropping a dirty
      // draft). The library drawer stays modal (dim + trap + click-out close).
      modal={!hasDraft}
      onOpenChange={(next) => (next ? onOpenChange(true) : handleClose())}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:duration-200 data-[state=closed]:duration-200",
            // Editor mode keeps the app's 52px nav rail visible (matching the
            // /dashboard/programs builder) — no dim/blur, and pointer-events-none
            // so the transparent overlay doesn't swallow clicks to the rail. The
            // library drawer keeps the normal modal backdrop.
            hasDraft ? "pointer-events-none" : "bg-[rgba(15,32,39,0.35)] backdrop-blur-[2px]",
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed z-50 flex flex-col bg-[#f4f7f6] outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:duration-250 data-[state=closed]:duration-200",
            hasDraft
              // Full-screen minus the fixed 52px app icon strip (lg+ only; the
              // strip is hidden below lg) so the editor sits beside the nav rail
              // exactly like the /dashboard/programs builder.
              ? "inset-y-0 right-0 left-0 lg:left-[52px] data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0"
              : "inset-y-0 right-0 w-[920px] max-w-[100vw] shadow-[-8px_0_24px_rgba(15,32,39,0.12)] data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
          )}
          // Two-close semantics while editing: exit-the-editor-back-to-the-list
          // (the builder's own back arrow, guarded by its confirm-leave) vs.
          // close-the-whole-overlay. Neutralize the outer dialog's Escape /
          // outside-click so a stray key or click can NEVER silently drop the
          // in-memory client draft — the coach leaves via the builder's back
          // arrow, which confirms when there are unsaved edits. (Nested dialogs
          // — the session editor, confirm, apply — still handle Escape first.)
          onEscapeKeyDown={hasDraft ? (e) => e.preventDefault() : undefined}
          onPointerDownOutside={hasDraft ? (e) => e.preventDefault() : undefined}
          onInteractOutside={hasDraft ? (e) => e.preventDefault() : undefined}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Browse your program library and apply a program to this client.
          </DialogPrimitive.Description>

          {hasDraft ? (
            <ProgramDraftProvider
              // Keyed so switching templates fully resets the working tree (the
              // /dashboard/programs [savedPlanId] layout remount does this there;
              // the drawer has no such layout, so the key is load-bearing).
              key={builder.savedPlanId}
              savedPlanId={builder.savedPlanId!}
              target="client-draft"
              clientId={builder.clientId}
              clientName={clientName}
              onApplied={() => {
                // The plan landed on the client's calendar — refresh the
                // client's plan view and return to it by CLOSING the drawer
                // (not the back arrow, so the confirm-leave guard never fires;
                // there is nothing to discard once applied). savedPlanId stays
                // set for a clean editor fade-out — the open-effect above resets
                // it on the next open.
                void builder.fetchPlan();
                onOpenChange(false);
              }}
            >
              <ClientDraftLeaveGuard />
              <ProgramBuilder onExit={backToLibrary} />
            </ProgramDraftProvider>
          ) : (
            <>
              <LibraryHeader onClose={handleClose} />
              <div className="flex-1 min-h-0 overflow-y-auto px-7 py-6">
                <SavedPlansList />
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Library header (browse state only — the editor owns its own chrome)
// ═══════════════════════════════════════════════════════════════════════════

function LibraryHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="bg-[#0f2027] px-6 py-4 flex-shrink-0 flex items-center gap-4">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="w-[36px] h-[36px] rounded-[6px] bg-[rgba(13,148,136,0.15)] flex items-center justify-center flex-shrink-0">
          <BookOpen className="w-[18px] h-[18px] text-[#0d9488]" strokeWidth={1.5} />
        </div>
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold text-white leading-tight truncate">
            Apply a program
          </h2>
          <p className="text-[12px] text-[rgba(255,255,255,0.5)] mt-0.5 leading-[1.4] truncate">
            Pick a program from your library, customize it for this client, then apply it.
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
// Saved plans list (the library browse — click a plan to open the editor)
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
          No saved programs yet. Build one in the Programs section, then apply it to your clients from here.
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
              {plan.programDurationWeeks && (
                <span className="text-[11.5px] text-[#93b0b4]">
                  · {plan.programDurationWeeks} wk
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
