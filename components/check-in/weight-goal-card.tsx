"use client";

import { Progress } from "@/components/ui/progress";
import { CheckCircle2, AlertCircle, TrendingDown, TrendingUp, Scale } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import {
  MONO,
  MONO_META_CLASS,
  TEXT_PRIMARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { GoalProgress } from "@/types/check-in";
import { useUnits } from "@/contexts/units-context";
import { formatWeight } from "@/utils/unit-conversions";

type WeightGoalCardProps = {
  weightGoal: NonNullable<GoalProgress["weight"]>;
};

export const WeightGoalCard = ({ weightGoal }: WeightGoalCardProps) => {
  const { paceStatus, requiredRate, safeCeiling } = weightGoal;
  // weightGoal.unit came off the client's stored tag; a coach reads their own.
  // Body weights and weekly RATES of body-weight change — formatWeight, never
  // formatLoad: snapping a 0.5 kg/week rate to the nearest 5 lb would show 0.
  //
  // Only DISPLAY converts. The pace comparisons below stay on canonical
  // kilograms: both sides scale by the same factor, so converting them would
  // change nothing except the chance of a rounding artefact flipping a verdict.
  const { preference } = useUnits();
  const unit = formatWeight(0, preference).unit;
  const w = (valueKg: number | undefined): number | undefined =>
    valueKg === undefined
      ? undefined
      : Math.round(formatWeight(valueKg, preference).value * 10) / 10;

  // Pace-aware badge (Teal Summit two-colour: teal good, amber attention - no red).
  const badge =
    paceStatus === "on_track"
      ? { label: "On track", cls: "text-[#0d9488]", Icon: CheckCircle2 }
      : paceStatus === "behind_pace"
      ? { label: "Behind pace", cls: "text-[#d97706]", Icon: AlertCircle }
      : paceStatus === "unrealistic"
      ? { label: "Deadline unrealistic", cls: "text-[#d97706]", Icon: AlertCircle }
      : weightGoal.isOnTrack
      ? { label: "On track", cls: "text-[#0d9488]", Icon: CheckCircle2 }
      : { label: "Needs attention", cls: "text-[#d97706]", Icon: AlertCircle };
  const BadgeIcon = badge.Icon;

  const hasPace = requiredRate !== undefined && safeCeiling !== undefined;
  const requiredFinite = requiredRate !== undefined && Number.isFinite(requiredRate);
  const ceilingValue = safeCeiling ?? 0;
  const requiredValue = requiredRate ?? 0;
  const paceMax = Math.max(requiredFinite ? requiredValue : ceilingValue, ceilingValue) || 1;
  const requiredPct = requiredFinite ? Math.min(100, (requiredValue / paceMax) * 100) : 100;
  const ceilingPct = hasPace ? Math.min(100, (ceilingValue / paceMax) * 100) : 0;
  const barColor = paceStatus === "on_track" ? "bg-[#0d9488]" : "bg-[#d97706]";
  const paceNote =
    paceStatus === "on_track"
      ? "Current pace will reach the goal by the deadline."
      : paceStatus === "behind_pace"
      ? "The required rate is above the safe ceiling. Consider extending the deadline."
      : "The required rate is well above a safe pace. Recommend moving the target date or easing the goal.";

  return (
    <div className="bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] p-4">
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h4 className="font-semibold flex items-center gap-2 mb-1 text-[#0c1a1e]">
              <Scale className="h-4 w-4 text-[#0d9488]" strokeWidth={1.5} />
              Weight Goal
            </h4>
            <div className="flex items-center gap-2">
              <BadgeIcon className={`h-4 w-4 ${badge.cls}`} strokeWidth={1.5} />
              <span className={`text-xs font-medium ${badge.cls}`}>{badge.label}</span>
            </div>
          </div>
          <div className="text-right">
            <div className={cn("text-2xl font-bold", MONO, "text-[#0d9488]")}>
              {Math.round(weightGoal.percentComplete)}%
            </div>
            <div className="text-xs text-[#93b0b4]">Complete</div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <Progress value={weightGoal.percentComplete} className="h-3" />
          <div className={cn(MONO_META_CLASS, "flex justify-between text-xs")}>
            <span>
              Start: {w(weightGoal.startingWeight)}
              {unit}
            </span>
            <span>
              Goal: {w(weightGoal.goal)}
              {unit}
            </span>
          </div>
        </div>

        {/* Current Stats */}
        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-[rgba(13,148,136,0.08)]">
          <div>
            <div className="text-xs text-[#93b0b4] mb-1">Current Weight</div>
            <div className={cn("text-lg font-semibold", MONO, TEXT_PRIMARY)}>
              {w(weightGoal.current)}
              {unit}
            </div>
          </div>
          <div>
            <div className="text-xs text-[#93b0b4] mb-1">Remaining</div>
            <div className={cn("text-lg font-semibold", MONO, TEXT_PRIMARY)}>
              {Math.abs(w(weightGoal.remaining) ?? 0)}
              {unit}
            </div>
          </div>
        </div>

        {/* Rate of Progress */}
        {weightGoal.avgWeeklyChange !== undefined && (
          <div className="pt-2 border-t border-[rgba(13,148,136,0.08)]">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-[#93b0b4] mb-1">Average Weekly Change</div>
                <div className="flex items-center gap-2">
                  {weightGoal.avgWeeklyChange < 0 ? (
                    <TrendingDown className="h-4 w-4 text-[#0d9488]" strokeWidth={1.5} />
                  ) : (
                    <TrendingUp className="h-4 w-4 text-[#d97706]" strokeWidth={1.5} />
                  )}
                  <span className={cn("font-medium", MONO, TEXT_PRIMARY)}>
                    {Math.abs(w(weightGoal.avgWeeklyChange) ?? 0)}
                    {unit}/week
                  </span>
                </div>
              </div>
              {weightGoal.weeksToGoal !== undefined && (
                <div className="text-right">
                  <div className="text-xs text-[#93b0b4] mb-1">Estimated Time</div>
                  <div className={cn("font-medium", MONO, TEXT_PRIMARY)}>
                    {Math.round(weightGoal.weeksToGoal)} weeks
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Pace check vs safe ceiling */}
        {hasPace && (
          <div className="pt-2 border-t border-[rgba(13,148,136,0.08)] space-y-2">
            <div className="text-xs text-[#5a7d82]">Pace check</div>
            <div className="space-y-1.5">
              <div>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="text-[#93b0b4]">Required</span>
                  <span className={cn("font-medium", requiredFinite && MONO, TEXT_PRIMARY)}>
                    {requiredFinite ? `${w(requiredRate)}${unit}/week` : "Deadline passed"}
                  </span>
                </div>
                {/* dynamic bar width (percentage) - inline style as in mini-bar-sparkline */}
                <div className="h-2 rounded-full bg-[rgba(13,148,136,0.06)] overflow-hidden">
                  <div className={`h-full ${barColor}`} style={{ width: `${requiredPct}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="text-[#93b0b4]">Safe ceiling</span>
                  <span className={cn("font-medium", MONO, TEXT_PRIMARY)}>
                    {w(safeCeiling)}
                    {unit}/week
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[rgba(13,148,136,0.06)] overflow-hidden">
                  <div className="h-full bg-[rgba(13,148,136,0.25)]" style={{ width: `${ceilingPct}%` }} />
                </div>
              </div>
            </div>
            <p className={`text-xs ${badge.cls}`}>{paceNote}</p>
          </div>
        )}

        {/* Projected Completion */}
        {weightGoal.projectedCompletionDate && (
          <div className="pt-2 border-t border-[rgba(13,148,136,0.08)]">
            <div className="text-xs text-[#93b0b4] mb-1">Projected Goal Date</div>
            <div className={cn("font-medium", MONO, TEXT_PRIMARY)}>
              {format(new Date(weightGoal.projectedCompletionDate), "MMMM d, yyyy")}
            </div>
            <div className="text-xs text-[#93b0b4] mt-0.5">
              (
              {formatDistanceToNow(new Date(weightGoal.projectedCompletionDate), {
                addSuffix: true,
              })}
              )
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
