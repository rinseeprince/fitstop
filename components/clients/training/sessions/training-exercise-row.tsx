"use client";

import { useState } from "react";
import type { TrainingExercise } from "@/types/training";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
};

export function TrainingExerciseRow({
  exercise,
  clientId,
  planId,
  sessionId,
  editMode,
  onUpdate,
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

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Parse reps target
      let repsMin: number | null = null;
      let repsMax: number | null = null;
      let repsTarget: string | null = editedExercise.repsTarget;

      const repsMatch = editedExercise.repsTarget?.match(/^(\d+)-(\d+)$/);
      if (repsMatch) {
        repsMin = parseInt(repsMatch[1]);
        repsMax = parseInt(repsMatch[2]);
        repsTarget = null;
      }

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
    } catch (error) {
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
    setIsDeleting(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/training/${planId}/sessions/${sessionId}/exercises/${exercise.id}`,
        { method: "DELETE" }
      );

      if (!res.ok) throw new Error("Failed to delete exercise");

      toast({ title: "Exercise deleted" });
      onUpdate();
    } catch (error) {
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
      <div className="grid grid-cols-12 gap-2 items-center px-2 py-2 bg-muted/50 rounded">
        <div className="col-span-4">
          <Input
            value={editedExercise.name}
            onChange={(e) => setEditedExercise({ ...editedExercise, name: e.target.value })}
            className="h-8 text-sm"
            placeholder="Exercise name"
          />
        </div>
        <div className="col-span-2 flex items-center gap-1">
          <Input
            value={editedExercise.sets}
            onChange={(e) =>
              setEditedExercise({ ...editedExercise, sets: parseInt(e.target.value) || 1 })
            }
            className="h-8 w-12 text-sm text-center"
            type="number"
            min={1}
            max={20}
          />
          <span className="text-xs">×</span>
          <Input
            value={editedExercise.repsTarget}
            onChange={(e) => setEditedExercise({ ...editedExercise, repsTarget: e.target.value })}
            className="h-8 w-16 text-sm text-center"
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
            className="h-8 text-sm text-center"
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
            className="h-8 text-sm text-center"
            placeholder="Rest (s)"
            type="number"
            min={0}
            max={600}
          />
        </div>
        <div className="col-span-2 flex justify-end gap-1">
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
    <div className="grid grid-cols-12 gap-2 items-center px-2 py-2 hover:bg-muted/30 rounded group">
      <div className="col-span-4 flex items-center gap-2">
        {exercise.isWarmup && (
          <Badge variant="outline" className="text-xs px-1">
            W
          </Badge>
        )}
        <span className="text-sm">{exercise.name}</span>
        {exercise.notes && (
          <span className="text-xs text-muted-foreground truncate max-w-[100px]" title={exercise.notes}>
            ({exercise.notes})
          </span>
        )}
      </div>
      <div className="col-span-2 text-center text-sm">
        {exercise.sets} × {formatReps()}
      </div>
      <div className="col-span-2 text-center text-sm text-muted-foreground">
        {exercise.rpeTarget ? `RPE ${exercise.rpeTarget}` : "-"}
      </div>
      <div className="col-span-2 text-center text-sm text-muted-foreground">{formatRest()}</div>
      <div className="col-span-2 flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {editMode && (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => setIsEditing(true)}
            >
              <Pencil className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isDeleting}
            >
              {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
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
}
