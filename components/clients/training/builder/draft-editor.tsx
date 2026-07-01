"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2, Save, Trash2, Calendar, Moon, GripVertical } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useSavedPlan } from "@/hooks/use-saved-plan";
import { PreviewSessionCard } from "../library/preview-session-card";
import { AddLibraryExerciseDialog } from "../library/add-library-exercise-dialog";
import { ApplyToClientDialog } from "@/components/training-library/apply-to-client-dialog";
import { useSessionMutations } from "./use-session-mutations";
import { SessionForm } from "./session-form";
import type { SavedPlan, SavedSession, SavedExercise } from "@/types/training";
import type { InlinePlanBody } from "@/lib/validations/training";

// Serialize working-copy sessions into the API's session/exercise shape (shared
// by the library overwrite and the inline apply so the two never drift).
function serializeSessionsForApi(sessions: SavedSession[]) {
  return sessions.map((s) => ({
    name: s.name,
    focus: s.focus,
    orderIndex: s.orderIndex,
    isRest: s.isRest,
    estimatedDurationMinutes: s.estimatedDurationMinutes,
    calorieSurplusPercentage: s.calorieSurplusPercentage,
    notes: s.notes,
    sessionType: s.sessionType,
    exercises: s.exercises.map((e) => ({
      name: e.name,
      exerciseId: e.exerciseId,
      orderIndex: e.orderIndex,
      sets: e.sets,
      repsMin: e.repsMin,
      repsMax: e.repsMax,
      repsTarget: e.repsTarget,
      rpeTarget: e.rpeTarget,
      percentage1rm: e.percentage1rm,
      tempo: e.tempo,
      restSeconds: e.restSeconds,
      notes: e.notes,
      supersetGroup: e.supersetGroup,
      isWarmup: e.isWarmup,
    })),
  }));
}

// The edited working copy as the inline-apply body. Carries programDurationWeeks
// + splitType (the placement window length + metadata that overwrite omits).
function buildInlinePlanBody(plan: SavedPlan): InlinePlanBody {
  return {
    name: plan.name,
    splitType: plan.splitType,
    programDurationWeeks: plan.programDurationWeeks,
    defaultSurplusPercentage: plan.defaultSurplusPercentage,
    sessions: serializeSessionsForApi(plan.sessions),
  };
}

type DraftEditorProps = {
  savedPlanId: string;
  clientId?: string;
  onDiscard?: () => void;
  onApplied?: () => void;
};

