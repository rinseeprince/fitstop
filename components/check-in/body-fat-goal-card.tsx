"use client";

import { Progress } from "@/components/ui/progress";
import { CheckCircle2, AlertCircle, TrendingDown, TrendingUp, Percent } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MONO,
  MONO_META_CLASS,
  TEXT_PRIMARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { GoalProgress } from "@/types/check-in";

type BodyFatGoalCardProps = {
  bodyFatGoal: NonNullable<GoalProgress["bodyFat"]>;
};

export const BodyFatGoalCard = ({ bodyFatGoal }: BodyFatGoalCardProps) => {
  const onTrack = bodyFatGoal.isOnTrack;
  const badgeCls = onTrack ? "text-[#0d9488]" : "text-[#d97706]";
  // Met or passed. This card has no pace check, which is why it read "Needs
  // attention" about the same overshot client the weight card called "On track"
  // — the two cards now take the same state before either trend verdict.
  const isMet =
    bodyFatGoal.status === "achieved" || bodyFatGoal.status === "overshot";

  return (
    <div className="bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] p-4">
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h4 className="font-semibold flex items-center gap-2 mb-1 text-[#0c1a1e]">
              <Percent className="h-4 w-4 text-[#0d9488]" strokeWidth={1.5} />
              Body Fat Goal
            </h4>
            <div className="flex items-center gap-2">
              {isMet || onTrack ? (
                <CheckCircle2 className="h-4 w-4 text-[#0d9488]" strokeWidth={1.5} />
              ) : (
                <AlertCircle className="h-4 w-4 text-[#d97706]" strokeWidth={1.5} />
              )}
              <span className={`text-xs font-medium ${isMet ? "text-[#0d9488]" : badgeCls}`}>
                {isMet ? "Goal met" : onTrack ? "On track" : "Needs attention"}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className={cn("text-2xl font-bold", MONO, "text-[#0d9488]")}>
              {Math.round(bodyFatGoal.percentComplete)}%
            </div>
            <div className="text-xs text-[#93b0b4]">Complete</div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <Progress value={bodyFatGoal.percentComplete} className="h-3" />
          <div className={cn(MONO_META_CLASS, "flex justify-between text-xs")}>
            <span>Start: {bodyFatGoal.startingBodyFat}%</span>
            <span>Goal: {bodyFatGoal.goal}%</span>
          </div>
        </div>

        {/* Current Stats */}
        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-[rgba(13,148,136,0.08)]">
          <div>
            <div className="text-xs text-[#93b0b4] mb-1">Current Body Fat</div>
            <div className={cn("text-lg font-semibold", MONO, TEXT_PRIMARY)}>{bodyFatGoal.current}%</div>
          </div>
          <div>
            <div className="text-xs text-[#93b0b4] mb-1">Remaining</div>
            {isMet ? (
              <div className={cn("text-lg font-semibold", TEXT_PRIMARY)}>Goal met</div>
            ) : (
              <div className={cn("text-lg font-semibold", MONO, TEXT_PRIMARY)}>
                {Math.abs(bodyFatGoal.remaining)}%
              </div>
            )}
          </div>
        </div>

        {isMet && (
          <div className="pt-2 border-t border-[rgba(13,148,136,0.08)]">
            <p className="text-xs text-[#0d9488]">
              Goal met - consider setting a new target.
            </p>
          </div>
        )}

        {/* Average Change */}
        {bodyFatGoal.avgChange !== undefined && (
          <div className="pt-2 border-t border-[rgba(13,148,136,0.08)]">
            <div className="text-xs text-[#93b0b4] mb-1">Average Change Per Check-In</div>
            <div className="flex items-center gap-2">
              {bodyFatGoal.avgChange < 0 ? (
                <TrendingDown className="h-4 w-4 text-[#0d9488]" strokeWidth={1.5} />
              ) : (
                <TrendingUp className="h-4 w-4 text-[#d97706]" strokeWidth={1.5} />
              )}
              <span className={cn("font-medium", MONO, TEXT_PRIMARY)}>
                {Math.abs(bodyFatGoal.avgChange).toFixed(1)}% per check-in
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
