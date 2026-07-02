"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Ban, Loader2, Pencil, Save, Trash2 } from "lucide-react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { useToast } from "@/hooks/use-toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { cn } from "@/lib/utils";
import type { SavedSession } from "@/types/training";
import type { DaySlotDraft } from "./program-builder-types";
import { savedSessionToDraft } from "./program-builder-serialize";
import { findSession } from "./use-program-builder-state";
import { useProgramDnd } from "./use-program-dnd";
import { useSaveDayAsWorkout } from "./use-save-day-as-workout";
import { useProgramDraft } from "./program-draft-provider";
import { ProgramTopBar } from "./program-top-bar";
import { ProgramGrid } from "./program-grid";
import { SessionEditorSheet } from "./session-editor-sheet";
import { SessionLibraryDrawer } from "./session-library-drawer";
import { AddSessionPopover, type AddSessionTarget } from "./add-session-popover";
import {
  CHIP_NEUTRAL_CLASS,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TRAINING_CARD_BORDER,
} from "./builder-tokens";

// Orchestrator for the full-page Program builder. Draft state, mode, and the
// save pipeline live in ProgramDraftProvider (the [savedPlanId] layout) so the
// create-session slide-over — a sibling @modal route — mutates the same tree.
// This component owns only view state: collapse, the open editor, the
// add-session popover, and the confirm dialogs. NO assign-to-client lives on
// this surface (Phase 5: assignment happens in the client's planner).
export type ProgramBuilderProps = {
  // Phase 5 seam — the client-draft remount overrides where "back" goes.
  onExit?: () => void;
};

