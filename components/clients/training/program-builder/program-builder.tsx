"use client";

import type { WindowCap } from "@/services/program-event-walk";
import { addDaysToDateString, formatDateOnlyShort } from "@/lib/date-helpers";
import { useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { leaveCoachPage } from "@/lib/coach-history";
import { useDialogSubject } from "@/hooks/use-dialog-subject";
import { Ban, Loader2, Pencil, Save, Trash2 } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ApplyToClientDialog } from "@/components/training-library/apply-to-client-dialog";
import { NotificationsDropdown } from "@/components/navbar/notifications-dropdown";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { cn } from "@/lib/utils";
import type { Exercise, SavedSession } from "@/types/training";
import {
  newUid,
  type DaySlotDraft,
  type SessionDraft,
} from "./program-builder-types";
import { savedSessionToDraft } from "./program-builder-serialize";
import {
  defaultExerciseDraftFromCatalog,
  findSession,
  findSlot,
  weekSessions,
} from "./program-builder-model";
import { isSessionLocked } from "./program-builder-lock-model";
import { PlanEditConfirmDialog, PlanEditStaleDialog } from "./plan-edit-dialogs";
import { useProgramDnd } from "./use-program-dnd";
import { useSaveDayAsWorkout } from "./use-save-day-as-workout";
import { useProgramDraft } from "./program-draft-provider";
import { AssistantDock } from "./assistant/assistant-dock";
import { createSessionHref, isCreateSessionPath } from "./create-session-route";
import { StandaloneSessionEditor } from "@/components/programs/standalone-session-editor";
import type { SessionEditorState } from "@/components/programs/use-standalone-session-editor";
import { useClientApply } from "./use-client-apply";
import { ProgramTopBar } from "./program-top-bar";
import { ProgramGrid } from "./program-grid";
import { SessionEditorSheet } from "./session-editor-sheet";
import { BuilderLibraryPanel } from "./builder-library-panel";
import {
  AddSessionPopover,
  type AddSessionAnchor,
  type AddSessionTarget,
} from "./add-session-popover";
import {
  CHIP_NEUTRAL_CLASS,
  MONO,
  MONO_LABEL_CLASS,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TRAINING_CARD_BORDER,
} from "./builder-tokens";
import { countSessionExercises } from "@/utils/exercise-groups";

// Orchestrator for the full-page Program builder. Draft state, mode, and the
// save pipeline live in ProgramDraftProvider (the [savedPlanId] layout) so the
// create-session slide-over — a sibling @modal route — mutates the same tree.
// This component owns only view state: collapse, the open editor, the
// add-session popover, and the confirm dialogs. NO assign-to-client lives on
// this surface (Phase 5: assignment happens in the client's planner).
type ProgramBuilderProps = {
  // Phase 5 seam — the client-draft remount overrides where "back" goes.
  onExit?: () => void;
};

/** The plan editor's one line on why days past the plan's limit are greyed. */
function limitNotice(limit: WindowCap): string {
  const dayAfter = formatDateOnlyShort(addDaysToDateString(limit.endsOn, 1));
  switch (limit.source) {
    case "block":
      return `This block ends ${formatDateOnlyShort(limit.endsOn)}. Days after it are greyed out.`;
    case "next_block":
      return `The next block starts ${dayAfter}. Days from then are greyed out.`;
    case "next_plan":
      return `The next program starts ${dayAfter}. Days from then are greyed out.`;
  }
}

