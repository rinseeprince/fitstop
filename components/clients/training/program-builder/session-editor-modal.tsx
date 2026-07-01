"use client";

import { Moon } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ExerciseDraft, SessionDraft } from "./program-builder-types";
import type { SetSpecEdit } from "./use-set-spec-mutations";
import { ExerciseCard } from "./exercise-card";
import { ExercisePicker } from "./exercise-picker";
import { FOCUS_RING, LABEL_CLASS } from "./builder-tokens";

// Session editor for ONE day cell. Edits write straight through to the draft
// (the working-copy model: "Save program" on the page is the commit point, so
// there is no per-modal save/cancel). The per-session calorie surplus lives
// here — it overrides the program default and cascades to the client's
// nutrition at apply time (blank = inherit; never coerce blank to a number).
type SessionEditorModalProps = {
  session: SessionDraft | null; // null = closed
  mode: "view" | "edit";
  defaultSurplusPercentage: number | null;
  onClose: () => void;
  onUpdateSession: (
    sessionUid: string,
    patch: Partial<Omit<SessionDraft, "uid" | "exercises">>,
  ) => void;
  onAddExercise: (sessionUid: string, exercise: Omit<ExerciseDraft, "uid">) => void;
  onRemoveExercise: (sessionUid: string, exerciseUid: string) => void;
  onEditExercise: (sessionUid: string, exerciseUid: string, patch: Partial<ExerciseDraft>) => void;
  onReorderExercise: (sessionUid: string, activeUid: string, overUid: string) => void;
  onSpecEdit: (sessionUid: string, exercise: ExerciseDraft, edit: SetSpecEdit) => void;
  onClearToRest: (sessionUid: string) => void;
};

export function SessionEditorModal({
  session,
  mode,
  defaultSurplusPercentage,
  onClose,
  onUpdateSession,
  onAddExercise,
  onRemoveExercise,
  onEditExercise,
  onReorderExercise,
  onSpecEdit,
  onClearToRest,
}: SessionEditorModalProps) {
  const editable = mode === "edit";
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!session || !over || active.id === over.id) return;
    onReorderExercise(session.uid, String(active.id), String(over.id));
  };

  return (
    <Dialog open={session != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        {session && (
          <>
            <DialogHeader>
              <DialogTitle className="sr-only">Edit session {session.name}</DialogTitle>
              <div className="grid grid-cols-2 gap-3 pr-8 sm:grid-cols-[1fr_1fr_120px_150px]">
                <label className={cn("flex flex-col gap-1", LABEL_CLASS)}>
                  Session name
                  <Input
                    key={`name-${session.uid}`}
                    disabled={!editable}
                    maxLength={100}
                    defaultValue={session.name}
                    className={cn("h-8 text-sm font-semibold", FOCUS_RING)}
                    onBlur={(e) => {
                      const value = e.target.value.trim() || session.name;
                      // Sync the DOM so a cleared field snaps back to the
                      // committed name instead of silently diverging.
                      e.target.value = value;
                      onUpdateSession(session.uid, { name: value });
                    }}
                  />
                </label>
                <label className={cn("flex flex-col gap-1", LABEL_CLASS)}>
                  Focus
                  <Input
                    key={`focus-${session.uid}`}
                    disabled={!editable}
                    maxLength={200}
                    defaultValue={session.focus ?? ""}
                    placeholder="e.g. Chest & triceps"
                    className={cn("h-8 text-xs", FOCUS_RING)}
                    onBlur={(e) =>
                      onUpdateSession(session.uid, {
                        focus: e.target.value.trim() || null,
                      })
                    }
                  />
                </label>
                <label className={cn("flex flex-col gap-1", LABEL_CLASS)}>
                  Duration min
                  <Input
                    key={`dur-${session.uid}`}
                    type="number"
                    min={0}
                    max={480}
                    disabled={!editable}
                    defaultValue={session.estimatedDurationMinutes ?? ""}
                    className={cn("h-8 text-center font-mono text-xs", FOCUS_RING)}
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      const n = raw === "" ? null : Number(raw);
                      const clamped =
                        n != null && Number.isFinite(n)
                          ? Math.min(480, Math.max(0, Math.round(n)))
                          : null;
                      e.target.value = clamped == null ? "" : String(clamped);
                      onUpdateSession(session.uid, {
                        estimatedDurationMinutes: clamped,
                      });
                    }}
                  />
                </label>
                <label className={cn("flex flex-col gap-1", LABEL_CLASS)}>
                  Calorie surplus %
                  <Input
                    key={`surplus-${session.uid}`}
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    disabled={!editable}
                    defaultValue={session.calorieSurplusPercentage ?? ""}
                    placeholder={
                      defaultSurplusPercentage != null
                        ? `Default ${defaultSurplusPercentage}%`
                        : "No default"
                    }
                    className={cn("h-8 text-center font-mono text-xs", FOCUS_RING)}
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      const n = raw === "" ? null : Number(raw);
                      const clamped =
                        n != null && Number.isFinite(n)
                          ? Math.min(100, Math.max(0, n))
                          : null;
                      e.target.value = clamped == null ? "" : String(clamped);
                      onUpdateSession(session.uid, {
                        calorieSurplusPercentage: clamped,
                      });
                    }}
                  />
                  <span className="text-[10px] font-normal normal-case tracking-normal text-[#93b0b4]">
                    Leave blank to use the program default
                  </span>
                </label>
              </div>
            </DialogHeader>

            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={session.exercises.map((e) => e.uid)}
                  strategy={verticalListSortingStrategy}
                >
                  {session.exercises.map((exercise) => (
                    <ExerciseCard
                      key={exercise.uid}
                      exercise={exercise}
                      mode={mode}
                      onEdit={(patch) => onEditExercise(session.uid, exercise.uid, patch)}
                      onSpecEdit={(edit) => onSpecEdit(session.uid, exercise, edit)}
                      onRemove={() => onRemoveExercise(session.uid, exercise.uid)}
                    />
                  ))}
                </SortableContext>
              </DndContext>
              {session.exercises.length === 0 && (
                <p className="py-4 text-center text-xs text-[#93b0b4]">
                  No exercises yet — add the first one below.
                </p>
              )}
              {editable && (
                <ExercisePicker
                  onPick={({ name, exerciseId }) =>
                    onAddExercise(session.uid, {
                      exerciseId,
                      name,
                      setSpecs: null,
                      sets: 3,
                      repsMin: 8,
                      repsMax: 12,
                      repsTarget: null,
                      rpeTarget: null,
                      percentage1rm: null,
                      tempo: null,
                      restSeconds: null,
                      supersetGroup: null,
                      isWarmup: false,
                      notes: null,
                      videoUrl: null,
                    })
                  }
                />
              )}
            </div>

            <DialogFooter className="items-center gap-2 sm:justify-between">
              {editable ? (
                <Button
                  variant="ghost"
                  className="text-destructive hover:bg-red-50 hover:text-destructive"
                  onClick={() => {
                    onClearToRest(session.uid);
                    onClose();
                  }}
                >
                  <Moon className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
                  Make this a rest day
                </Button>
              ) : (
                <span />
              )}
              <Button
                className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
                onClick={onClose}
              >
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
