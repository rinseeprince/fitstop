"use client";

import { useState, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { TrainingExerciseRow } from "../sessions/training-exercise-row";
import { AddExerciseDialog } from "../sessions/add-exercise-dialog";
import { Pencil, Check, Plus, Clock, Save, Loader2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { TrainingSession, TrainingExercise } from "@/types/training";

type SessionDetailDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: TrainingSession | null;
  eventId?: string;
  clientId: string;
  planId: string;
  sharedEventCount: number;
  onUpdate: () => void;
  onSelectSession?: (sessionId: string, eventId: string) => void;
};

export function SessionDetailDrawer({
  open,
  onOpenChange,
  session,
  eventId,
  clientId,
  planId,
  sharedEventCount,
  onUpdate,
  onSelectSession,
}: SessionDetailDrawerProps) {
  const { toast } = useToast();
  const [editMode, setEditMode] = useState(false);
  const [addExerciseOpen, setAddExerciseOpen] = useState(false);
  const [isSavingToLibrary, setIsSavingToLibrary] = useState(false);

  // Local exercise state for shared session editing
  const [localExercises, setLocalExercises] = useState<TrainingExercise[]>([]);
  const [showSaveScope, setShowSaveScope] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const isShared = sharedEventCount > 1;
  const isLocalEdit = isShared && editMode;

  // Which exercises to render
  const displayExercises = isLocalEdit ? localExercises : (session?.exercises ?? []);

  const handleSaveToLibrary = async () => {
    if (!session) return;
    const name = prompt("Save to library as:", session.name);
    if (!name?.trim()) return;

    setIsSavingToLibrary(true);
    try {
      const res = await fetch("/api/training/saved-sessions/from-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceSessionId: session.id, name: name.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }
      toast({ title: "Saved to library", description: `"${name.trim()}" saved as a standalone session` });
    } catch (error) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Failed to save session",
        variant: "destructive",
      });
    } finally {
      setIsSavingToLibrary(false);
    }
  };

  const enterEditMode = () => {
    if (!session) return;
    if (isShared) {
      // Initialize local state from current exercises
      setLocalExercises([...session.exercises]);
    }
    setEditMode(true);
  };

  const exitEditMode = () => {
    setEditMode(false);
    setLocalExercises([]);
  };

  // --- Local edit callbacks (shared sessions only) ---

  const handleLocalUpdate = useCallback((exerciseId: string, updates: Partial<TrainingExercise>) => {
    setLocalExercises((prev) =>
      prev.map((ex) => (ex.id === exerciseId ? { ...ex, ...updates } : ex))
    );
  }, []);

  const handleLocalDelete = useCallback((exerciseId: string) => {
    setLocalExercises((prev) => prev.filter((ex) => ex.id !== exerciseId));
  }, []);

  const handleLocalAdd = useCallback((exerciseData: {
    name: string;
    sets: number;
    repsMin?: number;
    repsMax?: number;
    repsTarget?: string;
    rpeTarget?: number;
    restSeconds?: number;
    notes?: string;
    isWarmup: boolean;
  }) => {
    const newExercise: TrainingExercise = {
      id: crypto.randomUUID(),
      sessionId: session?.id ?? "",
      exerciseId: null,
      name: exerciseData.name,
      orderIndex: localExercises.length,
      sets: exerciseData.sets,
      repsMin: exerciseData.repsMin,
      repsMax: exerciseData.repsMax,
      repsTarget: exerciseData.repsTarget,
      rpeTarget: exerciseData.rpeTarget,
      restSeconds: exerciseData.restSeconds,
      notes: exerciseData.notes,
      isWarmup: exerciseData.isWarmup,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setLocalExercises((prev) => [...prev, newExercise]);
  }, [localExercises.length, session?.id]);

  // --- Non-shared exercise update callback ---

  const handleExerciseUpdate = () => {
    onUpdate();
    if (isShared) {
      toast({
        title: `Session updated across all ${sharedEventCount} weeks using this session`,
      });
    }
  };

  // --- Save scope handlers (shared sessions) ---

  const buildExercisePayload = () =>
    localExercises.map((ex, i) => ({
      name: ex.name,
      sets: ex.sets,
      orderIndex: i,
      exerciseId: ex.exerciseId ?? undefined,
      repsMin: ex.repsMin ?? undefined,
      repsMax: ex.repsMax ?? undefined,
      repsTarget: ex.repsTarget ?? undefined,
      rpeTarget: ex.rpeTarget ?? undefined,
      restSeconds: ex.restSeconds ?? undefined,
      tempo: ex.tempo ?? undefined,
      percentage1rm: ex.percentage1rm ?? undefined,
      supersetGroup: ex.supersetGroup ?? undefined,
      isWarmup: ex.isWarmup,
      notes: ex.notes ?? undefined,
    }));

  const handleSaveJustThisDay = async () => {
    if (!session || !eventId) return;
    setIsSaving(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/training/${planId}/sessions/${session.id}/clone`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId,
            exercises: buildExercisePayload(),
          }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }
      const { newSessionId } = await res.json();

      toast({ title: "Saved for this day only" });
      setShowSaveScope(false);
      exitEditMode();
      onUpdate();
      onSelectSession?.(newSessionId, eventId);
    } catch (error) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Failed to save",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAllOccurrences = async () => {
    if (!session) return;
    setIsSaving(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/training/${planId}/sessions/${session.id}/exercises`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ exercises: buildExercisePayload() }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }

      toast({ title: `Saved across all ${sharedEventCount} weeks` });
      setShowSaveScope(false);
      exitEditMode();
      onUpdate();
    } catch (error) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Failed to save",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (!session) return null;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) exitEditMode(); onOpenChange(o); }}>
      <SheetContent side="right" className="w-[420px] sm:w-[480px] overflow-y-auto">
        <SheetHeader className="pb-4 border-b border-[rgba(13,148,136,0.08)]">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-[15px] font-semibold text-[#0c1a1e]">
              {session.name}
            </SheetTitle>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleSaveToLibrary()}
                disabled={isSavingToLibrary || editMode}
                className="h-7 text-[11px]"
              >
                <Save className="h-3 w-3 mr-1" /> Save to Library
              </Button>
              {!editMode ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={enterEditMode}
                  className="h-7 text-[11px]"
                >
                  <Pencil className="h-3 w-3 mr-1" /> Edit
                </Button>
              ) : isShared ? (
                // Shared session: Cancel button (Save is in footer)
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exitEditMode}
                  className="h-7 text-[11px]"
                >
                  <X className="h-3 w-3 mr-1" /> Cancel
                </Button>
              ) : (
                // Non-shared session: Done button
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exitEditMode}
                  className="h-7 text-[11px]"
                >
                  <Check className="h-3 w-3 mr-1" /> Done
                </Button>
              )}
            </div>
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

        {/* Spacer when no banner */}

        {/* Exercises */}
        <div className="mt-4 space-y-1">
          {displayExercises.length === 0 ? (
            <p className="text-sm text-[#93b0b4] py-4 text-center">
              No exercises yet
            </p>
          ) : (
            displayExercises.map((exercise) => (
              <TrainingExerciseRow
                key={exercise.id}
                exercise={exercise}
                clientId={clientId}
                planId={planId}
                sessionId={session.id}
                editMode={editMode}
                onUpdate={handleExerciseUpdate}
                onLocalUpdate={isLocalEdit ? handleLocalUpdate : undefined}
                onLocalDelete={isLocalEdit ? handleLocalDelete : undefined}
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

        {/* Save button for shared sessions */}
        {isLocalEdit && (
          <Button
            className="mt-4 w-full"
            onClick={() => setShowSaveScope(true)}
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            Save Changes
          </Button>
        )}

        <AddExerciseDialog
          clientId={clientId}
          planId={planId}
          sessionId={session.id}
          open={addExerciseOpen}
          onOpenChange={setAddExerciseOpen}
          onSuccess={handleExerciseUpdate}
          onLocalAdd={isLocalEdit ? handleLocalAdd : undefined}
        />
      </SheetContent>

      {/* Save scope dialog */}
      <Dialog open={showSaveScope} onOpenChange={setShowSaveScope}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Save Changes</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This session is used across {sharedEventCount} weeks. Where should these changes apply?
          </p>
          <div className="space-y-2 py-2">
            <button
              className="w-full flex items-center gap-3 p-3 rounded-[6px] border border-[rgba(13,148,136,0.08)] cursor-pointer hover:bg-[rgba(13,148,136,0.03)] transition-colors text-left"
              onClick={() => void handleSaveJustThisDay()}
              disabled={isSaving}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin text-teal-600 flex-shrink-0" />
              ) : (
                <div className="h-4 w-4 rounded-full border-2 border-teal-600 flex-shrink-0" />
              )}
              <div>
                <p className="text-sm font-medium text-[#0c1a1e]">Just this day</p>
                <p className="text-[11px] text-muted-foreground">Create a copy with your changes for this date only</p>
              </div>
            </button>
            <button
              className="w-full flex items-center gap-3 p-3 rounded-[6px] border border-[rgba(13,148,136,0.08)] cursor-pointer hover:bg-[rgba(13,148,136,0.03)] transition-colors text-left"
              onClick={() => void handleSaveAllOccurrences()}
              disabled={isSaving}
            >
              <div className="h-4 w-4 rounded-full border-2 border-[#93b0b4] flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-[#0c1a1e]">All occurrences</p>
                <p className="text-[11px] text-muted-foreground">Apply changes to all {sharedEventCount} weeks</p>
              </div>
            </button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveScope(false)} disabled={isSaving}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}
