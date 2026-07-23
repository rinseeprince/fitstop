"use client";

import { cn } from "@/lib/utils";
import {
  HEADER_EYEBROW_CLASS,
  LABEL_CLASS,
  MONO,
  STAT_LABEL_DARK_CLASS,
  STAT_VALUE_DARK_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { Phase, RoadmapStatus } from "@/types/roadmap";

type RoadmapSummaryStripProps = {
  roadmapName: string;
  roadmapStatus: RoadmapStatus;
  startedAt?: string;
  targetEndDate?: string;
  phases: Phase[];
  startWeight: number | null;
  currentWeight: number | null;
  goalWeight: number | null;
  weightUnit: "lbs" | "kg";
};

function StatColumn({
  label,
  value,
  sub,
  subColor,
  isLast,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  subColor?: string;
  isLast?: boolean;
}) {
  return (
    <div
      className={
        isLast
          ? "flex flex-col pl-5"
          : "flex flex-col pl-5 pr-5 border-r border-[rgba(255,255,255,0.07)]"
      }
    >
      <p className={STAT_LABEL_DARK_CLASS}>
        {label}
      </p>
      <p className={cn(STAT_VALUE_DARK_CLASS, "text-[26px] leading-tight mt-1")}>
        {value}
      </p>
      {sub && (
        <div className={`text-[11px] mt-1 ${subColor ?? "text-[rgba(255,255,255,0.3)]"}`}>
          {sub}
        </div>
      )}
    </div>
  );
}

export function RoadmapSummaryStrip({
  roadmapName,
  roadmapStatus,
  startedAt,
  targetEndDate,
  phases,
  startWeight,
  currentWeight,
  goalWeight,
  weightUnit,
}: RoadmapSummaryStripProps) {
  const completedCount = phases.filter((p) => p.status === "completed").length;

  // Weight delta (both in display units)
  const delta =
    currentWeight != null && startWeight != null
      ? currentWeight - startWeight
      : null;

  // Distance to goal
  const toGo =
    goalWeight != null && currentWeight != null
      ? Math.abs(goalWeight - currentWeight)
      : null;

  return (
    <div className="bg-[#0f2027] rounded-[6px] p-5 animate-card-in">
      {/* Top: programme name + status */}
      <div className="flex items-center justify-between">
        <div>
          <p className={HEADER_EYEBROW_CLASS}>
            Active Programme
          </p>
          <h2 className="text-[22px] font-bold text-white mt-0.5">
            {roadmapName}
          </h2>
        </div>
        {roadmapStatus === "active" && (
          <span className={cn(LABEL_CLASS, "inline-flex items-center gap-1.5 rounded-[6px] bg-[#0d9488] px-2 py-0.5 font-semibold text-white")}>
            <span className="w-1.5 h-1.5 rounded-full bg-white" />
            Active
          </span>
        )}
      </div>

      {/* Progress bar */}
      {phases.length > 0 && (
        <div className="mt-4">
          <div className="flex gap-1">
            {phases.map((phase) => (
              <div
                key={phase.id}
                className="h-1.5 rounded-full flex-1"
                style={{
                  background:
                    phase.status === "completed" || phase.status === "active"
                      ? "linear-gradient(90deg, #0d9488, #0fb9ac)"
                      : "rgba(255,255,255,0.1)",
                }}
              />
            ))}
          </div>
          {(startedAt || targetEndDate) && (
            <div className="flex justify-between mt-1.5">
              <span className={cn(MONO, "text-[11px] text-[rgba(255,255,255,0.3)]")}>
                {startedAt ?? ""}
              </span>
              <span className={cn(MONO, "text-[11px] text-[rgba(255,255,255,0.3)]")}>
                {targetEndDate ?? ""}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-4 mt-4 pt-4 border-t border-[rgba(255,255,255,0.06)]">
        <StatColumn
          label="Start Weight"
          value={startWeight != null ? startWeight.toFixed(1) : "—"}
          sub={weightUnit}
        />
        <StatColumn
          label="Current Weight"
          value={currentWeight != null ? currentWeight.toFixed(1) : "—"}
          sub={
            delta != null ? (
              <span className={cn(MONO, delta <= 0 ? "text-[#0d9488]" : "text-[#d97706]")}>
                {delta <= 0 ? "" : "+"}{delta.toFixed(1)}{weightUnit}
              </span>
            ) : undefined
          }
        />
        <StatColumn
          label="Goal Weight"
          value={goalWeight != null ? goalWeight.toFixed(1) : "—"}
          sub={
            toGo != null ? (
              <span className={cn(MONO, "inline-block text-[#d97706] bg-[rgba(245,158,11,0.07)] px-1.5 py-0.5 rounded-[4px]")}>
                {toGo.toFixed(1)} {weightUnit} to go
              </span>
            ) : undefined
          }
        />
        <StatColumn
          label="Progress"
          value={`${completedCount}/${phases.length}`}
          sub="phases"
          isLast
        />
      </div>
    </div>
  );
}
