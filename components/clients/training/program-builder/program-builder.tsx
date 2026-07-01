"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { useToast } from "@/hooks/use-toast";
import { useSavedPlan } from "@/hooks/use-saved-plan";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import type { BuilderTarget, ProgramDraft } from "./program-builder-types";
import { savedPlanToDraft } from "./program-builder-serialize";
import { findSession, useProgramBuilderState } from "./use-program-builder-state";
import { useSetSpecMutations } from "./use-set-spec-mutations";
import { useProgramDnd } from "./use-program-dnd";
import { useProgramSave } from "./use-program-save";
import { ProgramTopBar } from "./program-top-bar";
import { ProgramGrid } from "./program-grid";
import { SessionEditorModal } from "./session-editor-modal";
import { TEXT_PRIMARY, TEXT_SECONDARY, TRAINING_CARD_BORDER } from "./builder-tokens";

// Orchestrator for the full-page Program builder. `target` exists from day
// one so Phase 5 can remount this as the client-draft editor: 'library' wires
// onCommit to the overwrite save below; 'client-draft' will route the draft
// through `onApply` instead. NO assign-to-client lives on this surface.
export type ProgramBuilderProps = {
  savedPlanId: string;
  target: BuilderTarget;
  // Phase 5 seam — unused while target === 'library'.
  onApply?: (draft: ProgramDraft) => void;
  onExit?: () => void;
};

