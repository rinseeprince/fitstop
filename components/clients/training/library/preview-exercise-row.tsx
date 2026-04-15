"use client";

import { useState } from "react";
import { GripVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SavedExercise } from "@/types/training";

type PreviewExerciseRowProps = {
  exercise: SavedExercise;
  onUpdate: (updates: Partial<SavedExercise>) => void;
  onRemove: () => void;
};

export function PreviewExerciseRow({
  exercise,
  onUpdate,
  onRemove,
}: PreviewExerciseRowProps) {
  const [isEditing, setIsEditing] = useState(false);

  const formatReps = () => {
    if (exercise.repsTarget) return exercise.repsTarget;
    if (exercise.repsMin && exercise.repsMax) return `${exercise.repsMin}-${exercise.repsMax}`;
    if (exercise.repsMin) return `${exercise.repsMin}`;
    return "-";
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-2 bg-muted/30 rounded-md">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 flex-shrink-0" />
        <Input
          className="h-7 text-xs flex-1"
          defaultValue={exercise.name}
          onBlur={(e) => {
            onUpdate({ name: e.target.value });
            setIsEditing(false);
          }}
          autoFocus
        />
        <Input
          className="h-7 text-xs w-12 text-center"
          type="number"
          defaultValue={exercise.sets}
          onBlur={(e) => onUpdate({ sets: parseInt(e.target.value) || 3 })}
        />
        <Input
          className="h-7 text-xs w-16 text-center"
          defaultValue={exercise.repsTarget || `${exercise.repsMin || ""}-${exercise.repsMax || ""}`}
          onBlur={(e) => onUpdate({ repsTarget: e.target.value })}
        />
        <Input
          className="h-7 text-xs w-12 text-center"
          type="number"
          defaultValue={exercise.rpeTarget ?? ""}
          placeholder="RPE"
          onBlur={(e) => onUpdate({ rpeTarget: e.target.value ? parseFloat(e.target.value) : null })}
        />
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onRemove}>
          <Trash2 className="h-3 w-3 text-destructive" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2 py-1.5 px-2 hover:bg-muted/20 rounded-md cursor-pointer group"
      onClick={() => setIsEditing(true)}
    >
      <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 flex-shrink-0" />
      <span className="text-xs flex-1 truncate">{exercise.name}</span>
      <span className="text-xs text-muted-foreground w-8 text-center">{exercise.sets}x</span>
      <span className="text-xs text-muted-foreground w-14 text-center">{formatReps()}</span>
      {exercise.rpeTarget && (
        <span className="text-xs text-muted-foreground w-10 text-center">@{exercise.rpeTarget}</span>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 opacity-0 group-hover:opacity-100"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
      >
        <Trash2 className="h-3 w-3 text-destructive" />
      </Button>
    </div>
  );
}
