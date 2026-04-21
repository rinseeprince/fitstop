"use client";

import { useState, memo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WorkoutTemplatePicker } from "../schedule/workout-template-picker";
import { SessionList } from "../sessions/session-list";
import { PreGenerationActivities } from "../../activities/pre-generation-activities";
import { SameDayTrainingCheckbox } from "./same-day-training-checkbox";
import { PlanNameInput } from "./plan-name-input";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import { cn } from "@/lib/utils";
import { Plus, LayoutTemplate, PencilRuler, Moon } from "lucide-react";

type ManualWorkoutBuilderProps = {
  clientWeightKg: number;
};

export const ManualWorkoutBuilder = memo(function ManualWorkoutBuilder({
  clientWeightKg,
}: ManualWorkoutBuilderProps) {
  const builder = useTrainingBuilderContext();
  const [newSessionName, setNewSessionName] = useState("");

  const handleAddSession = () => {
    const trimmed = newSessionName.trim();
    if (!trimmed) return;
    builder.addManualSession({
      tempId: crypto.randomUUID(),
      name: trimmed,
      exercises: [],
    });
    setNewSessionName("");
  };

  const handleAddRestDay = () => {
    builder.addManualSession({
      tempId: crypto.randomUUID(),
      name: "Rest",
      isRest: true,
      exercises: [],
    });
  };

  return (
    <div className="space-y-5">
      {/* Mode Toggle */}
      <div className="bg-[rgba(13,148,136,0.05)] rounded-[6px] p-[2px] inline-flex w-full">
        <button
          onClick={() => builder.setManualMode("template")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-1.5 px-3 text-[13px] font-medium rounded-[4px] transition-all",
            builder.manualMode === "template"
              ? "bg-white text-[#0c1a1e] shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
              : "text-[#5a7d82] hover:text-[#0c1a1e]"
          )}
        >
          <LayoutTemplate className={cn("h-4 w-4", builder.manualMode === "template" && "text-[#0d9488]")} />
          From Template
        </button>
        <button
          onClick={() => builder.setManualMode("scratch")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-1.5 px-3 text-[13px] font-medium rounded-[4px] transition-all",
            builder.manualMode === "scratch"
              ? "bg-white text-[#0c1a1e] shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
              : "text-[#5a7d82] hover:text-[#0c1a1e]"
          )}
        >
          <PencilRuler className={cn("h-4 w-4", builder.manualMode === "scratch" && "text-[#0d9488]")} />
          From Scratch
        </button>
      </div>

      {/* Plan Name */}
      <PlanNameInput
        value={builder.planName}
        onChange={builder.setPlanName}
        placeholder={
          builder.manualMode === "template"
            ? "Plan name (uses template name if blank)"
            : "Plan name"
        }
        helpText={
          builder.manualMode === "scratch"
            ? "Give this plan a name you'll recognise in Saved Plans."
            : undefined
        }
      />

      {/* Template Selection or From Scratch Builder */}
      {builder.manualMode === "template" ? (
        <WorkoutTemplatePicker
          selectedTemplate={builder.selectedTemplate}
          onSelect={builder.applyTemplate}
        />
      ) : (
        <div className="space-y-4">
          {/* Add Session or Rest Day */}
          <div className="flex gap-2">
            <Input
              value={newSessionName}
              onChange={(e) => setNewSessionName(e.target.value)}
              placeholder="Session name (e.g., Push Day)"
              onKeyDown={(e) => e.key === "Enter" && handleAddSession()}
              className="flex-1"
            />
            <Button
              onClick={handleAddSession}
              disabled={!newSessionName.trim()}
              className="bg-[#0d9488] hover:bg-[#0a7c72] text-white"
            >
              <Plus className="h-4 w-4 mr-1" />
              Session
            </Button>
            <Button
              onClick={handleAddRestDay}
              variant="outline"
              className="border-[rgba(13,148,136,0.2)] text-[#5a7d82] hover:bg-[rgba(13,148,136,0.04)] hover:text-[#0c1a1e]"
            >
              <Moon className="h-4 w-4 mr-1" />
              Rest Day
            </Button>
          </div>

          {/* Sessions List (no inline exercise editing — that happens in DraftEditor) */}
          <SessionList
            sessions={builder.manualSessions}
            onUpdateSession={builder.updateManualSession}
            onRemoveSession={builder.removeManualSession}
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
    </div>
  );
});
