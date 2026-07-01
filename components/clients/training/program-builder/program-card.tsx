"use client";

import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SavedPlan } from "@/types/training";

// Library browse card for /dashboard/programs. Click opens the builder —
// there is deliberately NO apply-to-client here (assignment happens from the
// client's training planner, Phase 5).
type ProgramCardProps = {
  plan: SavedPlan;
  onOpen: () => void;
  onDelete: () => void;
};

export function ProgramCard({ plan, onOpen, onDelete }: ProgramCardProps) {
  const totalCount = plan.sessions?.length ?? 0;
  const trainingCount = plan.sessions?.filter((s) => !s.isRest).length ?? 0;
  const weekCount =
    (plan.sessions ?? []).reduce((max, s) => Math.max(max, s.weekIndex), 0) + 1;

  return (
    <div
      className="group cursor-pointer rounded-[6px] bg-white p-4 transition-all hover:-translate-y-px hover:shadow-[0_6px_20px_rgba(13,148,136,0.08)]"
      onClick={onOpen}
    >
      <div className="mb-2 flex items-start justify-between">
        <h3 className="line-clamp-1 text-sm font-semibold text-[#0c1a1e]">
          {plan.name}
        </h3>
        <Button
          variant="ghost"
          size="icon"
          className="-mr-1 -mt-1 h-6 w-6 opacity-0 group-hover:opacity-100"
          aria-label="Delete program"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="h-3 w-3 text-destructive" strokeWidth={1.5} />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="border-transparent bg-[rgba(13,148,136,0.08)] text-[10px] font-medium text-[#0d9488] hover:bg-[rgba(13,148,136,0.08)]">
          {weekCount} {weekCount === 1 ? "week" : "weeks"}
        </Badge>
        <Badge
          variant="outline"
          className="border-[rgba(13,148,136,0.12)] text-[10px] text-[#5a7d82]"
        >
          {trainingCount} sessions
        </Badge>
        {plan.splitType && (
          <Badge
            variant="outline"
            className="border-[rgba(13,148,136,0.12)] text-[10px] text-[#5a7d82]"
          >
            {plan.splitType.replace(/_/g, " ")}
          </Badge>
        )}
        {plan.source === "ai" && (
          <Badge
            variant="outline"
            className="border-[rgba(13,148,136,0.12)] text-[10px] text-[#5a7d82]"
          >
            ai
          </Badge>
        )}
      </div>
      {plan.description && (
        <p className="mt-2 line-clamp-2 text-xs text-[#5a7d82]">
          {plan.description}
        </p>
      )}
      <div className="mt-2 text-[10px] text-[#93b0b4]">
        {totalCount} day slots ({totalCount - trainingCount} rest)
      </div>
    </div>
  );
}