export function ProgramBuilder({ savedPlanId, target, onExit }: ProgramBuilderProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { plan, isLoading, mutate } = useSavedPlan(savedPlanId);
  const {
    draft, isDirty, seed, getRevision, markSaved,
    setName, setDefaultSurplus,
    addWeek, duplicateWeek, deleteWeek, reorderWeek,
    addSessionToSlot, clearSlot, moveSession,
    updateSession, addExercise, removeExercise, updateExercise, reorderExercise,
  } = useProgramBuilderState();

  const [mode, setMode] = useState<"view" | "edit">("view");
  const [collapsedWeeks, setCollapsedWeeks] = useState<Set<string>>(new Set());
  const [editingSessionUid, setEditingSessionUid] = useState<string | null>(null);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

  const { isSaving, save } = useProgramSave({ savedPlanId, plan, mutatePlan: mutate });
  const editSetSpec = useSetSpecMutations(updateExercise);
  const dnd = useProgramDnd({ draft, reorderWeek, moveSession });

  // Seed the working tree from server state exactly once (the !draft gate
  // makes SWR refreshes no-ops). Cross-plan cleanup is the parent's
  // key={savedPlanId} remount. New drafts open straight into edit mode and
  // stay there until Save program.
  useEffect(() => {
    if (plan && !draft) {
      seed(savedPlanToDraft(plan));
      if (plan.status === "draft") setMode("edit");
    }
  }, [plan, draft, seed]);

  // Refresh/close guard while there are unsaved edits. (In-app sidebar nav
  // isn't interceptable in the App Router — only this and the back link are
  // guarded, same exposure as the existing drawer.)
  useEffect(() => {
    if (!(isDirty && mode === "edit")) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty, mode]);

  const exit = () => (onExit ? onExit() : router.push("/dashboard/programs"));

  const handleSave = async () => {
    if (!draft || target !== "library") return;
    // Snapshot the mutation counter: the grid stays interactive while the
    // save is in flight, and an edit landing mid-save must NOT be marked
    // clean (it was never serialized — clearing dirty would silently lose it).
    const revision = getRevision();
    const result = await save(draft);
    if (result === "saved") {
      const clean = markSaved(revision);
      if (clean) {
        setMode("view");
      } else {
        toast({
          title: "You made edits while saving",
          description: "Save again to include them.",
        });
      }
    }
    // "kept-draft" / "error": stay in edit mode with the draft intact.
  };

  const handleDiscardDraft = async () => {
    try {
      const res = await fetch(`/api/training/saved-plans/${savedPlanId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast({ title: "Draft discarded" });
      exit();
    } catch {
      toast({ title: "Error", description: "Failed to discard draft", variant: "destructive" });
    }
  };

  if (isLoading || (!draft && plan)) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-[#93b0b4]" />
      </div>
    );
  }
  if (!plan || !draft) {
    return (
      <div className={cn("py-24 text-center text-sm", TEXT_SECONDARY)}>
        Program not found.
      </div>
    );
  }

  const editingSession = findSession(draft, editingSessionUid);
  const editingSlotUid =
    draft.weeks
      .flatMap((w) => w.days)
      .find((s) => s.session?.uid === editingSessionUid)?.uid ?? null;

  return (
    <div>
      <ProgramTopBar
        draft={draft}
        mode={mode}
        isSaving={isSaving}
        onBack={() => {
          if (isDirty && mode === "edit") setConfirmLeaveOpen(true);
          else exit();
        }}
        onEdit={() => setMode("edit")}
        onSave={() => void handleSave()}
        onDiscardDraft={() => setConfirmDiscardOpen(true)}
        onRename={setName}
        onDefaultSurplusChange={setDefaultSurplus}
      />

      <DndContext
        sensors={dnd.sensors}
        collisionDetection={dnd.collisionDetection}
        onDragStart={dnd.handleDragStart}
        onDragEnd={dnd.handleDragEnd}
        onDragCancel={dnd.handleDragCancel}
      >
        <ProgramGrid
          draft={draft}
          mode={mode}
          collapsedWeeks={collapsedWeeks}
          onToggleCollapse={(weekUid) =>
            setCollapsedWeeks((prev) => {
              const next = new Set(prev);
              if (next.has(weekUid)) next.delete(weekUid);
              else next.add(weekUid);
              return next;
            })
          }
          onDuplicateWeek={duplicateWeek}
          onDeleteWeek={deleteWeek}
          onAddWeek={addWeek}
          onOpenSession={setEditingSessionUid}
          onAddSession={addSessionToSlot}
          onClearSlot={clearSlot}
        />

        {/* DragOverlay portaled to <body>: proven pattern from draft-editor —
            an animated/transformed ancestor would become the containing block
            for the overlay's fixed positioning and offset the drag preview. */}
        {typeof document !== "undefined" &&
          createPortal(
            <DragOverlay dropAnimation={null}>
              {dnd.activeDrag?.type === "week" ? (
                <div className={cn("rounded-[6px] bg-white px-3 py-2 text-sm font-semibold shadow-lg", TRAINING_CARD_BORDER, TEXT_PRIMARY)}>
                  Week {dnd.activeDrag.week.weekIndex + 1}
                </div>
              ) : dnd.activeDrag?.type === "session" ? (
                <div className={cn("rounded-[6px] bg-white px-3 py-2 shadow-lg", TRAINING_CARD_BORDER)}>
                  <div className={cn("text-xs font-semibold", TEXT_PRIMARY)}>
                    {dnd.activeDrag.session.name}
                  </div>
                  <div className={cn("text-[10px]", TEXT_SECONDARY)}>
                    {dnd.activeDrag.session.exercises.length} exercises
                  </div>
                </div>
              ) : null}
            </DragOverlay>,
            document.body,
          )}
      </DndContext>

      <SessionEditorModal
        session={editingSession}
        mode={mode}
        defaultSurplusPercentage={draft.defaultSurplusPercentage}
        onClose={() => setEditingSessionUid(null)}
        onUpdateSession={updateSession}
        onAddExercise={addExercise}
        onRemoveExercise={removeExercise}
        onEditExercise={updateExercise}
        onReorderExercise={reorderExercise}
        onSpecEdit={editSetSpec}
        onClearToRest={() => {
          if (editingSlotUid) clearSlot(editingSlotUid);
        }}
      />

      <ConfirmDialog
        open={confirmLeaveOpen}
        onOpenChange={setConfirmLeaveOpen}
        title="Discard unsaved changes?"
        description="You have edits that haven't been saved to the library yet. Leaving now will lose them."
        confirmLabel="Leave without saving"
        destructive
        onConfirm={exit}
      />
      <ConfirmDialog
        open={confirmDiscardOpen}
        onOpenChange={setConfirmDiscardOpen}
        title="Discard this draft?"
        description="The draft program and everything in it will be permanently deleted."
        confirmLabel="Discard draft"
        destructive
        onConfirm={() => void handleDiscardDraft()}
      />
    </div>
  );
}
