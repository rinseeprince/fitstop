"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PreviewExerciseRow } from "./preview-exercise-row";
import type { SavedSession, SavedExercise } from "@/types/training";

type PreviewSessionCardProps = {
  session: SavedSession;
  defaultSurplus: number;
  onUpdateSession: (updates: Partial<SavedSession>) => void;
  onRemoveSession: () => void;
  onUpdateExercise: (exerciseId: string, updates: Partial<SavedExercise>) => void;
  onRemoveExercise: (exerciseId: string) => void;
  onAddExercise: () => void;
};

export function PreviewSessionCard({
  session,
  defaultSurplus,
  onUpdateSession,
  onRemoveSession,
  onUpdateExercise,
  onRemoveExercise,
  onAddExercise,
}: PreviewSessionCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const surplusValue = session.calorieSurplusPercentage ?? defaultSurplus;

  if (session.isRest) {
    return (
      <div className="flex items-center justify-between py-2 px-3 bg-muted/30 rounded-lg border border-dashed border-muted-foreground/20">
        <span className="text-xs text-muted-foreground font-medium">Rest Day</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onRemoveSession}>
          <Trash2 className="h-3 w-3 text-destructive" />
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
      {/* Session header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-muted/30">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </Button>

        {editingName ? (
          <Input
            className="h-7 text-sm font-medium flex-1"
            defaultValue={session.name}
            onBlur={(e) => {
              onUpdateSession({ name: e.target.value });
              setEditingName(false);
            }}
            autoFocus
          />
        ) : (
          <span
            className="text-sm font-medium flex-1 cursor-pointer hover:text-primary"
            onClick={() => setEditingName(true)}
          >
            {session.name}
          </span>
        )}

        {session.focus && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {session.focus}
          </Badge>
        )}

        {/* Surplus % input */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">+</span>
          <Input
            className="h-6 w-12 text-xs text-center px-1"
            type="number"
            value={surplusValue}
            onChange={(e) => {
              const val = e.target.value === "" ? null : parseFloat(e.target.value);
              onUpdateSession({ calorieSurplusPercentage: val });
            }}
          />
          <span className="text-[10px] text-muted-foreground">%</span>
        </div>

        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onRemoveSession}>
          <Trash2 className="h-3 w-3 text-destructive" />
        </Button>
      </div>

      {/* Exercise list */}
      {expanded && (
        <div className="px-2 py-1.5 space-y-0.5">
          {session.exercises.map((exercise) => (
            <PreviewExerciseRow
              key={exercise.id}
              exercise={exercise}
              onUpdate={(updates) => onUpdateExercise(exercise.id, updates)}
              onRemove={() => onRemoveExercise(exercise.id)}
            />
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-7 text-xs text-muted-foreground hover:text-primary mt-1"
            onClick={onAddExercise}
          >
            <Plus className="h-3 w-3 mr-1" /> Add Exercise
          </Button>
        </div>
      )}
    </div>
  );
}
