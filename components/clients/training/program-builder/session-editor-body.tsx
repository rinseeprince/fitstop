"use client";

import { useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ExerciseDraft, SessionDraft } from "./program-builder-types";
import type { SetSpecEdit } from "./use-set-spec-mutations";
import { defaultExerciseDraftFromCatalog } from "./program-builder-model";
import { ExerciseCard } from "./exercise-card";
import { AddExercisePopover } from "./add-exercise-popover";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { FOCUS_RING, LABEL_CLASS, MONO_INPUT_CLASS } from "./builder-tokens";

// Chrome-agnostic session editor body — the fields grid + per-set exercise
// authoring, shared by the click-to-edit Sheet and the routed create-blank
// slide-over. Edits write straight through to the draft (working-copy model:
// "Save program" on the page is the commit point). The per-session calorie
// surplus lives here — it overrides the program default and cascades to the
// client's nutrition at apply time (blank = inherit; never coerce blank to a
// number).
export type SessionEditorBodyProps = {
  session: SessionDraft;
  mode: "view" | "edit";
  // Session name + focus are TEMPLATE identity — read-only in the client editor
  // (false), editable in the program builder (default). The training itself
  // (exercises, sets, surplus, duration) stays editable either way.
  identityEditable?: boolean;
  /**
   * Which chrome this body is mounted in.
   *
   * `"hero"` — the redesigned 780px session-editor Sheet: a dark hero above
   * owns the session name and surplus, the body sits on #f4f7f6, and the
   * exercise cards are borderless because spacing separates them.
   * `"inline"` (default) — the three white-bodied surfaces that also share this
   * component (create-session slide-over, placed-session editor, standalone
   * Sessions editor). They keep the four-up field grid and bordered cards;
   * borderless white on a white body would vanish.
   */
  chrome?: "hero" | "inline";
  defaultSurplusPercentage: number | null;
  // Helper line under the surplus field. The default speaks program language;
  // the standalone Sessions-page editor overrides it (no program to inherit
  // a default from there).
  surplusHelpText?: string;
  onUpdateSession: (
    sessionUid: string,
    patch: Partial<Omit<SessionDraft, "uid" | "exercises">>,
  ) => void;
  onAddExercise: (sessionUid: string, exercise: Omit<ExerciseDraft, "uid">) => void;
  onRemoveExercise: (sessionUid: string, exerciseUid: string) => void;
  onEditExercise: (sessionUid: string, exerciseUid: string, patch: Partial<ExerciseDraft>) => void;
  onReorderExercise: (sessionUid: string, activeUid: string, overUid: string) => void;
  onSpecEdit: (sessionUid: string, exercise: ExerciseDraft, edit: SetSpecEdit) => void;
};

