"use client";

import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExerciseSearchInput } from "../../shared/exercise-search-input";
import { Trash2, GripVertical } from "lucide-react";
import type { ManualSessionDraft, ManualExerciseDraft } from "@/types/training";

type SessionListProps = {
  sessions: ManualSessionDraft[];
  onUpdateSession: (tempId: string, updates: Partial<ManualSessionDraft>) => void;
  onRemoveSession: (tempId: string) => void;
  onAddExercise: (sessionTempId: string, exerciseName: string) => void;
  onUpdateExercise: (sessionTempId: string, exerciseTempId: string, updates: Partial<ManualExerciseDraft>) => void;
  onRemoveExercise: (sessionTempId: string, exerciseTempId: string) => void;
};

export const SessionList = memo(function SessionList({
  sessions,
  onUpdateSession,
  onRemoveSession,
  onAddExercise,
  onUpdateExercise,
  onRemoveExercise,
}: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-slate-500">
        Add your first training session above
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {sessions.map((session) => (
        <div
          key={session.tempId}
          className="border rounded-lg bg-white overflow-hidden"
        >
          {/* Session Header */}
          <div className="flex items-center gap-2 p-3 bg-slate-50 border-b">
            <GripVertical className="h-4 w-4 text-slate-400" />
            <Input
              value={session.name}
              onChange={(e) => onUpdateSession(session.tempId, { name: e.target.value })}
              className="flex-1 h-8 font-medium"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRemoveSession(session.tempId)}
              className="text-red-500 hover:text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          {/* Exercises */}
          <div className="p-3 space-y-2">
            {session.exercises.map((exercise) => (
              <div
                key={exercise.tempId}
                className="flex items-center gap-2 text-sm"
              >
                <span className="flex-1 truncate">{exercise.name}</span>
                <Input
                  type="number"
                  value={exercise.sets}
                  onChange={(e) =>
                    onUpdateExercise(session.tempId, exercise.tempId, {
                      sets: parseInt(e.target.value) || 3,
                    })
                  }
                  className="w-14 h-7 text-center"
                  min={1}
                  max={20}
                />
                <span className="text-slate-400">x</span>
                <Input
                  value={exercise.repsTarget || ""}
                  onChange={(e) =>
                    onUpdateExercise(session.tempId, exercise.tempId, {
                      repsTarget: e.target.value,
                    })
                  }
                  placeholder="8-12"
                  className="w-16 h-7 text-center"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemoveExercise(session.tempId, exercise.tempId)}
                  className="h-7 w-7 p-0 text-slate-400 hover:text-red-500"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}

            {/* Add Exercise */}
            <ExerciseSearchInput
              onSelect={(name) => onAddExercise(session.tempId, name)}
            />
          </div>
        </div>
      ))}
    </div>
  );
});