export function DraftEditor({
  savedPlanId,
  clientId,
  onDiscard,
  onApplied,
}: DraftEditorProps) {
  const { toast } = useToast();
  const { plan, isLoading, mutate } = useSavedPlan(savedPlanId);
  const [isPromoting, setIsPromoting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isOverwriting, setIsOverwriting] = useState(false);
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [addExerciseSessionId, setAddExerciseSessionId] = useState<string | null>(null);
  const [newSessionDraft, setNewSessionDraft] = useState<string | null>(null);

  // Working copy for `status === "saved"` plans — all edits stay in memory
  // until the coach explicitly commits via "Save and Update Plan". For drafts,
  // we keep the old save-as-you-go behavior (workingPlan stays null, mutations
  // hit the server immediately) so an in-progress draft survives a refresh.
  const [workingPlan, setWorkingPlan] = useState<SavedPlan | null>(null);
  // Dirty flag for working-copy edits. Gates the Apply button: the apply flow
  // uses the SAVED plan (place-from-library), so applying while dirty would
  // silently ignore the coach's unsaved edits. Disabling is clearer than
  // surprising them with a stale apply.
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const baseUrl = `/api/training/saved-plans/${savedPlanId}`;

  const sensors = useSensors(
    // 4px activation distance prevents a plain click on the grip from registering
    // as a drag — the coach has to actually move the pointer to start dragging.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // `isWorkingCopy` branches every mutation. For saved plans, mutations stay
  // in memory until the coach commits. For drafts, they hit the server
  // immediately so an in-progress draft survives a refresh.
  const isWorkingCopy = plan?.status === "saved";
  const displayedPlan = workingPlan ?? plan;

  // Every working-copy mutation routes through this helper so the dirty flag
  // can't drift from the state. Callers just provide the reducer; we handle
  // the flag.
  const mutateWorking = useCallback(
    (updater: (current: SavedPlan | null) => SavedPlan | null) => {
      setWorkingPlan(updater);
      setHasUnsavedEdits(true);
    },
    [],
  );

  const apiCall = useCallback(
    async (url: string, options: RequestInit, errorMessage: string) => {
      try {
        const res = await fetch(url, options);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast({
            title: "Error",
            description: data.error || errorMessage,
            variant: "destructive",
          });
          return;
        }
        await mutate();
      } catch {
        toast({ title: "Error", description: errorMessage, variant: "destructive" });
      }
    },
    [mutate, toast],
  );

  const patchPlan = useCallback(
    async (updates: Record<string, unknown>) => {
      if (isWorkingCopy) {
        mutateWorking((current) => (current ? { ...current, ...updates } : current));
        return;
      }
      await apiCall(
        baseUrl,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        },
        "Failed to update plan",
      );
    },
    [isWorkingCopy, baseUrl, apiCall, mutateWorking],
  );

  const { patchSession, patchExercise, removeSession, removeExercise } =
    useSessionMutations({ baseUrl, isWorkingCopy, apiCall, mutateWorking });

  const handlePromote = async () => {
    setIsPromoting(true);
    try {
      const res = await fetch(`${baseUrl}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saveSessionsIndividually: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      if (data.nameConflict) {
        toast({
          title: "Name conflict",
          description: data.nameConflict,
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Saved to library" });
      await mutate();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save",
        variant: "destructive",
      });
    } finally {
      setIsPromoting(false);
    }
  };

  const handleDiscard = async () => {
    setIsDeleting(true);
    try {
      await fetch(baseUrl, { method: "DELETE" });
      toast({ title: "Draft discarded" });
      onDiscard?.();
    } catch {
      toast({ title: "Error", description: "Failed to discard", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  /**
   * Commit the working copy to the library template (overwrite). Only used
   * when plan.status === "saved". Sends the full working-copy structure to
   * the server, which replaces the saved plan's sessions/exercises and
   * recomputes cycle metadata.
   */
  const handleOverwrite = async () => {
    if (!workingPlan) return;
    setIsOverwriting(true);
    try {
      const res = await fetch(`${baseUrl}/overwrite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: workingPlan.name,
          description: workingPlan.description,
          defaultSurplusPercentage: workingPlan.defaultSurplusPercentage,
          sessions: serializeSessionsForApi(workingPlan.sessions),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save plan");
      }
      toast({
        title: "Plan saved",
        description: "The library template now reflects your changes.",
      });
      // Order matters here: refresh SWR's cache FIRST so `plan` reflects the
      // committed save, THEN null the working copy. The seeding effect
      // (gated on `!workingPlan`) fires exactly once after the null and
      // re-seeds from the already-fresh `plan`. If we nulled first, the
      // effect would re-seed from the pre-mutate (stale) plan and then skip
      // the post-mutate render because `workingPlan` would already be truthy.
      await mutate();
      setWorkingPlan(null);
      setHasUnsavedEdits(false);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to save plan",
        variant: "destructive",
      });
    } finally {
      setIsOverwriting(false);
    }
  };

  const addSession = async (payload: { name: string; isRest: boolean }) => {
    if (isWorkingCopy) {
      mutateWorking((current) => {
        if (!current) return current;
        const newSession: SavedSession = {
          // Client-generated id — overwrite/apply endpoints ignore it; the
          // server creates real row ids. The only reason we need one locally
          // is so React keys and dnd-kit item ids stay stable.
          id: `local-${crypto.randomUUID()}`,
          coachId: current.coachId,
          savedPlanId: current.id,
          name: payload.isRest ? "Rest" : payload.name,
          focus: null,
          orderIndex: current.sessions.length,
          isRest: payload.isRest,
          estimatedDurationMinutes: null,
          calorieSurplusPercentage: null,
          notes: null,
          sessionType: "training",
          exercises: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        return { ...current, sessions: [...current.sessions, newSession] };
      });
      setNewSessionDraft(null);
      return;
    }
    try {
      const res = await fetch(`${baseUrl}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast({
          title: "Error",
          description: data.error || "Failed to add session",
          variant: "destructive",
        });
        return;
      }
      await mutate();
      setNewSessionDraft(null);
    } catch {
      toast({
        title: "Error",
        description: "Failed to add session",
        variant: "destructive",
      });
    }
  };

  // Seed the working copy from server state exactly once, the moment the
  // saved plan is available. The `!workingPlan` gate makes this a no-op on
  // subsequent re-renders — including SWR-driven `mutate()` refreshes — so
  // the coach's in-flight edits are never clobbered by a background refetch.
  //
  // Cross-plan cleanup is handled by remounting at the parent via
  // `<DraftEditor key={savedPlanId} />`, which React collapses into a full
  // unmount → mount cycle. That's cheaper, simpler, and more predictable
  // than a second effect racing this one for the same state slot — which is
  // exactly the class of bug this replaced.
  useEffect(() => {
    if (plan?.status === "saved" && !workingPlan) {
      setWorkingPlan(plan);
    }
  }, [plan, workingPlan]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveSessionId(String(event.active.id));
  };

  const handleDragCancel = () => {
    setActiveSessionId(null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveSessionId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    // Working-copy mode: just rearrange the in-memory session array.
    if (isWorkingCopy) {
      mutateWorking((current) => {
        if (!current) return current;
        const oldIndex = current.sessions.findIndex((s) => s.id === active.id);
        const newIndex = current.sessions.findIndex((s) => s.id === over.id);
        if (oldIndex < 0 || newIndex < 0) return current;
        const reordered = arrayMove(current.sessions, oldIndex, newIndex).map(
          (s, i) => ({ ...s, orderIndex: i }),
        );
        return { ...current, sessions: reordered };
      });
      return;
    }

    // Draft mode: existing server-backed reorder + SWR refresh.
    const currentSessions = plan?.sessions ?? [];
    const oldIndex = currentSessions.findIndex((s) => s.id === active.id);
    const newIndex = currentSessions.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(currentSessions, oldIndex, newIndex);
    try {
      const res = await fetch(`${baseUrl}/sessions/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order: reordered.map((s, i) => ({ sessionId: s.id, orderIndex: i })),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to reorder sessions");
      }
      await mutate();
    } catch (error) {
      await mutate();
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to reorder sessions",
        variant: "destructive",
      });
    }
  };

  if (isLoading || !displayedPlan || !plan) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const defaultSurplus = displayedPlan.defaultSurplusPercentage ?? 15;
  const sessions = displayedPlan.sessions ?? [];

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="border-b p-4 space-y-3 bg-white">
        <div className="flex items-center gap-2">
          <Input
            // Re-key on the displayed plan's id so switching between saved
            // plans forces the uncontrolled input to pick up the new name.
            key={`name-${displayedPlan.id}`}
            className="text-lg font-semibold border-0 p-0 h-auto focus-visible:ring-0"
            defaultValue={displayedPlan.name}
            onBlur={(e) => void patchPlan({ name: e.target.value })}
          />
          {displayedPlan.splitType && (
            <Badge variant="outline" className="text-[10px] flex-shrink-0">
              {displayedPlan.splitType.replace(/_/g, " ")}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {/* Derive the cycle length from the working copy's sessions when in
              working-copy mode, since server-side cycle_length hasn't been
              recomputed yet. For drafts, fall back to the server value. */}
          {(() => {
            const derivedCycle = isWorkingCopy
              ? displayedPlan.sessions.length
              : (displayedPlan.cycleLength ?? displayedPlan.sessions.length);
            return derivedCycle > 0 ? (
              <span>{derivedCycle}-day cycle</span>
            ) : null;
          })()}
          <div className="flex items-center gap-1">
            <span>Default surplus:</span>
            <Input
              key={`surplus-${displayedPlan.id}`}
              className="h-5 w-12 text-xs text-center px-1 inline-block"
              type="number"
              defaultValue={defaultSurplus}
              onBlur={(e) =>
                void patchPlan({
                  defaultSurplusPercentage: parseFloat(e.target.value) || 15,
                })
              }
            />
            <span>%</span>
          </div>
        </div>
      </div>

      {/* Action buttons — differ for draft vs already-saved plans */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-white">
        {plan.status === "saved" ? (
          <>
            <Button
              size="sm"
              variant="default"
              onClick={() => void handleOverwrite()}
              disabled={isOverwriting}
              title="Overwrite the library template with your edits."
            >
              {isOverwriting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Save className="h-3.5 w-3.5 mr-1.5" />
              )}
              Save and Update Plan
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setApplyDialogOpen(true)}
              title={
                hasUnsavedEdits
                  ? "Apply your edited copy to a client's calendar (the library template stays unchanged)."
                  : "Apply this plan to a client's calendar."
              }
            >
              <Calendar className="h-3.5 w-3.5 mr-1.5" />
              Apply to Client
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="default"
              onClick={() => void handlePromote()}
              disabled={isPromoting}
            >
              {isPromoting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Save className="h-3.5 w-3.5 mr-1.5" />
              )}
              Save to Library
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive ml-auto"
              onClick={() => void handleDiscard()}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              )}
              Discard
            </Button>
          </>
        )}
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="mx-auto max-w-4xl space-y-4">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={(e) => void handleDragEnd(e)}
            onDragCancel={handleDragCancel}
          >
            <SortableContext
              items={sessions.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              {sessions.map((session) => (
                <SortableSessionCard key={session.id} id={session.id}>
                  <PreviewSessionCard
                    session={session}
                    defaultSurplus={defaultSurplus}
                    onUpdateSession={(updates) => void patchSession(session.id, updates)}
                    onRemoveSession={() => void removeSession(session.id)}
                    onUpdateExercise={(exId, updates) =>
                      void patchExercise(session.id, exId, updates)
                    }
                    onRemoveExercise={(exId) => void removeExercise(session.id, exId)}
                    onAddExercise={() => setAddExerciseSessionId(session.id)}
                  />
                </SortableSessionCard>
              ))}
            </SortableContext>

            {/*
              DragOverlay must render OUTSIDE the transformed dialog ancestor.
              DialogPrimitive.Content has tailwindcss-animate's slide-in animation,
              whose keyframes end at transform: translate3d(0,0,0) — a non-none
              transform that persists (animation-fill-mode: both) and turns the
              dialog into a containing block for position:fixed descendants.
              Without this portal, the overlay's `fixed` coordinates would be
              measured from the dialog's left edge instead of the viewport,
              placing the drag preview hundreds of pixels to the right.
              React context (including DndContext) flows through portals, so
              portaling the DOM only doesn't break the drag connection.
            */}
            {typeof document !== "undefined" &&
              createPortal(
                <DragOverlay dropAnimation={null}>
                  {activeSessionId ? (
                    <SessionDragPreview
                      session={
                        sessions.find((s) => s.id === activeSessionId) ?? null
                      }
                    />
                  ) : null}
                </DragOverlay>,
                document.body,
              )}
          </DndContext>

          {/* Add session / rest day at the end of the cycle. For working-copy
              mode this is instant; for drafts it triggers a quick POST which
              completes in <500ms — fast enough that a spinner would flicker. */}
          <SessionForm
            draft={newSessionDraft}
            onDraftChange={setNewSessionDraft}
            onAdd={(name) => void addSession({ name, isRest: false })}
            onAddRest={() => void addSession({ name: "Rest", isRest: true })}
          />
        </div>
      </div>

      {addExerciseSessionId && (
        <AddLibraryExerciseDialog
          savedPlanId={savedPlanId}
          sessionId={addExerciseSessionId}
          open={!!addExerciseSessionId}
          onOpenChange={(open) => {
            if (!open) setAddExerciseSessionId(null);
          }}
          onSuccess={() => void mutate()}
          // Working-copy mode: push the new exercise into workingPlan locally
          // so the change doesn't persist until "Save and Update Plan" is hit.
          onAddLocal={
            isWorkingCopy
              ? (payload) => {
                  mutateWorking((current) => {
                    if (!current) return current;
                    return {
                      ...current,
                      sessions: current.sessions.map((s) => {
                        if (s.id !== addExerciseSessionId) return s;
                        const newExercise: SavedExercise = {
                          id: `local-${crypto.randomUUID()}`,
                          savedSessionId: s.id,
                          exerciseId: null,
                          name: payload.name,
                          orderIndex: s.exercises.length,
                          sets: payload.sets,
                          repsMin: payload.repsMin ?? null,
                          repsMax: payload.repsMax ?? null,
                          repsTarget: null,
                          rpeTarget: payload.rpeTarget ?? null,
                          percentage1rm: null,
                          tempo: null,
                          restSeconds: payload.restSeconds ?? null,
                          supersetGroup: null,
                          isWarmup: false,
                          notes: null,
                          createdAt: new Date().toISOString(),
                          updatedAt: new Date().toISOString(),
                        };
                        return {
                          ...s,
                          exercises: [...s.exercises, newExercise],
                        };
                      }),
                    };
                  });
                }
              : undefined
          }
        />
      )}

      <ApplyToClientDialog
        open={applyDialogOpen}
        onOpenChange={setApplyDialogOpen}
        savedPlan={displayedPlan}
        // With unsaved edits, apply the working copy inline (template untouched);
        // otherwise place the persisted saved plan by id.
        inlinePlan={
          hasUnsavedEdits && workingPlan ? buildInlinePlanBody(workingPlan) : undefined
        }
        preselectedClientId={clientId}
        onSuccess={() => {
          // Keep the editor open — the coach may want to apply to another
          // client or keep editing. The parent refreshes via onApplied.
          onApplied?.();
        }}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sortable wrapper — grip handle is the only draggable surface so clicks on
// inputs, buttons, and exercises inside PreviewSessionCard keep working.
// ═══════════════════════════════════════════════════════════════════════════

function SortableSessionCard({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  // While dragging, hide the source entirely — DragOverlay renders the visible
  // preview. visibility:hidden (vs display:none) preserves the layout slot so
  // sibling transforms shift by the correct height.
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    visibility: isDragging ? ("hidden" as const) : undefined,
  };

  // The grip sits INSIDE the wrapper's bounding box (in its left padding), not
  // outside it. If the grip lived outside the box, dnd-kit would measure the
  // source rect starting past the cursor, and the DragOverlay would float to
  // the right of the pointer for the whole drag. Keep the grip inside.
  return (
    <div ref={setNodeRef} style={style} className="relative pl-7">
      <button
        type="button"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
        className="absolute left-0 top-4 flex items-center justify-center w-7 h-7 text-[#93b0b4] hover:text-[#0d9488] cursor-grab active:cursor-grabbing transition-colors touch-none"
      >
        <GripVertical className="h-5 w-5" strokeWidth={1.8} />
      </button>
      {children}
    </div>
  );
}

/**
 * Lightweight preview shown in the DragOverlay while a session is being dragged.
 * Always the same compact size regardless of whether the source card was expanded,
 * so the drag visual stays consistent for both training sessions and rest days.
 */
function SessionDragPreview({ session }: { session: SavedSession | null }) {
  if (!session) return null;
  const isRest = session.isRest;
  return (
    <div
      className={`rounded-[8px] border shadow-[0_8px_24px_rgba(15,32,39,0.18)] px-4 py-3 flex items-center gap-3 ${
        isRest
          ? "bg-[rgba(148,163,184,0.12)] border-[rgba(148,163,184,0.4)]"
          : "bg-white border-[rgba(13,148,136,0.3)]"
      }`}
      style={{ width: "min(560px, 90vw)" }}
    >
      <GripVertical className="h-4 w-4 text-[#93b0b4]" strokeWidth={1.8} />
      {isRest ? (
        <>
          <Moon className="h-4 w-4 text-[#64748b]" strokeWidth={1.8} />
          <span className="text-[13px] font-medium text-[#64748b]">Rest Day</span>
        </>
      ) : (
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-[13.5px] font-semibold text-[#0c1a1e] truncate">
            {session.name}
          </span>
          {session.focus && (
            <span className="text-[11.5px] text-[#93b0b4] truncate">
              {session.focus}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
