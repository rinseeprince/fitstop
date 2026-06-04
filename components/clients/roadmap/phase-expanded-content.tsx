"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import { Skeleton } from "@/components/ui/skeleton";
import { Flag, Circle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PhaseWeeklyTable } from "./phase-weekly-table";
import type { Phase, Milestone, PhaseWeeklyDataRow } from "@/types/roadmap";

type PhaseExpandedContentProps = {
  phase: Phase;
  clientId: string;
  weightUnit: "lbs" | "kg";
  onMutate: () => void;
  isReadOnly?: boolean;
};

type WeeklyDataResponse = {
  success: boolean;
  data: PhaseWeeklyDataRow[];
};

export const PhaseExpandedContent = ({
  phase,
  clientId,
  weightUnit,
  onMutate,
  isReadOnly = false,
}: PhaseExpandedContentProps) => {
  const { toast } = useToast();
  const { data: weeklyResponse, isLoading: weeklyLoading } =
    useSWR<WeeklyDataResponse>(
      `/api/clients/${clientId}/roadmap/phases/${phase.id}/weekly-data`,
      swrFetcher,
      { revalidateOnFocus: false }
    );

  const [localMilestones, setLocalMilestones] = useState<Milestone[]>(
    phase.milestones ?? []
  );

  useEffect(() => {
    setLocalMilestones(phase.milestones ?? []);
  }, [phase.milestones]);

  const completedCount = localMilestones.filter((m) => m.completed).length;
  const hasDescOrObj = phase.description || phase.objectives;

  const handleToggleMilestone = async (milestoneId: string) => {
    const previous = localMilestones;
    const updated = localMilestones.map((m) =>
      m.id === milestoneId
        ? {
            ...m,
            completed: !m.completed,
            completed_at: !m.completed ? new Date().toISOString() : null,
          }
        : m
    );

    setLocalMilestones(updated);

    try {
      const res = await fetch(
        `/api/clients/${clientId}/roadmap/phases/${phase.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ milestones: updated }),
        }
      );
      if (!res.ok) throw new Error("Failed to update milestone");
      onMutate();
    } catch {
      setLocalMilestones(previous);
      toast({ title: "Failed to toggle milestone", variant: "destructive" });
    }
  };

  return (
    <div className="border-t border-[rgba(13,148,136,0.08)] animate-in fade-in duration-300">
      {/* Description & Objectives */}
      {hasDescOrObj && (
        <div className="px-4 py-3 border-b border-[rgba(13,148,136,0.08)]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {phase.description && (
              <div>
                <p className="text-[10px] uppercase text-[#93b0b4] tracking-[0.06em] font-semibold mb-1">
                  Description
                </p>
                <p className="text-[12.5px] text-[#0c1a1e] whitespace-pre-wrap">
                  {phase.description}
                </p>
              </div>
            )}
            {phase.objectives && (
              <div>
                <p className="text-[10px] uppercase text-[#93b0b4] tracking-[0.06em] font-semibold mb-1">
                  Objectives
                </p>
                <p className="text-[12.5px] text-[#0c1a1e] whitespace-pre-wrap">
                  {phase.objectives}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Milestones */}
      <div className="px-4 py-3 border-b border-[rgba(13,148,136,0.08)]">
        <div className="flex items-center gap-2 mb-2">
          <Flag className="h-3.5 w-3.5 text-[#93b0b4]" />
          <span className="text-[10px] uppercase text-[#93b0b4] tracking-[0.06em] font-semibold">
            Milestones
          </span>
          {localMilestones.length > 0 && (
            <span className="text-[10px] font-semibold bg-[rgba(13,148,136,0.05)] text-[#0d9488] px-1.5 py-0.5 rounded-[6px]">
              {completedCount}/{localMilestones.length}
            </span>
          )}
        </div>
        {localMilestones.length === 0 ? (
          <p className="text-[12.5px] italic text-[#93b0b4]">No milestones</p>
        ) : (
          <ul className="space-y-1.5">
            {localMilestones.map((m) => (
              <li
                key={m.id}
                className={`flex items-start gap-2 ${
                  isReadOnly ? "" : "cursor-pointer group"
                }`}
                onClick={
                  isReadOnly ? undefined : () => handleToggleMilestone(m.id)
                }
              >
                {m.completed ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#0d9488] mt-0.5" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-[#93b0b4] group-hover:text-[#0d9488] mt-0.5 transition-colors" />
                )}
                <span
                  className={`text-[12.5px] ${
                    m.completed
                      ? "line-through text-[#93b0b4]"
                      : "text-[#0c1a1e]"
                  }`}
                >
                  {m.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Weekly Check-ins */}
      <div className="px-4 py-3">
        <p className="text-[10px] uppercase text-[#93b0b4] tracking-[0.06em] font-semibold mb-2">
          Weekly Check-ins
        </p>
        {weeklyLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full rounded-[6px] bg-[rgba(13,148,136,0.04)]" />
            <Skeleton className="h-4 w-full rounded-[6px] bg-[rgba(13,148,136,0.04)]" />
            <Skeleton className="h-4 w-3/4 rounded-[6px] bg-[rgba(13,148,136,0.04)]" />
          </div>
        ) : (
          <PhaseWeeklyTable
            data={weeklyResponse?.data ?? []}
            weightUnit={weightUnit}
          />
        )}
      </div>
    </div>
  );
};
