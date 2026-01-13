"use client";

import { workoutTemplates } from "@/lib/training-suggestions";
import { cn } from "@/lib/utils";
import { Dumbbell, Calendar, ChevronRight, Check } from "lucide-react";
import type { WorkoutTemplate } from "@/types/training";

type WorkoutTemplatePickerProps = {
  selectedTemplate: WorkoutTemplate | null;
  onSelect: (template: WorkoutTemplate) => void;
};

const splitTypeLabels: Record<string, string> = {
  push_pull_legs: "Push/Pull/Legs",
  upper_lower: "Upper/Lower",
  full_body: "Full Body",
  bro_split: "Body Part Split",
  push_pull: "Push/Pull",
  custom: "Custom",
};

export function WorkoutTemplatePicker({ selectedTemplate, onSelect }: WorkoutTemplatePickerProps) {
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-muted-foreground">Choose a template</div>
      <div className="grid gap-3">
        {workoutTemplates.map((template) => {
          const isSelected = selectedTemplate?.id === template.id;
          return (
            <button
              key={template.id}
              onClick={() => onSelect(template)}
              className={cn(
                "w-full text-left p-4 rounded-lg border transition-all",
                "hover:shadow-md hover:border-primary/50",
                isSelected
                  ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                  : "border-border bg-white hover:bg-muted/50"
              )}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium text-foreground">{template.name}</h4>
                    {isSelected && (
                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary">
                        <Check className="h-3 w-3 text-primary-foreground" />
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{template.description}</p>
                  <div className="flex items-center gap-4 mt-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Dumbbell className="h-3.5 w-3.5" />
                      {splitTypeLabels[template.splitType]}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5" />
                      {template.frequency} days/week
                    </div>
                  </div>
                </div>
                <ChevronRight
                  className={cn(
                    "h-5 w-5 transition-colors",
                    isSelected ? "text-primary" : "text-muted-foreground"
                  )}
                />
              </div>

              {/* Session preview */}
              {isSelected && (
                <div className="mt-4 pt-4 border-t border-primary/20">
                  <div className="text-xs font-medium text-primary mb-2">Sessions included:</div>
                  <div className="flex flex-wrap gap-2">
                    {template.sessions.map((session, idx) => (
                      <span
                        key={idx}
                        className="text-xs px-2 py-1 rounded bg-white border border-primary/20 text-foreground"
                      >
                        {session.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
