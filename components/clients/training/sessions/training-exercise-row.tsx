"use client";

import { memo, useState } from "react";
import type { TrainingExercise } from "@/types/training";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Check, X, Pencil, Loader2 } from "lucide-react";

type TrainingExerciseRowProps = {
  exercise: TrainingExercise;
  clientId: string;
  planId: string;
  sessionId: string;
  editMode: boolean;
  onUpdate: () => void;
  onLocalUpdate?: (exerciseId: string, updates: Partial<TrainingExercise>) => void;
  onLocalDelete?: (exerciseId: string) => void;
};

export const TrainingExerciseRow = memo(function TrainingExerciseRow({
  exercise,
  clientId,
  planId,
  sessionId,
  editMode,
  onUpdate,
  onLocalUpdate,
  onLocalDelete,
}: TrainingExerciseRowProps) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editedExercise, setEditedExercise] = useState({
    name: exercise.name,
    sets: exercise.sets,
    repsTarget: exercise.repsTarget || `${exercise.repsMin || 8}-${exercise.repsMax || 12}`,
    rpeTarget: exercise.rpeTarget,
    restSeconds: exercise.restSeconds,
  });

  const parseReps = () => {
    let repsMin: number | null = null;
    let repsMax: number | null = null;
    let repsTarget: string | null = editedExercise.repsTarget;

    const repsMatch = editedExercise.repsTarget?.match(/^(\d+)-(\d+)$/);
    if (repsMatch) {
      repsMin = parseInt(repsMatch[1]);
      repsMax = parseInt(repsMatch[2]);
      repsTarget = null;
    }
    return { repsMin, repsMax, repsTarget };
  };

  const handleSave = async () => {
    const { repsMin, repsMax, repsTarget } = parseReps();

    // Local mode: update state directly, no API call
    if (onLocalUpdate) {
      onLocalUpdate(exercise.id, {
        name: editedExercise.name,
        sets: editedExercise.sets,
        repsMin: repsMin ?? undefined,
        repsMax: repsMax ?? undefined,
        repsTarget: repsTarget ?? undefined,
        rpeTarget: editedExercise.rpeTarget || undefined,
        restSeconds: editedExercise.restSeconds || undefined,
      });
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/training/${planId}/sessions/${sessionId}/exercises/${exercise.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: editedExercise.name,
            sets: editedExercise.sets,
            repsMin,
            repsMax,
            repsTarget,
            rpeTarget: editedExercise.rpeTarget || null,
            restSeconds: editedExercise.restSeconds || null,
          }),
        }
      );

      if (!res.ok) throw new Error("Failed to update exercise");

      toast({ title: "Exercise updated" });
      setIsEditing(false);
      onUpdate();
    } catch (_error) {
      toast({
        title: "Error",
        description: "Failed to update exercise",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    // Local mode: remove from state directly
    if (onLocalDelete) {
      onLocalDelete(exercise.id);
      setShowDeleteConfirm(false);
      return;
    }

    setIsDeleting(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/training/${planId}/sessions/${sessionId}/exercises/${exercise.id}`,
        { method: "DELETE" }
      );

      if (!res.ok) throw new Error("Failed to delete exercise");

      toast({ title: "Exercise deleted" });
      onUpdate();
    } catch (_error) {
      toast({
        title: "Error",
        description: "Failed to delete exercise",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const formatReps = () => {
    if (exercise.repsTarget) return exercise.repsTarget;
    if (exercise.repsMin && exercise.repsMax) {
      return exercise.repsMin === exercise.repsMax
        ? `${exercise.repsMin}`
        : `${exercise.repsMin}-${exercise.repsMax}`;
    }
    return "-";
  };

  const formatRest = () => {
    if (!exercise.restSeconds) return "-";
    if (exercise.restSeconds >= 60) {
      const mins = Math.floor(exercise.restSeconds / 60);
      const secs = exercise.restSeconds % 60;
      return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    }
    return `${exercise.restSeconds}s`;
  };

  if (isEditing && editMode) {
    return (
      <div className="grid grid-cols-12 gap-2 items-center px-3 py-3 bg-[rgba(13,148,136,0.05)] rounded-[6px]">
        {/* Name is read-only — to change the exercise, delete this row and add a new one from the catalog. */}
        <div className="col-span-4 flex items-center gap-2 min-w-0">
          {exercise.isWarmup && (
            <span className="text-[10px] uppercase tracking-[0.06em] font-medium text-[#5a7d82] bg-[rgba(13,148,136,0.05)] px-1.5 py-0.5 rounded-[3px] flex-shrink-0">
              W
            </span>
          )}
          <span
            className="text-[13px] font-medium text-[#0c1a1e] truncate"
            title={exercise.name}
          >
            {exercise.name}
          </span>
        </div>
        <div className="col-span-3 flex items-center gap-1 min-w-0">
          <Input
            value={editedExercise.sets}
            onChange={(e) =>
              setEditedExercise({ ...editedExercise, sets: parseInt(e.target.value) || 1 })
            }
            className="h-8 flex-1 min-w-0 px-1.5 text-[13px] text-center font-mono-display"
            type="number"
            min={1}
            max={20}
          />
          <span className="text-[11px] text-[#5a7d82] shrink-0">×</span>
          <Input
            value={editedExercise.repsTarget}
            onChange={(e) => setEditedExercise({ ...editedExercise, repsTarget: e.target.value })}
            className="h-8 flex-[1.5] min-w-0 px-1.5 text-[13px] text-center font-mono-display"
            placeholder="8-12"
          />
        </div>
        <div className="col-span-2">
          <Input
            value={editedExercise.rpeTarget || ""}
            onChange={(e) =>
              setEditedExercise({
                ...editedExercise,
                rpeTarget: e.target.value ? parseFloat(e.target.value) : undefined,
              })
            }
            className="h-8 px-2 text-[13px] text-center font-mono-display"
            placeholder="RPE"
            type="number"
            min={1}
            max={10}
            step={0.5}
          />
        </div>
        <div className="col-span-2">
          <Input
            value={editedExercise.restSeconds || ""}
            onChange={(e) =>
              setEditedExercise({
                ...editedExercise,
                restSeconds: e.target.value ? parseInt(e.target.value) : undefined,
              })
            }
            className="h-8 px-2 text-[13px] text-center font-mono-display"
            placeholder="Rest (s)"
            type="number"
            min={0}
            max={600}
          />
        </div>
        <div className="col-span-1 flex justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={() => setIsEditing(false)}
            disabled={isSaving}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-12 gap-2 items-center px-3 py-3 hover:bg-[rgba(13,148,136,0.03)] rounded-[6px] group transition-colors">
      <div className="col-span-4 flex items-center gap-2 min-w-0">
        {exercise.isWarmup && (
          <span className="text-[10px] uppercase tracking-[0.06em] font-medium text-[#5a7d82] bg-[rgba(13,148,136,0.05)] px-1.5 py-0.5 rounded-[3px] flex-shrink-0">
            W
          </span>
        )}
        <span className="text-[13px] font-medium text-[#0c1a1e] truncate" title={exercise.name}>
          {exercise.name}
        </span>
        {exercise.notes && (
          <span className="text-[11px] text-[#93b0b4] truncate max-w-[100px]" title={exercise.notes}>
            ({exercise.notes})
          </span>
        )}
      </div>
      <div className="col-span-3 text-center text-[13px] font-mono-display text-[#5a7d82]">
        {exercise.sets} × {formatReps()}
      </div>
      <div className="col-span-2 text-center text-[13px] font-mono-display text-[#5a7d82]">
        {exercise.rpeTarget ? `RPE ${exercise.rpeTarget}` : "—"}
      </div>
      <div className="col-span-2 text-center text-[13px] font-mono-display text-[#5a7d82]">
        {formatRest()}
      </div>
      <div className="col-span-1 flex justify-end gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
        {editMode && (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              aria-label={`Edit ${exercise.name}`}
              onClick={() => setIsEditing(true)}
            >
              <Pencil className="h-3 w-3" aria-hidden="true" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
              aria-label={`Delete ${exercise.name}`}
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="h-3 w-3" aria-hidden="true" />
              )}
            </Button>
          </>
        )}
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete Exercise"
        description={`Are you sure you want to delete "${exercise.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        destructive
      />
    </div>
  );
});
