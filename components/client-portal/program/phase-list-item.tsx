"use client";

import { useState } from "react";
import { Calendar, CheckCircle2, ChevronRight, Circle, Target } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { weightFromKg } from "@/utils/nutrition-helpers";
import type { ClientProgram } from "@/types/client-program";
import type { PhaseStatus } from "@/types/roadmap";

type Phase = ClientProgram["phases"][number];

type Props = {
  phase: Phase;
  isActive: boolean;
  weightUnit: "lbs" | "kg";
};

const statusBadgeVariant: Record<
  PhaseStatus,
  "secondary" | "default" | "success" | "neutral"
> = {
  planned: "secondary",
  active: "default",
  completed: "success",
  skipped: "neutral",
};

const msPerDay = 24 * 60 * 60 * 1000;

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatMilestoneDate(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

function formatDateRange(
  startDate: string | null,
  endDate: string | null,
  status: PhaseStatus,
): string {
  if (status === "planned") {
    if (startDate) return `Starts ${formatDate(startDate)}`;
    return "Not scheduled";
  }
  if (startDate && endDate) return `${formatDate(startDate)} – ${formatDate(endDate)}`;
  if (startDate) return formatDate(startDate);
  return "";
}

function computeWeekProgress(
  phase: Phase,
): { currentWeek: number; totalWeeks: number } | null {
  if (phase.status !== "active" || !phase.startDate) return null;
  const startMs = new Date(phase.startDate).getTime();
  const totalDays =
    phase.endDate != null
      ? Math.round((new Date(phase.endDate).getTime() - startMs) / msPerDay) + 1
      : null;
  const totalWeeks =
    phase.durationWeeks ??
    (totalDays != null ? Math.ceil(totalDays / 7) : null);
  if (totalWeeks == null) return null;
  const elapsedDays = Math.round((Date.now() - startMs) / msPerDay) + 1;
  const currentWeek = Math.max(1, Math.min(totalWeeks, Math.ceil(elapsedDays / 7)));
  return { currentWeek, totalWeeks };
}

function buildGoalText(
  phaseGoalWeight: number | null,
  phaseGoalBodyFatPercentage: number | null,
  weightUnit: "lbs" | "kg",
): string | null {
  const parts: string[] = [];
  if (phaseGoalWeight != null) {
    parts.push(`${weightFromKg(phaseGoalWeight, weightUnit).toFixed(1)} ${weightUnit}`);
  }
  if (phaseGoalBodyFatPercentage != null) {
    parts.push(`${phaseGoalBodyFatPercentage}% BF`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function PhaseListItem({ phase, isActive, weightUnit }: Props) {
  const [expanded, setExpanded] = useState(false);
  const isFuture = phase.status === "planned";
  const isPast =
    phase.status === "completed" || phase.status === "skipped";

  const completedMilestones = phase.milestones.filter((m) => m.completed).length;
  const totalMilestones = phase.milestones.length;
  const weekProgress = computeWeekProgress(phase);
  const dateText = formatDateRange(phase.startDate, phase.endDate, phase.status);
  const goalText = buildGoalText(
    phase.phaseGoalWeight,
    phase.phaseGoalBodyFatPercentage,
    weightUnit,
  );

  const showExpandedBody = isActive || (isPast && expanded);

  const containerClass = [
    "rounded-md border bg-card",
    isActive ? "border-primary bg-primary/5" : "border-border",
    isFuture ? "opacity-90" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const headerRow = (
    <>
      {isPast && (
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        />
      )}
      <span className="text-sm font-semibold text-foreground truncate flex-1 min-w-0">
        {phase.name}
      </span>
      <Badge variant={statusBadgeVariant[phase.status]}>{phase.status}</Badge>
    </>
  );

  const metaRow = (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {dateText && (
        <span className="inline-flex items-center gap-1">
          <Calendar className="h-3 w-3" />
          {dateText}
        </span>
      )}
      {weekProgress && (
        <span className="font-mono-display font-medium text-foreground">
          Week {weekProgress.currentWeek} of {weekProgress.totalWeeks}
        </span>
      )}
      {goalText && (
        <span className="inline-flex items-center gap-1 font-mono-display">
          <Target className="h-3 w-3" />
          {goalText}
        </span>
      )}
      {isPast && totalMilestones > 0 && (
        <span className="text-[10px] font-semibold bg-primary/10 text-primary px-1.5 py-0.5 rounded-md">
          {completedMilestones}/{totalMilestones} milestones
        </span>
      )}
    </div>
  );

  const expandedBody = showExpandedBody ? (
    <div className="border-t border-border px-3 pb-3 pt-3 space-y-2">
      {phase.coachReflection && (
        <p className="text-sm italic text-muted-foreground">
          &quot;{phase.coachReflection}&quot;
        </p>
      )}
      {phase.description && (
        <p className="text-sm text-foreground">{phase.description}</p>
      )}
      {phase.objectives && (
        <p className="text-sm italic text-muted-foreground">{phase.objectives}</p>
      )}
      {totalMilestones > 0 && (
        <ul className="space-y-1.5 pt-1">
          {phase.milestones.map((m) => (
            <li key={m.id} className="flex items-start gap-2">
              {m.completed ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-primary mt-0.5" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
              )}
              <span
                className={`text-[12.5px] ${
                  m.completed ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {m.text}
              </span>
              {m.completed && m.completed_at && (
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground font-mono-display">
                  {formatMilestoneDate(m.completed_at)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  ) : null;

  const headerContent = (
    <>
      <div className="flex items-center gap-2">{headerRow}</div>
      {metaRow}
    </>
  );

  return (
    <div
      data-active={isActive ? "true" : undefined}
      className={containerClass}
    >
      {isPast ? (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          className="w-full text-left p-3"
        >
          {headerContent}
        </button>
      ) : (
        <div className="p-3">{headerContent}</div>
      )}
      {expandedBody}
    </div>
  );
}
