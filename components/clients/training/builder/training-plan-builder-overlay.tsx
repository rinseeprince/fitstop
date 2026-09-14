"use client";

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import { ProgramDraftProvider } from "@/components/clients/training/program-builder/program-draft-provider";
import { ProgramBuilder } from "@/components/clients/training/program-builder/program-builder";
import { ClientDraftLeaveGuard } from "./client-draft-leave-guard";
import { useSavedPlans } from "@/hooks/use-saved-plans";
import {
  LABEL_CLASS,
  MONO_LABEL_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { BookOpen, X, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { SavedPlan } from "@/types/training";

// The client-attached training drawer (Phase 5). From-scratch authoring
// (AI / Manual) is gone — authoring lives only in /dashboard/programs. This
// drawer is a library browser: pick a template, and it opens the SHARED
// Program builder in client-draft mode (full-screen) as a per-client editor.
// Apply materializes the edited copy onto the client's calendar; the library
// template is never mutated (see ProgramBuilder's client-draft branch).
//
// Both surfaces are the ADDRESS's (CONVENTIONS §7 → "No frame disagrees"):
// the tray is `?apply=1`, the editor `?editor=<savedPlanId>`. This component
// holds no state of its own about either and derives every frame from the two
// props, so nothing it draws can disagree with the address.
type TrainingPlanBuilderOverlayProps = {
  /** The tray (the library list) — the address's `?apply=1`. */
  trayOpen: boolean;
  /** The editor — the address's `?editor=<savedPlanId>`, a place of its own. */
  editorPlanId: string | null;
  /** The tray's X, Escape or outside click: the parent pops the tray's entry. */
  onCloseTray: () => void;
  /** A template picked in the tray: the parent replaces the tray's entry with the editor's. */
  onPick: (savedPlanId: string) => void;
  /** The editor's arrow: the parent replaces the editor's entry with the tray's. */
  onExitEditor: () => void;
  // Titles the client editor's library panel ("Editing for {name}") so it reads
  // as the client editor, not the generic /dashboard/programs builder.
  clientName?: string;
  // Fires once the plan has landed on the client's calendar. This component
  // reports the fact; the PARENT decides what happens next (Session 7.3's
  // return trip to the Journey block the coach came from).
  onApplied?: () => void;
  // That same block, preselected in the apply dialog's Block field. The parent
  // captured it on arrival — the URL is stripped of the trip in the same
  // effect — so it is threaded down rather than re-read.
  preselectedBlockId?: string | null;
};

export function TrainingPlanBuilderOverlay({
  trayOpen,
  editorPlanId,
  onCloseTray,
  onPick,
  onExitEditor,
  clientName,
  onApplied,
  preselectedBlockId,
}: TrainingPlanBuilderOverlayProps) {
  const builder = useTrainingBuilderContext();
  // The surface is open while either address is: the tray shows under no
  // editor, the editor over none. The library browser is a 920px right drawer;
  // the editor is full-screen (the 3-column builder needs the width).
  const fullScreen = editorPlanId != null;
  const isOpen = trayOpen || fullScreen;

  return (
    <DialogPrimitive.Root
      open={isOpen}
      // Editor mode is non-modal so the app's 52px nav rail stays clickable
      // (the ClientDraftLeaveGuard below confirms before dropping a dirty
      // draft). The library drawer stays modal (dim + trap + click-out close).
      modal={!fullScreen}
      // Only the tray can close this way: while the editor is open the outer
      // dialog's Escape / outside click are neutralized (the Content guards).
      onOpenChange={(next) => {
        if (!next) onCloseTray();
      }}
    >
      <DialogPrimitive.Portal>
        {/* Rendered by Radix under the modal tray alone — a non-modal Root
            mounts no overlay — so this is the tray's dim and nothing else. */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(15,32,39,0.35)] backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:duration-200 data-[state=closed]:duration-200" />
        {/* Two Content elements, keyed by the surface, never one restyled: a
            pick or the arrow REMOUNTS the Content, which is what restarts its
            enter animation, and a Back out of the editor mounts the tray's
            Content already closed, so no closing frame can show the list.
            Radix keeps a closing node mounted for its exit animation and
            re-renders it from live state, so an exit may only run where the
            content does not depend on what closes it: the tray's list (its
            slide-out, kept) — never the editor, whose content IS the address
            (no closed-state tokens; it closes in the same frame). */}
        {fullScreen ? (
          <DialogPrimitive.Content
            key="editor"
            className={cn(
              "fixed z-50 flex flex-col bg-[#f4f7f6] outline-none",
              // Full-screen minus the fixed 52px app icon strip (lg+ only; the
              // strip is hidden below lg) so the editor sits beside the nav rail
              // exactly like the /dashboard/programs builder.
              "inset-y-0 right-0 left-0 lg:left-[52px] data-[state=open]:animate-in data-[state=open]:duration-250 data-[state=open]:fade-in-0",
            )}
            // Two-close semantics while editing: exit-the-editor-back-to-the-list
            // (the builder's own back arrow, guarded by its confirm-leave) vs.
            // close-the-whole-overlay. Neutralize the outer dialog's Escape /
            // outside-click so a stray key or click can NEVER silently drop the
            // in-memory client draft — the coach leaves via the builder's back
            // arrow, which confirms when there are unsaved edits. (Nested dialogs
            // — the session editor, confirm, apply — still handle Escape first.)
            onEscapeKeyDown={(e) => e.preventDefault()}
            onPointerDownOutside={(e) => e.preventDefault()}
            onInteractOutside={(e) => e.preventDefault()}
          >
            <DialogPrimitive.Title className="sr-only">
              Edit training program for client
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Customize the program for this client, then apply it.
            </DialogPrimitive.Description>
            <ProgramDraftProvider
              // Keyed so switching templates fully resets the working tree (the
              // /dashboard/programs [savedPlanId] layout remount does this there;
              // the drawer has no such layout, so the key is load-bearing).
              key={editorPlanId}
              savedPlanId={editorPlanId}
              target="client-draft"
              clientId={builder.clientId}
              clientName={clientName}
              clientTimezone={builder.clientTimezone}
              preselectedBlockId={preselectedBlockId ?? undefined}
              onApplied={() => {
                // The plan landed on the client's calendar — refresh the
                // client's plan view; the parent completes the editor's entry
                // (not the back arrow, so the confirm-leave guard never fires;
                // there is nothing to discard once applied).
                void builder.fetchPlan();
                onApplied?.();
              }}
            >
              <ClientDraftLeaveGuard />
              <ProgramBuilder onExit={onExitEditor} />
            </ProgramDraftProvider>
          </DialogPrimitive.Content>
        ) : (
          <DialogPrimitive.Content
            key="tray"
            className="fixed inset-y-0 right-0 z-50 flex w-[920px] max-w-[100vw] flex-col bg-[#f4f7f6] shadow-[-8px_0_24px_rgba(15,32,39,0.12)] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:duration-250 data-[state=closed]:duration-200 data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right"
          >
            <DialogPrimitive.Title className="sr-only">Apply a program</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Browse your program library and apply a program to this client.
            </DialogPrimitive.Description>
            <LibraryHeader onClose={onCloseTray} />
            <div className="flex-1 min-h-0 overflow-y-auto px-7 py-6">
              <SavedPlansList onPick={onPick} />
            </div>
          </DialogPrimitive.Content>
        )}
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

function SavedPlansList({ onPick }: { onPick: (savedPlanId: string) => void }) {
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
      toast.success("Template deleted");
      setPlanToDelete(null);
      await mutate();
    } catch (error) {
      toast.error("Error", {
        description: error instanceof Error ? error.message : "Failed to delete template",
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
      <h3 className={cn(LABEL_CLASS, "mb-3")}>
        Your Library ({plans.length})
      </h3>
      {plans.map((plan) => (
        <div
          key={plan.id}
          className="group relative bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] hover:border-[rgba(13,148,136,0.25)] hover:shadow-[0_1px_4px_rgba(0,0,0,0.04)] transition-all"
        >
          <button
            onClick={() => onPick(plan.id)}
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
              <span className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal")}>
                {plan.sessions.length} session{plan.sessions.length !== 1 && "s"}
                {plan.programDurationWeeks ? ` · ${plan.programDurationWeeks} wk` : ""}
              </span>
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