export function ProgramBuilder({ onExit }: ProgramBuilderProps) {
  const router = useRouter();
  // Read above the early returns (a hook): the create-session slide-over is open
  // exactly while this is its address (create-session-route.ts).
  const pathname = usePathname();
  const {
    savedPlanId,
    target,
    clientId,
    clientName,
    clientTimezone,
    preselectedBlockId,
    onApplied,
    plan,
    isPlanLoading,
    draft,
    seedCount,
    isDirty,
    mode,
    setMode,
    isSaving,
    assistantBusy,
    saveProgram,
    discardChanges,
    setName,
    setSplitType,
    setDescription,
    setDefaultSurplus,
    addWeek,
    duplicateWeek,
    deleteWeek,
    reorderWeek,
    placeSession,
    removeSession,
    moveSession,
    reorderSession,
    updateSession,
    addExercise,
    removeExercise,
    updateExercise,
    linkExercises,
    unlinkGroup,
    moveExercise,
    moveGroup,
    updateGroup,
    editSetSpec,
    dayRules,
    limit,
    placedLoadError,
    planSave,
  } = useProgramDraft();

  // Client-draft mode (Phase 5): the shared builder mounted inside the coach's
  // client drawer as a per-client editor. The library chrome (Save/Delete to
  // the template, the /dashboard/programs create-blank route, the "All
  // programs" link) is swapped for an Apply-to-client flow; the template is
  // never mutated — Apply materializes the edited copy onto the client's
  // calendar.
  // Placed-plan mode is the plan editor: the same builder over a client's
  // program as laid on the calendar — days before the first editable day
  // locked, days past the plan's limit greyed, identity editable — saved
  // through the plan editor's PUT ("Save changes to plan").
  const isClientDraft = target === "client-draft";
  const isPlacedPlan = target === "placed-plan";
  const isLibrary = target === "library";
  const apply = useClientApply({ draft, isDirty, clientId, plan });

  const [collapsedWeeks, setCollapsedWeeks] = useState<Set<string>>(new Set());
  // The editor sheet's session uid. The subject outlives the close: Radix
  // re-renders a closing sheet from live state (CONVENTIONS §7 → "No frame
  // disagrees"), so the sheet slides out still showing its session.
  const sessionSheet = useDialogSubject<string>();
  // The library panel's New session / Edit session sheet: owned here, beside
  // the dock, because the dock steps aside while it is open. The subject
  // outlives the close, so the sheet keeps what it showed while it slides out.
  const librarySessionEditor = useDialogSubject<SessionEditorState>();
  const [addTarget, setAddTarget] = useState<AddSessionTarget | null>(null);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const [confirmDiscardChangesOpen, setConfirmDiscardChangesOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const placeLibrarySession = (session: SavedSession, slotUid: string) => {
    // Clone-by-value with fresh uids; it joins the day, last (a full day is
    // filtered out of collision, and the model refuses it too).
    placeSession(slotUid, savedSessionToDraft(session));
  };

  const placeLibraryExercise = (exercise: Exercise, slotUid: string) => {
    // Append a catalog exercise to the day's only session. Collision already
    // restricts library-exercise drops to a day holding exactly one session;
    // the lookup is the belt (a rest day has no session to append to, and on
    // a day holding several the coach picks the session in its editor).
    const slot = findSlot(draft, slotUid);
    if (slot?.sessions.length !== 1) return;
    addExercise(
      slot.sessions[0].uid,
      defaultExerciseDraftFromCatalog({
        name: exercise.name,
        exerciseId: exercise.id,
        exerciseType: exercise.exerciseType,
      }),
    );
  };

  const dnd = useProgramDnd({
    draft,
    reorderWeek,
    moveSession,
    reorderSession,
    placeLibrarySession,
    placeLibraryExercise,
    lockedSlotUids: dayRules?.locked,
  });
  const { isSavingWorkout, saveDayAsWorkout } = useSaveDayAsWorkout(draft);

  // The library's exit LEAVES the page: back over every entry of the builder
  // to the one before it (the library, most often), else the library itself
  // — a pasted address.
  const exit = () =>
    onExit ? onExit() : leaveCoachPage(() => router.push("/dashboard/programs"));

  // The library panel's back arrow is the builder's ONLY exit on every target
  // (the hero no longer carries one), so the leave-confirm lives here. In
  // library mode this also closes a real gap: the panel's "All programs" link
  // used to navigate away from a dirty draft without warning.
  const requestExit = () => {
    if (isDirty && mode === "edit") setConfirmLeaveOpen(true);
    else exit();
  };

  const backLabel = isClientDraft
    ? "Back to library"
    : isPlacedPlan
      ? "Back to calendar"
      : "Back to programs";

  const deletePlan = async (successTitle: string) => {
    try {
      const res = await fetch(`/api/training/saved-plans/${savedPlanId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast.success(successTitle);
      exit();
    } catch {
      toast.error("Error", {
        description: "Failed to delete program",
      });
    }
  };

  // The seeding gap (read arrived, draft seeds on the next effect tick) shows
  // the spinner too; a placed-plan load failure falls through to the message.
  const stillSeeding = isPlacedPlan ? !draft && !placedLoadError : !draft && !!plan;
  if (isPlanLoading || stillSeeding) {
    return <PageLoading label={isPlacedPlan ? "Loading plan…" : "Loading program…"} />;
  }
  if (!draft || (!isPlacedPlan && !plan)) {
    return (
      <div className={cn("py-24 text-center text-sm", TEXT_SECONDARY)}>
        {isPlacedPlan ? (placedLoadError ?? "Plan not found.") : "Program not found."}
      </div>
    );
  }

  const editingSession = findSession(draft, sessionSheet.subject);
  // A session the draft drops while its sheet is up (an assistant op) closes it.
  const sessionSheetOpen = sessionSheet.open && editingSession != null;
  // Every sheet that can be over the builder, each read from its one owner:
  // the session sheet's subject, the create-session slide-over's address, the
  // library session editor's subject. The corner assistant steps aside while
  // any is open (assistant-dock.tsx), in the same commit as the sheet.
  const sheetOverBuilder =
    sessionSheetOpen ||
    isCreateSessionPath(pathname, isLibrary ? savedPlanId : null) ||
    librarySessionEditor.open;
  // Sessions, not training days: a day can hold several.
  const trainingCount = draft.weeks.reduce((sum, w) => sum + weekSessions(w).length, 0);

  const requestAddSession = (slot: DaySlotDraft, anchor: AddSessionAnchor) => {
    const weekIndex = draft.weeks.findIndex((week) =>
      week.days.some((s) => s.uid === slot.uid),
    );
    if (weekIndex < 0) return;
    setAddTarget({ slotUid: slot.uid, weekIndex, dayIndex: slot.orderIndex, anchor });
  };

  return (
    // Library: full-bleed within the programs shell — cancel its px-8/py
    // padding so the library panel sits flush against the icon rail and the
    // grid fills main's 100vh box (`h-screen`; the section topbar hides on this
    // route). Client-draft AND placed-plan: the host is a full-screen overlay
    // dialog with no shell padding to cancel — the library-mode negative
    // margins would shift the editor over the nav rail and push Day 7 off
    // screen — so fill the overlay's own box (`h-full`).
    <div
      className={cn(
        "flex flex-col",
        isLibrary ? "-mx-8 -mt-5 -mb-[60px] h-screen" : "h-full",
      )}
    >
      <DndContext
        sensors={dnd.sensors}
        collisionDetection={dnd.collisionDetection}
        onDragStart={dnd.handleDragStart}
        onDragMove={dnd.handleDragMove}
        onDragEnd={dnd.handleDragEnd}
        onDragCancel={dnd.handleDragCancel}
      >
        <div className="flex min-h-0 flex-1">
          <BuilderLibraryPanel
            mode={mode}
            clientName={clientName ?? undefined}
            backLabel={backLabel}
            onBack={requestExit}
            onNewSession={() => librarySessionEditor.show({ mode: "create" })}
            onEditSession={(session) => librarySessionEditor.show({ mode: "edit", session })}
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* Page header. The section topbar returns null for the builder
                route (programs-topbar.tsx), so the builder renders its own
                INSIDE the main column — right of the library panel, exactly
                like the client detail pages' title band sits right of the
                client sidebar (client-detail-layout.tsx). px-6 tracks this
                column's own padding the way that one tracks its px-8 main.
                The client-scoped overlays have no page to title: the panel
                already names the client and the hero names the program. */}
            {isLibrary && (
              // NOT sticky, unlike the client-detail band it copies: nothing
              // scrolls under it (the grid owns its own scroller), and inside
              // the shell's `py-5` main a `sticky top-0` clamps the band 20px
              // down — re-introducing the exact offset the root's `-mt-5`
              // exists to cancel, so it would sit below the panel's back row.
              <header className="shrink-0 bg-white px-6 py-2">
                <div className="flex items-center justify-between">
                  <h1 className="text-[15px] font-bold text-[#0c1a1e]">Program Builder</h1>
                  <NotificationsDropdown compact />
                </div>
              </header>
            )}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col px-6 pt-5">
              <ProgramTopBar
                draft={draft}
                seedCount={seedCount}
                mode={mode}
                identityEditable={!isClientDraft}
                // A placed plan has no inheritable default — placement resolved
                // it into every row (absolute surplus, decision 10). Session-
                // level surplus editing + the assistant cover bulk changes.
                showSurplus={!isPlacedPlan}
                onRename={setName}
                onFocusChange={setSplitType}
                onDescriptionChange={setDescription}
                onDefaultSurplusChange={setDefaultSurplus}
              />
              <SectionLabel
                label="Schedule"
                meta={`${draft.weeks.length} ${draft.weeks.length === 1 ? "week" : "weeks"} · ${trainingCount} ${trainingCount === 1 ? "session" : "sessions"}`}
                actions={
                  // Divider-rail pattern: ALL program actions live on the
                  // rule, not in the hero band — icons for edit/delete, small
                  // uppercase text for the edit-mode commit actions. Client-draft
                  // swaps the library commit (Save/Delete to the template) for an
                  // Apply-to-client button; the template is never mutated here.
                  <div className="flex items-center gap-3">
                    {isClientDraft && (
                      <button
                        type="button"
                        className="rounded-[6px] bg-[#0d9488] px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[#0b7f75] disabled:opacity-50"
                        // assistantBusy: an in-flight AI turn's ops replay against
                        // the current tree — applying mid-turn would materialize a
                        // calendar the turn then diverges from.
                        disabled={!apply.canApply || assistantBusy}
                        onClick={apply.requestApply}
                      >
                        Apply to client
                      </button>
                    )}
                    {/* Rail save icon — the design system's DEFAULT commit
                        affordance for an editor surface (owner call; codified in
                        docs/newdesignsystem.md → Buttons). Same slot + look as
                        the library save; commit leftmost, destructive rightmost.
                        assistantBusy mirrors the library save. */}
                    {isPlacedPlan && mode === "edit" && (
                      <button
                        type="button"
                        aria-label="Save changes to plan"
                        title="Save changes to plan"
                        disabled={!isDirty || planSave.isSaving || assistantBusy}
                        className="rounded p-1 text-[#0d9488] transition-colors hover:text-[#0b7f75] disabled:opacity-50"
                        onClick={planSave.request}
                      >
                        {planSave.isSaving ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
                        )}
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
                    {/* Icon order is stable across modes: commit action (Save)
                        leftmost, Discard middle, Delete ALWAYS rightmost — the
                        trash must never change sides when entering edit mode. */}
                    {mode === "edit" && (
                      <>
                        {isLibrary && (
                          <button
                            type="button"
                            aria-label="Save program"
                            title="Save program"
                            disabled={isSaving || assistantBusy}
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
                        {/* Draft-discard (delete) is library-only; client-draft
                            and placed-plan surfaces only ever show the
                            revert-my-edits Discard-changes control. */}
                        {isLibrary && draft.status === "draft" ? (
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
                            aria-label={isDirty ? "Discard changes" : "Cancel editing"}
                            title={isDirty ? "Discard changes" : "Cancel editing"}
                            disabled={isSaving}
                            className="rounded p-1 text-[#93b0b4] transition-colors hover:text-[#c06060] disabled:opacity-50"
                            onClick={() => {
                              // With unsaved edits, confirm the revert; with none,
                              // just leave edit mode (nothing to discard) so the
                              // coach is never stuck in edit mode.
                              if (isDirty) setConfirmDiscardChangesOpen(true);
                              else setMode("view");
                            }}
                          >
                            <Ban className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                        )}
                      </>
                    )}
                    {isLibrary && (
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
                  </div>
                }
              />
              {isPlacedPlan && limit && (
                // The plan stays inside its limit — the block's end, else the
                // day before the next block or program — and the grid greys
                // the days past it; this line says why.
                <div className="mb-2 rounded-[6px] border border-[rgba(13,148,136,0.2)] bg-[rgba(13,148,136,0.05)] px-3 py-2 text-[12.5px] text-[#0a5c55]">
                  {limitNotice(limit)}
                </div>
              )}
              <ProgramGrid
                draft={draft}
                mode={mode}
                dayRules={dayRules ?? undefined}
                dayReorder={dnd.dayReorder}
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
                onOpenSession={sessionSheet.show}
                onRequestAddSession={requestAddSession}
                onRemoveSession={removeSession}
              />
            </div>
          </div>
        </div>

        {/* DragOverlay portaled to <body>: an animated/transformed ancestor
            would become the containing block for the overlay's fixed
            positioning and offset the drag preview. Mounted only while a drag
            lasts, so the copy goes in the same render the drop lands in: a
            DragOverlay left mounted keeps its last frame until its drop
            animation resolves, even with none. */}
        {dnd.activeDrag &&
          createPortal(
            <DragOverlay dropAnimation={null}>
              {dnd.activeDrag?.type === "week" ? (
                <div className={cn(MONO, "rounded-[6px] bg-white px-3 py-2 text-sm font-semibold shadow-lg", TRAINING_CARD_BORDER, TEXT_PRIMARY)}>
                  Week {dnd.activeDrag.week.weekIndex + 1}
                </div>
              ) : dnd.activeDrag?.type === "session" ? (
                <div className={cn("rounded-[6px] bg-white px-3 py-2 shadow-lg", TRAINING_CARD_BORDER)}>
                  <div className={cn("text-xs font-semibold", TEXT_PRIMARY)}>
                    {dnd.activeDrag.session.name}
                  </div>
                  <div className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal")}>
                    {countSessionExercises(dnd.activeDrag.session)} exercises
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
                    <span className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal")}>
                      {countSessionExercises(dnd.activeDrag.session)} exercises
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

      {/* The assistant's state lives in ProgramDraftProvider, above every host
          of its panel, so the panel keeps its conversation when a sheet opens
          or closes (assistant-provider.tsx). */}
      <SessionEditorSheet
        open={sessionSheetOpen}
        session={editingSession}
        // A session on a locked day opens read-only — the guarded mutators
        // would refuse its edits anyway.
        mode={
          editingSession &&
          dayRules &&
          isSessionLocked(draft, dayRules.locked, editingSession.uid)
            ? "view"
            : mode
        }
        identityEditable={!isClientDraft}
        defaultSurplusPercentage={draft.defaultSurplusPercentage}
        onClose={sessionSheet.close}
        onUpdateSession={updateSession}
        onAddExercise={addExercise}
        onRemoveExercise={removeExercise}
        onEditExercise={updateExercise}
        onLinkExercises={linkExercises}
        onUnlinkGroup={unlinkGroup}
        onMoveExercise={moveExercise}
        onMoveGroup={moveGroup}
        onUpdateGroup={updateGroup}
        onSpecEdit={editSetSpec}
        onSaveAsWorkout={(uid) => void saveDayAsWorkout(uid)}
        isSavingWorkout={isSavingWorkout}
      />
      <StandaloneSessionEditor
        open={librarySessionEditor.open}
        state={librarySessionEditor.subject}
        onClose={librarySessionEditor.close}
      />
      <AssistantDock sheetOpen={sheetOverBuilder} />

      <AddSessionPopover
        target={mode === "edit" ? addTarget : null}
        onClose={() => setAddTarget(null)}
        onPickSession={(target, session) => {
          placeSession(target.slotUid, savedSessionToDraft(session));
          setAddTarget(null);
        }}
        onCreateBlank={(t) => {
          setAddTarget(null);
          if (!isLibrary) {
            // No intercepted /dashboard/programs modal route exists in the
            // client drawer — build the blank session in-memory (uid held here,
            // so we can open it) and place it: it joins the day, last. Library
            // create-blank persists a standalone session; a client draft's
            // stays in-memory, which is correct for a per-client edit.
            const place = (findSlot(draft, t.slotUid)?.sessions.length ?? 0) + 1;
            const blank: SessionDraft = {
              uid: newUid("sess"),
              name: place > 1 ? `Day ${t.dayIndex + 1} · Session ${place}` : `Day ${t.dayIndex + 1}`,
              focus: null,
              estimatedDurationMinutes: null,
              calorieSurplusPercentage: null,
              notes: null,
              sessionType: "training",
              groups: [],
            };
            placeSession(t.slotUid, blank);
            sessionSheet.show(blank.uid);
            return;
          }
          if (!savedPlanId) return;
          router.push(createSessionHref(savedPlanId, t.weekIndex, t.dayIndex));
        }}
      />

      <ConfirmDialog
        open={confirmLeaveOpen}
        onOpenChange={setConfirmLeaveOpen}
        title="Discard unsaved changes?"
        description={
          isClientDraft
            ? "You have unsaved edits for this client. Leaving now will discard them."
            : isPlacedPlan
              ? "You have unsaved changes to this plan. Leaving now will discard them."
              : "You have edits that haven't been saved to the library yet. Leaving now will lose them."
        }
        confirmLabel={isClientDraft ? "Leave without applying" : "Leave without saving"}
        destructive
        onConfirm={exit}
      />
      {isLibrary && (
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
            : isPlacedPlan
              ? "Your changes will be discarded and the plan reset to what's on the calendar."
              : "The program goes back to its last saved state."
        }
        confirmLabel="Discard changes"
        destructive
        onConfirm={discardChanges}
      />
      {isLibrary && (
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

      {/* The plan editor's save: confirm → PUT; a 409 (the calendar changed
          since the editor opened) opens the refusal with the draft intact. */}
      {isPlacedPlan && (
        <>
          <PlanEditConfirmDialog
            open={planSave.confirmOpen}
            onOpenChange={planSave.setConfirmOpen}
            isSaving={planSave.isSaving}
            onConfirm={() => void planSave.confirm()}
          />
          <PlanEditStaleDialog
            open={planSave.staleOpen}
            onOpenChange={planSave.setStaleOpen}
            onReload={planSave.reloadAndDiscard}
          />
        </>
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
            clientTimezone={clientTimezone ?? undefined}
            clientName={clientName ?? undefined}
            preselectedBlockId={preselectedBlockId}
            onSuccess={() => onApplied?.()}
          />
        </>
      )}
    </div>
  );
}
