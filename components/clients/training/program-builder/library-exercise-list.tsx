"use client";

import { useMemo, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { Dumbbell, GripVertical, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useExerciseCatalog } from "@/hooks/use-exercise-catalog";
import { filterExercisesByQuery } from "@/lib/exercise-search";
import { ExerciseFormDialog } from "@/components/programs/exercise-form-dialog";
import { RowActions } from "@/components/programs/shared/row-actions";
import type { Exercise } from "@/types/training";
import type { LibraryExerciseDragData } from "./use-program-dnd";
import {
  FOCUS_RING,
  MONO_LABEL_CLASS,
  TEXT_MUTED,
  TEXT_PRIMARY,
  THUMB_CLASS,
  TRAINING_CARD_BORDER,
} from "./builder-tokens";

// Exercises tab of the builder library panel (S4.5). Grip-only draggable
// catalog cards that append to an occupied day-cell's session on drop, plus
// coach-owned CRUD (edit/delete + New exercise) reachable per card — the
// retired Exercises page's job, folded in here. Edit/Delete render only on
// coach-owned rows (coachId != null); global catalog rows are read-only.
function LibraryExerciseCard({
  exercise,
  editable,
  onEdit,
  onDelete,
}: {
  exercise: Exercise;
  editable: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const dragData: LibraryExerciseDragData = { type: "library-exercise", exercise };
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `libex-${exercise.id}`,
    data: dragData,
    // Drops append to a session — a grid mutation, so edit-mode only. Edit/
    // Delete below stay reachable in both modes.
    disabled: !editable,
  });
  const isCustom = exercise.coachId != null;
  const meta = [exercise.muscleGroup, exercise.equipment]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group/row flex items-center gap-2 rounded-[6px] bg-white p-2 pl-1.5 transition-all",
        TRAINING_CARD_BORDER,
        isDragging && "opacity-40",
        "hover:-translate-y-px hover:shadow-[0_6px_20px_rgba(13,148,136,0.08)]",
      )}
    >
      <button
        type="button"
        aria-label={`Drag ${exercise.name}`}
        className={cn(
          "shrink-0 rounded",
          editable ? "cursor-grab active:cursor-grabbing" : "cursor-default",
          TEXT_MUTED,
        )}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>
      <span className={cn(THUMB_CLASS, "h-[30px] w-[30px]")}>
        <Dumbbell className="h-[15px] w-[15px]" strokeWidth={1.5} />
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-xs font-semibold", TEXT_PRIMARY)}>
          {exercise.name}
        </div>
        {meta && (
          <div className={cn("mt-0.5 truncate capitalize", MONO_LABEL_CLASS, "normal-case tracking-normal")}>
            {meta}
          </div>
        )}
      </div>
      {isCustom && (
        <RowActions
          actions={[
            { label: "Edit", icon: Pencil, onClick: onEdit },
            { label: "Delete", icon: Trash2, danger: true, onClick: onDelete },
          ]}
        />
      )}
    </div>
  );
}

export function LibraryExerciseList({ editable }: { editable: boolean }) {
  const { toast } = useToast();
  const { exercises, isLoading, mutate } = useExerciseCatalog();
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Exercise | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Exercise | null>(null);

  const handleDelete = async (exercise: Exercise) => {
    try {
      const res = await fetch(`/api/training/exercises/${exercise.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast({ title: "Exercise deleted" });
      await mutate();
    } catch {
      toast({
        title: "Error",
        description: "Failed to delete exercise",
        variant: "destructive",
      });
    }
  };

  // The catalog is 1000+ rows and every card is a dnd-kit draggable — rendering
  // them all tanks the browser and breaks dragging. So we render a CAP: with no
  // query, the 10 most-recently-added exercises; while searching, the top
  // matches. The search bar is the escape hatch for everything else.
  const RECENT_LIMIT = 10;
  const SEARCH_LIMIT = 25;
  const hasQuery = query.trim().length > 0;
  const matches = useMemo(
    () => filterExercisesByQuery(exercises, query),
    [exercises, query],
  );
  const recent = useMemo(
    () =>
      [...exercises]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, RECENT_LIMIT),
    [exercises],
  );
  const visible = hasQuery ? matches.slice(0, SEARCH_LIMIT) : recent;
  const moreCount =
    (hasQuery ? matches.length : exercises.length) - visible.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 px-[18px]">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#93b0b4]"
            strokeWidth={1.5}
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search exercises"
            aria-label="Search exercises"
            className={cn("h-8 pl-8 text-xs", FOCUS_RING)}
          />
        </div>
      </div>

      {editable && (
        <div className={cn("px-[18px] pb-1.5", MONO_LABEL_CLASS)}>
          Drag an exercise into a session
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-[14px] pb-2">
        {isLoading ? (
          <p className={cn("py-4 text-center text-xs", TEXT_MUTED)}>Loading…</p>
        ) : visible.length === 0 ? (
          <p className={cn("px-1 py-4 text-center text-xs", TEXT_MUTED)}>
            {exercises.length === 0
              ? "No exercises yet — create one below."
              : "No exercises match your search."}
          </p>
        ) : (
          <>
            {visible.map((exercise) => (
              <LibraryExerciseCard
                key={exercise.id}
                exercise={exercise}
                editable={editable}
                onEdit={() => {
                  setEditTarget(exercise);
                  setFormOpen(true);
                }}
                onDelete={() => setDeleteTarget(exercise)}
              />
            ))}
            {moreCount > 0 && (
              <p className={cn("px-1 pt-1 text-center text-[11px]", TEXT_MUTED)}>
                {hasQuery
                  ? `+${moreCount} more — refine your search`
                  : `${exercises.length} in your catalog — search to find any`}
              </p>
            )}
          </>
        )}
      </div>

      <div className="border-t border-[rgba(13,148,136,0.08)] px-[18px] py-3">
        <button
          type="button"
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[6px] border border-dashed border-[rgba(13,148,136,0.25)] text-xs font-medium text-[#5a7d82] transition-colors hover:border-[#0d9488] hover:bg-[rgba(13,148,136,0.05)] hover:text-[#0a5c55]"
          onClick={() => {
            setEditTarget(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} /> New exercise
        </button>
      </div>

      <ExerciseFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditTarget(null);
        }}
        exercise={editTarget}
        onSaved={() => void mutate()}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete this exercise?"
        description={`"${deleteTarget?.name ?? ""}" will be removed from your catalog. Prescriptions that reference it keep the name but lose the catalog link (and its analytics grouping).`}
        confirmLabel="Delete exercise"
        destructive
        onConfirm={() => {
          if (deleteTarget) void handleDelete(deleteTarget);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
