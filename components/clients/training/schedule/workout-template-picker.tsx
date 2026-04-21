"use client";

import { workoutTemplates } from "@/lib/training-suggestions";
import { cn } from "@/lib/utils";
import { Dumbbell, Calendar, Check } from "lucide-react";
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
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#5a7d82]">
        Choose a template
      </h3>
      <div className="space-y-2">
        {workoutTemplates.map((template) => {
          const isSelected = selectedTemplate?.id === template.id;
          return (
            <button
              key={template.id}
              onClick={() => onSelect(template)}
              className={cn(
                "w-full text-left px-4 py-3 rounded-[6px] border transition-all",
                isSelected
                  ? "border-[rgba(13,148,136,0.3)] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
                  : "border-[rgba(13,148,136,0.08)] bg-white hover:border-[rgba(13,148,136,0.25)] hover:shadow-[0_1px_4px_rgba(0,0,0,0.04)]"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-[13.5px] font-semibold text-[#0c1a1e] truncate">
                      {template.name}
                    </h4>
                    {isSelected && (
                      <span className="flex items-center justify-center w-[18px] h-[18px] rounded-full bg-[#0d9488] flex-shrink-0">
                        <Check className="h-3 w-3 text-white" strokeWidth={2.5} />
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-[#5a7d82] mt-1 leading-[1.4]">
                    {template.description}
                  </p>
                  <div className="flex items-center gap-3 mt-2.5">
                    <span className="inline-flex items-center gap-1 text-[11px] text-[#93b0b4]">
                      <Dumbbell className="h-3 w-3" strokeWidth={1.8} />
                      {splitTypeLabels[template.splitType]}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] text-[#93b0b4]">
                      <Calendar className="h-3 w-3" strokeWidth={1.8} />
                      {template.frequency} days/week
                    </span>
                  </div>
                </div>
              </div>

              {isSelected && (
                <div className="mt-3 pt-3 border-t border-[rgba(13,148,136,0.08)]">
                  <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[#0d9488] mb-2">
                    Sessions included
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {template.sessions.map((session, idx) => (
                      <span
                        key={idx}
                        className="text-[11px] px-2 py-0.5 rounded-[4px] bg-[rgba(13,148,136,0.06)] border border-[rgba(13,148,136,0.12)] text-[#0c1a1e]"
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
