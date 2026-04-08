"use client";

import { useState, memo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WorkoutTemplatePicker } from "../schedule/workout-template-picker";
import { SessionList } from "../sessions/session-list";
import { PreGenerationActivities } from "../../activities/pre-generation-activities";
import { SameDayTrainingCheckbox } from "./same-day-training-checkbox";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import { cn } from "@/lib/utils";
import { Plus, Loader2, Save, LayoutTemplate, PencilRuler } from "lucide-react";
import type { ManualExerciseDraft } from "@/types/training";

type ManualWorkoutBuilderProps = {
  clientWeightKg: number;
};

export const ManualWorkoutBuilder = memo(function ManualWorkoutBuilder({
  clientWeightKg
}: ManualWorkoutBuilderProps) {
  const builder = useTrainingBuilderContext();
  const [newSessionName, setNewSessionName] = useState("");

  const handleAddSession = () => {
    if (!newSessionName.trim()) return;
    builder.addManualSession({
      tempId: crypto.randomUUID(),
      name: newSessionName.trim(),
      exercises: [],
    });
    setNewSessionName("");
  };

  const handleAddExercise = (sessionTempId: string, exerciseName: string) => {
    const session = builder.manualSessions.find((s) => s.tempId === sessionTempId);
    if (!session) return;

    const newExercise: ManualExerciseDraft = {
      tempId: crypto.randomUUID(),
      name: exerciseName,
      sets: 3,
      repsTarget: "8-12",
    };

    builder.updateManualSession(sessionTempId, {
      exercises: [...session.exercises, newExercise],
    });
  };

  const handleUpdateExercise = (
    sessionTempId: string,
    exerciseTempId: string,
    updates: Partial<ManualExerciseDraft>
  ) => {
    const session = builder.manualSessions.find((s) => s.tempId === sessionTempId);
    if (!session) return;

    builder.updateManualSession(sessionTempId, {
      exercises: session.exercises.map((e) =>
        e.tempId === exerciseTempId ? { ...e, ...updates } : e
      ),
    });
  };

  const handleRemoveExercise = (sessionTempId: string, exerciseTempId: string) => {
    const session = builder.manualSessions.find((s) => s.tempId === sessionTempId);
    if (!session) return;

    builder.updateManualSession(sessionTempId, {
      exercises: session.exercises.filter((e) => e.tempId !== exerciseTempId),
    });
  };

  return (
    <div className="space-y-5">
      {/* Mode Toggle */}
      <div className="flex p-1 bg-muted rounded-lg">
        <button
          onClick={() => builder.setManualMode("template")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded text-sm font-medium transition-all",
            builder.manualMode === "template"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <LayoutTemplate className="h-4 w-4" />
          From Template
        </button>
        <button
          onClick={() => builder.setManualMode("scratch")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded text-sm font-medium transition-all",
            builder.manualMode === "scratch"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <PencilRuler className="h-4 w-4" />
          From Scratch
        </button>
      </div>

      {/* Template Selection or From Scratch Builder */}
      {builder.manualMode === "template" ? (
        <WorkoutTemplatePicker
          selectedTemplate={builder.selectedTemplate}
          onSelect={builder.applyTemplate}
        />
      ) : (
        <div className="space-y-4">
          {/* Add New Session */}
          <div className="flex gap-2">
            <Input
              value={newSessionName}
              onChange={(e) => setNewSessionName(e.target.value)}
              placeholder="New session name (e.g., Push Day)"
              onKeyDown={(e) => e.key === "Enter" && handleAddSession()}
            />
            <Button onClick={handleAddSession} disabled={!newSessionName.trim()}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {/* Sessions List */}
          <SessionList
            sessions={builder.manualSessions}
            onUpdateSession={builder.updateManualSession}
            onRemoveSession={builder.removeManualSession}
            onAddExercise={handleAddExercise}
            onUpdateExercise={handleUpdateExercise}
            onRemoveExercise={handleRemoveExercise}
          />
        </div>
      )}

      {/* External Activities */}
      <PreGenerationActivities
        activities={builder.preGenerationActivities}
        onAddActivity={builder.addPreGenActivity}
        onRemoveActivity={builder.removePreGenActivity}
        clientWeightKg={clientWeightKg}
      />

      <SameDayTrainingCheckbox />

      {/* Save Button */}
      {builder.manualSessions.length > 0 && (
        <Button
          onClick={() => builder.saveManualPlan()}
          disabled={builder.isSavingManual || builder.phaseBlocked}
          className="w-full bg-primary hover:bg-primary/90"
          size="lg"
        >
          {builder.isSavingManual ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          {builder.isSavingManual ? "Saving..." : "Save Training Plan"}
        </Button>
      )}
    </div>
  );
});
