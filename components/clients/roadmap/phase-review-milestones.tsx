"use client";

import { Check } from "lucide-react";
import type { Milestone } from "@/types/roadmap";

type PhaseReviewMilestonesProps = {
  milestones: Milestone[];
  onChange: (milestones: Milestone[]) => void;
};

export function PhaseReviewMilestones({
  milestones,
  onChange,
}: PhaseReviewMilestonesProps) {
  if (milestones.length === 0) return null;

  const completedCount = milestones.filter((m) => m.completed).length;

  const toggle = (index: number) => {
    const updated = milestones.map((m, i) => {
      if (i !== index) return m;
      const nowCompleted = !m.completed;
      return {
        ...m,
        completed: nowCompleted,
        completed_at: nowCompleted ? new Date().toISOString() : null,
      };
    });
    onChange(updated);
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#93b0b4]">
          Milestones
        </span>
        <span className="rounded-[6px] bg-[rgba(13,148,136,0.05)] px-1.5 py-0.5 text-[11px] font-medium text-[#0d9488]">
          {completedCount}/{milestones.length}
        </span>
      </div>

      <div className="space-y-1.5">
        {milestones.map((milestone, index) => (
          <button
            key={milestone.id}
            type="button"
            onClick={() => toggle(index)}
            className="flex w-full items-center gap-2.5 rounded-[6px] px-1 py-1.5 text-left transition-colors hover:bg-[rgba(13,148,136,0.03)]"
          >
            <div
              className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors ${
                milestone.completed
                  ? "border-[#0d9488] bg-[#0d9488]"
                  : "border-[rgba(13,148,136,0.3)] bg-transparent"
              }`}
            >
              {milestone.completed && (
                <Check className="h-3 w-3 text-white" strokeWidth={3} />
              )}
            </div>
            <span
              className={`text-[13px] leading-snug ${
                milestone.completed
                  ? "text-[#93b0b4] line-through"
                  : "text-[#0c1a1e]"
              }`}
            >
              {milestone.text}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
