"use client";

import { useState, useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { TrainingExerciseRow } from "../sessions/training-exercise-row";
import { AddExerciseDialog } from "../sessions/add-exercise-dialog";
import { Pencil, Check, Plus, Clock, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { TrainingEvent, TrainingSession } from "@/types/training";

type SessionDetailDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: TrainingSession | null;
  clientId: string;
  planId: string;
  sharedEventCount: number;
  onUpdate: () => void;
};

export function SessionDetailDrawer({
  open,
  onOpenChange,
  session,
  clientId,
  planId,
  sharedEventCount,
  onUpdate,
}: SessionDetailDrawerProps) {
  const { toast } = useToast();
  const [editMode, setEditMode] = useState(false);
  const [addExerciseOpen, setAddExerciseOpen] = useState(false);

  const isShared = sharedEventCount > 1;

  const handleExerciseUpdate = () => {
    onUpdate();
    if (isShared) {
      toast({
        title: `Session updated across all ${sharedEventCount} weeks using this session`,
      });
    }
  };

  if (!session) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[420px] sm:w-[480px] overflow-y-auto">
        <SheetHeader className="pb-4 border-b border-[rgba(13,148,136,0.08)]">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-[15px] font-semibold text-[#0c1a1e]">
              {session.name}
            </SheetTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditMode(!editMode)}
              className="h-7 text-[11px]"
            >
              {editMode ? (
                <>
                  <Check className="h-3 w-3 mr-1" /> Done
                </>
              ) : (
                <>
                  <Pencil className="h-3 w-3 mr-1" /> Edit
                </>
              )}
            </Button>
          </div>

          <div className="flex items-center gap-2 mt-1">
            {session.focus && (
              <span className="text-[11px] text-[#5a7d82] bg-[rgba(13,148,136,0.05)] px-1.5 py-0.5 rounded-[3px]">
                {session.focus}
              </span>
            )}
            {session.estimatedDurationMinutes && (
              <span className="flex items-center gap-1 text-[11px] text-[#93b0b4]">
                <Clock className="h-3 w-3" />
                {session.estimatedDurationMinutes}min
              </span>
            )}
          </div>
        </SheetHeader>

        {/* Shared session warning */}
        {isShared && (
          <div className="flex items-start gap-2 p-2.5 mt-3 bg-amber-50 rounded-[6px] border border-amber-200/50">
            <AlertCircle className="h-3.5 w-3.5 text-amber-600 mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-amber-800">
              This session is shared across {sharedEventCount} weeks. Edits will apply to all.
            </p>
          </div>
        )}

        {/* Exercises */}
        <div className="mt-4 space-y-1">
          {session.exercises.length === 0 ? (
            <p className="text-sm text-[#93b0b4] py-4 text-center">
              No exercises yet
            </p>
          ) : (
            session.exercises.map((exercise) => (
              <TrainingExerciseRow
                key={exercise.id}
                exercise={exercise}
                clientId={clientId}
                planId={planId}
                sessionId={session.id}
                editMode={editMode}
                onUpdate={handleExerciseUpdate}
              />
            ))
          )}
        </div>

        {/* Add exercise button */}
        {editMode && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3 w-full text-[12px]"
            onClick={() => setAddExerciseOpen(true)}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add Exercise
          </Button>
        )}

        <AddExerciseDialog
          clientId={clientId}
          planId={planId}
          sessionId={session.id}
          open={addExerciseOpen}
          onOpenChange={setAddExerciseOpen}
          onSuccess={handleExerciseUpdate}
        />
      </SheetContent>
    </Sheet>
  );
}