export function ProgramBuilder({ onExit }: ProgramBuilderProps) {
  const router = useRouter();
  const { toast } = useToast();
  const {
    savedPlanId,
    plan,
    isPlanLoading,
    draft,
    isDirty,
    mode,
    setMode,
    isSaving,
    saveProgram,
    discardChanges,
    setName,
    setDefaultSurplus,
    addWeek,
    duplicateWeek,
    deleteWeek,
    reorderWeek,
    placeSession,
    clearSlot,
    moveSession,
    updateSession,
    addExercise,
    removeExercise,
    updateExercise,
    reorderExercise,
    editSetSpec,
  } = useProgramDraft();

  const [collapsedWeeks, setCollapsedWeeks] = useState<Set<string>>(new Set());
  const [editingSessionUid, setEditingSessionUid] = useState<string | null>(null);
  const [addTarget, setAddTarget] = useState<AddSessionTarget | null>(null);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const [confirmDiscardChangesOpen, setConfirmDiscardChangesOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const placeLibrarySession = (session: SavedSession, slotUid: string) => {
    // Clone-by-value with fresh uids; occupied slots no-op (locked one
    // session per day-cell — collision already filters them out).
    placeSession(slotUid, savedSessionToDraft(session));
  };

  const dnd = useProgramDnd({ draft, reorderWeek, moveSession, placeLibrarySession });
  const { isSavingWorkout, saveDayAsWorkout } = useSaveDayAsWorkout(draft);

  const exit = () => (onExit ? onExit() : router.push("/dashboard/programs"));

  const deletePlan = async (successTitle: string) => {
    try {
      const res = await fetch(`/api/training/saved-plans/${savedPlanId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast({ title: successTitle });
      exit();
    } catch {
      toast({
        title: "Error",
        description: "Failed to delete program",
        variant: "destructive",
      });
    }
  };

  if (isPlanLoading || (!draft && plan)) {
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

  const trainingCount = draft.weeks.reduce(
    (sum, w) => sum + w.days.filter((d) => !d.isRest).length,
    0,
  );

  const requestAddSession = (slot: DaySlotDraft, anchorEl: HTMLElement) => {
    const weekIndex = draft.weeks.findIndex((week) =>
      week.days.some((s) => s.uid === slot.uid),
    );
    if (weekIndex < 0) return;
    setAddTarget({ slotUid: slot.uid, weekIndex, dayIndex: slot.orderIndex, anchorEl });
  };

  return (
    <div>
      <ProgramTopBar
        draft={draft}
        mode={mode}
        onBack={() => {
          if (isDirty && mode === "edit") setConfirmLeaveOpen(true);
          else exit();
        }}
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
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <SectionLabel
              label="Schedule"
              meta={`${draft.weeks.length} ${draft.weeks.length === 1 ? "week" : "weeks"} · ${trainingCount} ${trainingCount === 1 ? "session" : "sessions"}`}
              actions={
                // Roadmap-divider pattern: ALL program actions live on the
                // rule, not in the hero band — icons for edit/delete, small
                // uppercase text for the edit-mode commit actions.
                <div className="flex items-center gap-3">
                  {mode === "view" && (
                    <button
                      type="button"
                      aria-label="Edit program"
                      title="Edit program"
                      className="rounded p-1 text-[#93b0b4] transition-colors hover:text-[#0d9488]"
                      onClick={() => setMode("edit")}
                    >
                      <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="Delete program"
                    title="Delete program"
                    disabled={isSaving}
                    className="rounded p-1 text-[#93b0b4] transition-colors hover:text-[#c06060] disabled:opacity-50"
                    onClick={() => setConfirmDeleteOpen(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                  {mode === "edit" && (
                    <>
                      {draft.status === "draft" ? (
                        <button
                          type="button"
                          aria-label="Discard draft"
                          title="Discard draft"
                          disabled={isSaving}
                          className="rounded p-1 text-[#93b0b4] transition-colors hover:text-[#c06060] disabled:opacity-50"
                          onClick={() => setConfirmDiscardOpen(true)}
                        >
                          <Ban className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          aria-label="Discard changes"
                          title="Discard changes"
                          disabled={isSaving || !isDirty}
                          className="rounded p-1 text-[#93b0b4] transition-colors hover:text-[#c06060] disabled:opacity-50"
                          onClick={() => setConfirmDiscardChangesOpen(true)}
                        >
                          <Ban className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label="Save program"
                        title="Save program"
                        disabled={isSaving}
                        className="rounded p-1 text-[#0d9488] transition-colors hover:text-[#0b7f75] disabled:opacity-50"
                        onClick={() => void saveProgram()}
                      >
                        {isSaving ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
                        )}
                      </button>
                    </>
                  )}
                </div>
              }
            />
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
              onRequestAddSession={requestAddSession}
              onClearSlot={clearSlot}
            />
          </div>

          <SessionLibraryDrawer mode={mode} />
        </div>

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
              ) : dnd.activeDrag?.type === "library-session" ? (
                <div className={cn("rounded-[6px] bg-white px-3 py-2 shadow-lg", TRAINING_CARD_BORDER)}>
                  <div className={cn("text-xs font-semibold", TEXT_PRIMARY)}>
                    {dnd.activeDrag.session.name}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    {dnd.activeDrag.session.focus && (
                      <span className={CHIP_NEUTRAL_CLASS}>
                        {dnd.activeDrag.session.focus}
                      </span>
                    )}
                    <span className={cn("text-[10px]", TEXT_SECONDARY)}>
                      {dnd.activeDrag.session.exercises.length} exercises
                    </span>
                  </div>
                </div>
              ) : null}
            </DragOverlay>,
            document.body,
          )}
      </DndContext>

      <SessionEditorSheet
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
        onSaveAsWorkout={(uid) => void saveDayAsWorkout(uid)}
        isSavingWorkout={isSavingWorkout}
      />

      <AddSessionPopover
        target={mode === "edit" ? addTarget : null}
        onClose={() => setAddTarget(null)}
        onPickSession={(target, session) => {
          placeSession(target.slotUid, savedSessionToDraft(session));
          setAddTarget(null);
        }}
        onCreateBlank={(target) => {
          setAddTarget(null);
          router.push(
            `/dashboard/programs/${savedPlanId}/sessions/new?w=${target.weekIndex}&d=${target.dayIndex}`,
          );
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
        onConfirm={() => void deletePlan("Draft discarded")}
      />
      <ConfirmDialog
        open={confirmDiscardChangesOpen}
        onOpenChange={setConfirmDiscardChangesOpen}
        title="Discard unsaved changes?"
        description="The program goes back to its last saved state."
        confirmLabel="Discard changes"
        destructive
        onConfirm={discardChanges}
      />
      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Delete this program?"
        description="The program and everything in it will be permanently removed from your library. Clients it was already applied to keep their calendars."
        confirmLabel="Delete program"
        destructive
        onConfirm={() => void deletePlan("Program deleted")}
      />
    </div>
  );
}
