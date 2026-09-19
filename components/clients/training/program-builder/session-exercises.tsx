"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { sessionExercises } from "@/utils/exercise-groups";
import { exerciseGroupPlace, groupName, readsAsGroup } from "@/utils/exercise-group-display";
import type { ExerciseDraft, SessionDraft } from "./program-builder-types";
import type { SetSpecEdit } from "./use-set-spec-mutations";
import type { ExerciseDestination, GroupSettingsPatch, LinkFormat } from "./program-builder-groups";
import { defaultExerciseDraftFromCatalog } from "./program-builder-model";
import { AddExercisePopover } from "./add-exercise-popover";
import { ExerciseCard } from "./exercise-card";
import { ExerciseDragCopy } from "./exercise-drag-copy";
import { ExerciseGroupBlock } from "./exercise-group-block";
import type { DropLineEdge } from "./drop-line";
import {
  destinationOf,
  dropChangesSession,
  exerciseDropCollision,
  itemDropId,
  memberDropId,
  sameDestination,
  type ExerciseDragData,
} from "./exercise-drop";
import { LABEL_CLASS, TEXT_MUTED } from "./builder-tokens";

// The session editor's Exercises rail and list. A lone exercise is its card; a
// superset, circuit or linked straight sets, and a timed group of any size
// (AMRAP, EMOM, For time), is a heading over its cards on one rail. Exercise
// numbers count straight through the session. The host keys this by session,
// so opening another session starts it afresh: nothing open, nothing picked, no
// drag.
//
// Three local states, each owned here alone and each changed by one handler:
// - the open card (one at a time);
// - picking exercises to link, from the rail's Link button — into a superset
//   or circuit (two or more), or an AMRAP, EMOM or For time (one or more);
// - a drag: what is dragged and where it would land. A copy follows the
//   pointer above the page while the card or group stays in its place, dimmed,
//   so nothing in the scrolling list moves or grows; the landing place is drawn
//   as a line (exercise-drop.ts), and the drop is one edit of the draft.
// Every edit writes through to the host's draft.
export type SessionExercisesProps = {
  session: SessionDraft;
  mode: "view" | "edit";
  chrome: "hero" | "inline";
  onAddExercise: (sessionUid: string, exercise: Omit<ExerciseDraft, "uid">) => void;
  onRemoveExercise: (sessionUid: string, exerciseUid: string) => void;
  onEditExercise: (sessionUid: string, exerciseUid: string, patch: Partial<ExerciseDraft>) => void;
  onSpecEdit: (sessionUid: string, exercise: ExerciseDraft, edit: SetSpecEdit) => void;
  onLinkExercises: (sessionUid: string, exerciseUids: string[], format: LinkFormat) => void;
  onUnlinkGroup: (sessionUid: string, groupUid: string) => void;
  onMoveExercise: (sessionUid: string, exerciseUid: string, to: ExerciseDestination) => void;
  onMoveGroup: (sessionUid: string, groupUid: string, index: number) => void;
  onUpdateGroup: (sessionUid: string, groupUid: string, patch: GroupSettingsPatch) => void;
};

// `destination` is null while the pointer is over nowhere that takes the drag.
type Drop = { drag: ExerciseDragData; destination: ExerciseDestination | null };

const dragKey = (drag: ExerciseDragData) =>
  drag.type === "exercise" ? `exercise:${drag.exerciseUid}` : `group:${drag.groupUid}`;

const sameDrop = (a: Drop | null, b: Drop | null) =>
  a === b ||
  (a != null &&
    b != null &&
    dragKey(a.drag) === dragKey(b.drag) &&
    (a.destination === b.destination ||
      (a.destination != null &&
        b.destination != null &&
        sameDestination(a.destination, b.destination))));

const RAIL_TEXT_ACTION = cn(LABEL_CLASS, "text-[11px] transition-colors");
const MAKE_ACTION = cn(
  RAIL_TEXT_ACTION,
  "font-semibold text-[#0d9488] hover:text-[#0b7f75] disabled:cursor-not-allowed disabled:text-[#d5e0dd]",
);

// The timed formats Link makes, each from one exercise or more; a superset or
// circuit (two or more) is the first action and named by the count.
const TIMED_MAKES: ReadonlyArray<{ format: LinkFormat; label: string }> = [
  { format: "amrap", label: groupName("amrap", 1) },
  { format: "emom", label: groupName("emom", 1) },
  { format: "for_time", label: groupName("for_time", 1) },
];

