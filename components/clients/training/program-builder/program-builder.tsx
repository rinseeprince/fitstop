"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Ban, Loader2, Pencil, Save, Trash2 } from "lucide-react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { useToast } from "@/hooks/use-toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ApplyToClientDialog } from "@/components/training-library/apply-to-client-dialog";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { cn } from "@/lib/utils";
import type { Exercise, SavedSession } from "@/types/training";
import {
  MAX_WEEKS,
  newUid,
  type DaySlotDraft,
  type SessionDraft,
} from "./program-builder-types";
import { savedSessionToDraft } from "./program-builder-serialize";
import { defaultExerciseDraftFromCatalog, findSession } from "./program-builder-model";
import { useProgramDnd } from "./use-program-dnd";
import { useSaveDayAsWorkout } from "./use-save-day-as-workout";
import { useProgramDraft } from "./program-draft-provider";
import { useClientApply } from "./use-client-apply";
import { ProgramTopBar } from "./program-top-bar";
import { ProgramGrid } from "./program-grid";
import { DuplicateWeekDialog } from "./duplicate-week-dialog";
import { SessionEditorSheet } from "./session-editor-sheet";
import { BuilderLibraryPanel } from "./builder-library-panel";
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
    target,
    clientId,
    clientName,
    onApplied,
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
    insertWeekAfter,
  } = useProgramDraft();

  // Client-draft mode (Phase 5): the shared builder mounted inside the coach's
  // client drawer as a per-client editor. The library chrome (Save/Delete to
  // the template, the /dashboard/programs create-blank route, the "All
  // programs" link) is swapped for an Apply-to-client flow; the template is
  // never mutated — Apply materializes the edited copy onto the client's
  // calendar.
  const isClientDraft = target === "client-draft";
  const apply = useClientApply({ draft, isDirty, clientId, plan });

  const [collapsedWeeks, setCollapsedWeeks] = useState<Set<string>>(new Set());
  const [editingSessionUid, setEditingSessionUid] = useState<string | null>(null);
  // The uid only — the week resolves live at render, so a vanished uid or a
  // mode flip closes the progression dialog by unmounting it.
  const [progressionWeekUid, setProgressionWeekUid] = useState<string | null>(null);
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

  const placeLibraryExercise = (exercise: Exercise, slotUid: string) => {
    // Append a catalog exercise to the slot's existing session. Collision
    // already restricts library-exercise drops to OCCUPIED cells; the session
    // lookup is the belt (a rest slot has no session to append to).
    const session = draft?.weeks
      .flatMap((w) => w.days)
      .find((s) => s.uid === slotUid)?.session;
    if (!session) return;
    addExercise(
      session.uid,
      defaultExerciseDraftFromCatalog({
        name: exercise.name,
        exerciseId: exercise.id,
      }),
    );
  };

  const dnd = useProgramDnd({
    draft,
    reorderWeek,
    moveSession,
    placeLibrarySession,
    placeLibraryExercise,
  });
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
  const progressionWeek =
    mode === "edit"
      ? (draft.weeks.find((w) => w.uid === progressionWeekUid) ?? null)
      : null;

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
    // Library: full-bleed within the programs shell — cancel its px-8/py
    // padding so the library panel sits flush against the icon rail and the
    // grid fills main's 100vh box (`h-screen`; the section topbar hides on this
    // route). Client-draft: the host is a full-screen drawer dialog with no
    // shell padding to cancel, so fill its own box (`h-full`).
    <div
      className={cn(
        "flex flex-col",
        isClientDraft ? "h-full" : "-mx-8 -mt-5 -mb-[60px] h-screen",
      )}
    >
      <DndContext
        sensors={dnd.sensors}
        collisionDetection={dnd.collisionDetection}
        onDragStart={dnd.handleDragStart}
        onDragEnd={dnd.handleDragEnd}
        onDragCancel={dnd.handleDragCancel}
      >
        <div className="flex min-h-0 flex-1">
          <BuilderLibraryPanel
            mode={mode}
            showBackLink={!isClientDraft}
            clientName={clientName ?? undefined}
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col px-6 pt-5">
            <ProgramTopBar
              draft={draft}
              mode={mode}
              onBack={() => {
                if (isDirty && mode === "edit") setConfirmLeaveOpen(true);
                else exit();
              }}
              backLabel={isClientDraft ? "Back to library" : "Back to programs"}
              onRename={setName}
              onDefaultSurplusChange={setDefaultSurplus}
            />
            <SectionLabel
              label="Schedule"
              meta={`${draft.weeks.length} ${draft.weeks.length === 1 ? "week" : "weeks"} · ${trainingCount} ${trainingCount === 1 ? "session" : "sessions"}`}
              actions={
                // Roadmap-divider pattern: ALL program actions live on the
                // rule, not in the hero band — icons for edit/delete, small
                // uppercase text for the edit-mode commit actions. Client-draft
                // swaps the library commit (Save/Delete to the template) for an
                // Apply-to-client button; the template is never mutated here.
                <div className="flex items-center gap-3">
                  {isClientDraft && (
                    <button
                      type="button"
                      className="rounded-[6px] bg-[#0d9488] px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[#0b7f75] disabled:opacity-50"
                      disabled={!apply.canApply}
                      onClick={apply.requestApply}
                    >
                      Apply to client
                    </button>
                  )}
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
                  {!isClientDraft && (
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
                  )}
                  {mode === "edit" && (
                    <>
                      {/* Draft-discard (delete) is library-only; a client-draft
                          is always a saved template, so it only ever shows the
                          revert-my-edits Discard-changes control. */}
                      {!isClientDraft && draft.status === "draft" ? (
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
                      {!isClientDraft && (
                        <button
                          type="button"
                          aria-label="Save program"
                          title="Save program"
                          disabled={isSaving}
                          className="rounded p-1 text-[#0d9488] transition-colors hover:text-[#0b7f75] disabled:opacity-50"
                          onClick={async () => {
                            // A clean save returns to the programs list; a
                            // 409/error keeps the coach in the builder to retry.
                            if ((await saveProgram()) === "saved") exit();
                          }}
                        >
                          {isSaving ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
                          )}
                        </button>
                      )}
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
              onDuplicateWeekWithProgression={setProgressionWeekUid}
              onDeleteWeek={deleteWeek}
              onAddWeek={addWeek}
              onOpenSession={setEditingSessionUid}
              onRequestAddSession={requestAddSession}
              onClearSlot={clearSlot}
            />
          </div>
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
              ) : dnd.activeDrag?.type === "library-exercise" ? (
                <div className={cn("rounded-[6px] bg-white px-3 py-2 shadow-lg", TRAINING_CARD_BORDER)}>
                  <div className={cn("text-xs font-semibold", TEXT_PRIMARY)}>
                    {dnd.activeDrag.exercise.name}
                  </div>
                  {dnd.activeDrag.exercise.muscleGroup && (
                    <div className={cn("mt-0.5 text-[10px] capitalize", TEXT_SECONDARY)}>
                      {dnd.activeDrag.exercise.muscleGroup}
                    </div>
                  )}
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
        onSaveAsWorkout={(uid) => void saveDayAsWorkout(uid)}
        isSavingWorkout={isSavingWorkout}
      />

      {/* Conditional mount: an always-mounted dialog would fetch the exercise
          catalog on every builder render and leak closed-state preview
          content into count-sensitive queries. */}
      {progressionWeek && (
        <DuplicateWeekDialog
          week={progressionWeek}
          canAddWeek={draft.weeks.length < MAX_WEEKS}
          onCommit={(newWeek) => {
            insertWeekAfter(progressionWeek.uid, newWeek);
            setProgressionWeekUid(null);
          }}
          onClose={() => setProgressionWeekUid(null)}
        />
      )}

      <AddSessionPopover
        target={mode === "edit" ? addTarget : null}
        onClose={() => setAddTarget(null)}
        onPickSession={(target, session) => {
          placeSession(target.slotUid, savedSessionToDraft(session));
          setAddTarget(null);
        }}
        onCreateBlank={(t) => {
          setAddTarget(null);
          if (isClientDraft) {
            // No intercepted /dashboard/programs modal route exists in the
            // client drawer — build the blank session in-memory (uid held here,
            // so we can open it) and place it. Library create-blank persists a
            // standalone session; a client draft's stays in-memory, which is
            // correct for a per-client edit.
            const blank: SessionDraft = {
              uid: newUid("sess"),
              name: `Day ${t.dayIndex + 1}`,
              focus: null,
              estimatedDurationMinutes: null,
              calorieSurplusPercentage: null,
              notes: null,
              sessionType: "training",
              exercises: [],
            };
            placeSession(t.slotUid, blank);
            setEditingSessionUid(blank.uid);
            return;
          }
          router.push(
            `/dashboard/programs/${savedPlanId}/sessions/new?w=${t.weekIndex}&d=${t.dayIndex}`,
          );
        }}
      />

      <ConfirmDialog
        open={confirmLeaveOpen}
        onOpenChange={setConfirmLeaveOpen}
        title="Discard unsaved changes?"
        description={
          isClientDraft
            ? "You have unsaved edits for this client. Leaving now will discard them."
            : "You have edits that haven't been saved to the library yet. Leaving now will lose them."
        }
        confirmLabel={isClientDraft ? "Leave without applying" : "Leave without saving"}
        destructive
        onConfirm={exit}
      />
      {!isClientDraft && (
        <ConfirmDialog
          open={confirmDiscardOpen}
          onOpenChange={setConfirmDiscardOpen}
          title="Discard this draft?"
          description="The draft program and everything in it will be permanently deleted."
          confirmLabel="Discard draft"
          destructive
          onConfirm={() => void deletePlan("Draft discarded")}
        />
      )}
      <ConfirmDialog
        open={confirmDiscardChangesOpen}
        onOpenChange={setConfirmDiscardChangesOpen}
        title="Discard unsaved changes?"
        description={
          isClientDraft
            ? "Your edits for this client will be discarded and the program reset to the library version."
            : "The program goes back to its last saved state."
        }
        confirmLabel="Discard changes"
        destructive
        onConfirm={discardChanges}
      />
      {!isClientDraft && (
        <ConfirmDialog
          open={confirmDeleteOpen}
          onOpenChange={setConfirmDeleteOpen}
          title="Delete this program?"
          description="The program and everything in it will be permanently removed from your library. Clients it was already applied to keep their calendars."
          confirmLabel="Delete program"
          destructive
          onConfirm={() => void deletePlan("Program deleted")}
        />
      )}

      {/* Client-draft apply flow (Phase 5): a reapply confirmation → the shared
          ApplyToClientDialog. The library template is never touched — Apply
          materializes the edited copy onto the client's calendar. The confirm
          precedes the dialog (start date/repeat are chosen inside it), so its
          copy stays date-agnostic. */}
      {isClientDraft && plan && (
        <>
          <ConfirmDialog
            open={apply.confirmOpen}
            onOpenChange={apply.setConfirmOpen}
            title="Apply this program to your client?"
            description="This adds another program to the client's calendar and may overlap existing sessions."
            confirmLabel="Continue"
            onConfirm={apply.confirmApply}
          />
          <ApplyToClientDialog
            open={apply.dialogOpen}
            onOpenChange={apply.setDialogOpen}
            savedPlan={plan}
            inlinePlan={apply.inlinePlan}
            preselectedClientId={clientId ?? undefined}
            onSuccess={() => onApplied?.()}
          />
        </>
      )}
    </div>
  );
}