export function SessionEditorBody({
  session,
  mode,
  identityEditable = true,
  chrome = "inline",
  defaultSurplusPercentage,
  surplusHelpText = "Leave blank to use the program default",
  onUpdateSession,
  onAddExercise,
  onRemoveExercise,
  onEditExercise,
  onReorderExercise,
  onSpecEdit,
}: SessionEditorBodyProps) {
  const editable = mode === "edit";
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  // Accordion: ONE exercise open at a time, owned here rather than by each
  // card, so opening one collapses the other. Collapsing loses nothing — every
  // input commits to the shared draft on blur, and clicking another header
  // blurs the focused field first.
  const [openUid, setOpenUid] = useState<string | null>(null);

  // Exercises present when this session was first shown; anything appended
  // later was added by the coach right now and opens straight into per-set
  // authoring. Reset when the editor switches to a different session (uids
  // regenerate per seed, so a stale set would mark everything "new").
  const seenRef = useRef<{ sessionUid: string; uids: Set<string> } | null>(null);
  if (seenRef.current?.sessionUid !== session.uid) {
    seenRef.current = {
      sessionUid: session.uid,
      uids: new Set(session.exercises.map((e) => e.uid)),
    };
    if (openUid !== null) setOpenUid(null);
  }
  const added = session.exercises.find((e) => !seenRef.current!.uids.has(e.uid));
  if (added) {
    seenRef.current.uids.add(added.uid);
    if (openUid !== added.uid) setOpenUid(added.uid);
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onReorderExercise(session.uid, String(active.id), String(over.id));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
{chrome === "inline" ? (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr] lg:grid-cols-[1fr_1fr_110px_130px]">
        <label className={cn("flex flex-col gap-1", LABEL_CLASS)}>
          Session name
          <Input
            key={`name-${session.uid}`}
            disabled={!editable || !identityEditable}
            maxLength={100}
            defaultValue={session.name}
            className={cn("h-8 text-xs", FOCUS_RING)}
            onFocus={(e) => {
              // Select-all on focus so the coach types over the name without
              // deleting (a programmatic focus-on-open just highlights, never
              // wipes); blur reverts to the committed name if left blank.
              e.target.select();
            }}
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
            disabled={!editable || !identityEditable}
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
            className={cn(MONO_INPUT_CLASS, "h-8 text-xs", FOCUS_RING)}
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
            className={cn(MONO_INPUT_CLASS, "h-8 text-xs", FOCUS_RING)}
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
            {surplusHelpText}
          </span>
        </label>
      </div>
      ) : (
        // The hero above owns name + surplus; only focus and duration remain.
        <div className="mb-4 flex gap-3">
          <label className={cn("flex min-w-0 flex-1 flex-col gap-1", LABEL_CLASS)}>
            Focus
            <Input
              key={`focus-${session.uid}`}
              disabled={!editable || !identityEditable}
              maxLength={200}
              defaultValue={session.focus ?? ""}
              placeholder="e.g. Chest & triceps"
              className={cn("h-8 bg-white text-xs", FOCUS_RING)}
              onBlur={(e) =>
                onUpdateSession(session.uid, {
                  focus: e.target.value.trim() || null,
                })
              }
            />
          </label>
          <label className={cn("flex w-[110px] shrink-0 flex-col gap-1", LABEL_CLASS)}>
            Duration min
            <Input
              key={`dur-${session.uid}`}
              type="number"
              min={0}
              max={480}
              disabled={!editable}
              defaultValue={session.estimatedDurationMinutes ?? ""}
              className={cn(MONO_INPUT_CLASS, "h-8 bg-white text-xs", FOCUS_RING)}
              onBlur={(e) => {
                const raw = e.target.value.trim();
                const n = raw === "" ? null : Number(raw);
                const clamped =
                  n != null && Number.isFinite(n)
                    ? Math.min(480, Math.max(0, Math.round(n)))
                    : null;
                e.target.value = clamped == null ? "" : String(clamped);
                onUpdateSession(session.uid, { estimatedDurationMinutes: clamped });
              }}
            />
          </label>
        </div>
      )}

      <SectionLabel
        label="Exercises"
        meta={String(session.exercises.length)}
        actions={
          editable ? (
            <AddExercisePopover
              onPick={({ name, exerciseId }) =>
                onAddExercise(
                  session.uid,
                  defaultExerciseDraftFromCatalog({ name, exerciseId }),
                )
              }
            />
          ) : undefined
        }
      />

      {/* px-1, not pr-1: overflow-y-auto clips the X axis too (CSS forces the
          other axis away from `visible`), and focus rings draw OUTSIDE the
          element box — with no left padding a card's ring was shaved flat
          against the container edge. */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-1 pb-1">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={session.exercises.map((e) => e.uid)}
            strategy={verticalListSortingStrategy}
          >
            {session.exercises.map((exercise, i) => (
              <ExerciseCard
                key={exercise.uid}
                exercise={exercise}
                ordinal={i + 1}
                mode={mode}
                expanded={openUid === exercise.uid}
                onToggleExpanded={() =>
                  setOpenUid((uid) => (uid === exercise.uid ? null : exercise.uid))
                }
                bordered={chrome === "inline"}
                onEdit={(patch) => onEditExercise(session.uid, exercise.uid, patch)}
                onSpecEdit={(edit) => onSpecEdit(session.uid, exercise, edit)}
                onRemove={() => onRemoveExercise(session.uid, exercise.uid)}
              />
            ))}
          </SortableContext>
        </DndContext>
        {session.exercises.length === 0 && (
          <p className="py-4 text-center text-xs text-[#93b0b4]">
            No exercises yet — add the first one from the rail above.
          </p>
        )}
      </div>
    </div>
  );
}