export function SessionExercises({
  session,
  mode,
  chrome,
  onAddExercise,
  onRemoveExercise,
  onEditExercise,
  onSpecEdit,
  onLinkExercises,
  onUnlinkGroup,
  onMoveExercise,
  onMoveGroup,
  onUpdateGroup,
}: SessionExercisesProps) {
  const editable = mode === "edit";
  const exercises = sessionExercises(session);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Accordion: ONE exercise open at a time, owned here rather than by each
  // card, so opening one collapses the other. Collapsing loses nothing — every
  // input commits to the shared draft on blur, and clicking another header
  // blurs the focused field first.
  const [openUid, setOpenUid] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);

  // Exercises present when this session was first shown; one appended later
  // was added by the coach right now and opens straight into per-set authoring.
  const seenRef = useRef<Set<string> | null>(null);
  if (seenRef.current === null) seenRef.current = new Set(exercises.map((e) => e.uid));
  const added = exercises.find((e) => !seenRef.current!.has(e.uid));
  if (added) {
    seenRef.current.add(added.uid);
    if (openUid !== added.uid) setOpenUid(added.uid);
  }

  const picking = editable && picked != null;
  const livePicked = picking ? picked.filter((uid) => exercises.some((e) => e.uid === uid)) : [];

  const togglePick = (uid: string) =>
    setPicked((current) =>
      current == null
        ? current
        : current.includes(uid)
          ? current.filter((u) => u !== uid)
          : [...current, uid],
    );

  const handleDragStart = (event: DragStartEvent) => {
    const drag = event.active.data.current as ExerciseDragData | undefined;
    setDrop(drag ? { drag, destination: null } : null);
  };

  const handleDragMove = (event: DragMoveEvent) => {
    const drag = event.active.data.current as ExerciseDragData | undefined;
    const next = drag ? { drag, destination: destinationOf(event.collisions) } : null;
    setDrop((current) => (sameDrop(current, next) ? current : next));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const drag = event.active.data.current as ExerciseDragData | undefined;
    const destination = destinationOf(event.collisions);
    setDrop(null);
    if (!drag || !destination) return;
    if (drag.type === "exercise") {
      onMoveExercise(session.uid, drag.exerciseUid, destination);
    } else if (destination.kind === "session") {
      onMoveGroup(session.uid, drag.groupUid, destination.index);
    }
  };

  // Only a drop that does something draws its line.
  const line =
    drop?.destination && dropChangesSession(session, drop.drag, drop.destination)
      ? drop.destination
      : null;
  const itemLine = (index: number): DropLineEdge | null => {
    if (line?.kind !== "session") return null;
    if (line.index === index) return index === 0 ? "first-item-top" : "item-top";
    return line.index === session.groups.length && index === session.groups.length - 1
      ? "item-bottom"
      : null;
  };
  const memberLine = (groupUid: string, position: number, size: number): DropLineEdge | null => {
    if (line?.kind !== "group" || line.groupUid !== groupUid) return null;
    if (line.index === position) return "member-top";
    return line.index === size && position === size - 1 ? "member-bottom" : null;
  };

  const linkName = groupName("circuit", Math.max(2, livePicked.length)).toLowerCase();
  // One click makes the group and ends the picking: the draft edit and the
  // local state land in one handler, so nothing renders between them.
  const make = (format: LinkFormat) => {
    onLinkExercises(session.uid, livePicked, format);
    setPicked(null);
  };
  const rail = picking ? (
    <div className="flex items-center gap-3">
      <button
        type="button"
        className={cn(RAIL_TEXT_ACTION, "hover:text-[#0d9488]")}
        onClick={() => setPicked(null)}
      >
        Cancel
      </button>
      <button
        type="button"
        disabled={livePicked.length < 2}
        className={MAKE_ACTION}
        onClick={() => make("circuit")}
      >
        Make {linkName}
      </button>
      {TIMED_MAKES.map(({ format, label }) => (
        <button
          key={format}
          type="button"
          disabled={livePicked.length < 1}
          className={MAKE_ACTION}
          onClick={() => make(format)}
        >
          Make {label}
        </button>
      ))}
    </div>
  ) : editable ? (
    <div className="flex items-center gap-3">
      <button
        type="button"
        aria-label="Link exercises"
        title="Link exercises into a superset, circuit, AMRAP, EMOM or For time"
        disabled={exercises.length < 1}
        className={cn(
          "rounded p-1 transition-colors hover:text-[#0d9488] disabled:cursor-not-allowed disabled:opacity-50",
          TEXT_MUTED,
        )}
        onClick={() => {
          setPicked([]);
          setOpenUid(null);
        }}
      >
        <Link2 className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>
      <AddExercisePopover
        onPick={(pick) => {
          onAddExercise(session.uid, defaultExerciseDraftFromCatalog(pick));
          // The card joins the end of a list that may be scrolled out of view,
          // so the add is confirmed where the coach is looking (owner,
          // 2026-09-19). The popover stays open for the next pick.
          toast.success("Exercise added", { description: pick.name });
        }}
      />
    </div>
  ) : undefined;

  let ordinal = 0;
  const card = (
    exercise: ExerciseDraft,
    roundsAreRows: boolean,
    dropTarget: Parameters<typeof ExerciseCard>[0]["drop"],
    dropLine: DropLineEdge | null,
  ) => {
    ordinal += 1;
    return (
      <ExerciseCard
        key={exercise.uid}
        exercise={exercise}
        ordinal={ordinal}
        mode={mode}
        expanded={openUid === exercise.uid}
        onToggleExpanded={() => setOpenUid((uid) => (uid === exercise.uid ? null : exercise.uid))}
        bordered={chrome === "inline"}
        roundsAreRows={roundsAreRows}
        drop={dropTarget}
        dropLine={dropLine}
        pick={
          picking
            ? { picked: livePicked.includes(exercise.uid), onToggle: () => togglePick(exercise.uid) }
            : null
        }
        onEdit={(patch) => onEditExercise(session.uid, exercise.uid, patch)}
        onSpecEdit={(edit) => onSpecEdit(session.uid, exercise, edit)}
        onRemove={() => onRemoveExercise(session.uid, exercise.uid)}
      />
    );
  };

  return (
    <>
      <SectionLabel
        label="Exercises"
        meta={picking ? `${livePicked.length} selected` : String(exercises.length)}
        actions={rail}
      />

      {/* px-1, not pr-1: overflow-y-auto clips the X axis too (CSS forces the
          other axis away from `visible`), and focus rings draw OUTSIDE the
          element box — with no left padding a card's ring was shaved flat
          against the container edge. pb-2 leaves room for the drop line
          under the last card. */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-1 pb-2">
        <DndContext
          sensors={sensors}
          collisionDetection={exerciseDropCollision}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDrop(null)}
        >
          {session.groups.map((group, index) => {
            if (!readsAsGroup(group)) {
              return card(
                group.exercises[0],
                false,
                { id: itemDropId(group.uid), data: { type: "item", index, linked: false } },
                itemLine(index),
              );
            }
            return (
              <ExerciseGroupBlock
                key={group.uid}
                group={group}
                index={index}
                editable={editable}
                picking={picking}
                dropLine={itemLine(index)}
                onUpdate={(patch) => onUpdateGroup(session.uid, group.uid, patch)}
                onUnlink={() => onUnlinkGroup(session.uid, group.uid)}
              >
                {group.exercises.map((exercise, position) =>
                  card(
                    exercise,
                    exerciseGroupPlace(group, position).roundsAreRows,
                    {
                      id: memberDropId(exercise.uid),
                      data: { type: "member", groupUid: group.uid, index: position },
                    },
                    memberLine(group.uid, position, group.exercises.length),
                  ),
                )}
              </ExerciseGroupBlock>
            );
          })}
          {/* Portaled to <body>, like the week grid's: an animated or
              transformed ancestor (the sheet, the tray) would become the
              containing block for the copy's fixed position and offset it.
              Mounted only during a drag, so the copy goes in the same render
              the drop lands in: a DragOverlay left mounted keeps its last
              frame until its drop animation resolves, even with none. */}
          {drop &&
            createPortal(
              <DragOverlay>
                <ExerciseDragCopy session={session} drag={drop.drag} />
              </DragOverlay>,
              document.body,
            )}
        </DndContext>
        {exercises.length === 0 && (
          <p className="py-4 text-center text-xs text-[#93b0b4]">
            No exercises yet — add the first one from the rail above.
          </p>
        )}
      </div>
    </>
  );
}
