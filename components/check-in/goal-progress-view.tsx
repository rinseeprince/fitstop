"use client";

import type { GoalProgress, CheckInComparison } from "@/types/check-in";
import { Target } from "lucide-react";
import { GoalDeadlineCard } from "./goal-deadline-card";
import { WeightGoalCard } from "./weight-goal-card";
import { BodyFatGoalCard } from "./body-fat-goal-card";
import { NutritionRegenerationBanner } from "../clients/nutrition/nutrition-regeneration-banner";
import { useUnits } from "@/contexts/units-context";
import { formatWeight } from "@/utils/unit-conversions";

type GoalProgressViewProps = {
  goalProgress: GoalProgress;
  clientName: string;
  clientData: CheckInComparison["client"];
};

export const GoalProgressView = ({
  goalProgress,
  clientName,
  clientData
}: GoalProgressViewProps) => {
  const { preference } = useUnits();

  const hasWeightGoal = goalProgress.weight !== undefined;
  const hasBodyFatGoal = goalProgress.bodyFat !== undefined;
  const hasDeadline = goalProgress.deadline !== undefined;

  // Honest, pace-aware progress note: when the required rate is unsafe, recommend
  // moving the date rather than asserting the goal is on track.
  const weight = goalProgress.weight;
  const weightMet = weight?.status === "achieved" || weight?.status === "overshot";
  const progressNote = !weight
    ? null
    : weightMet
    ? { cls: "text-[#0d9488]", text: "Goal met - consider setting a new target." }
    : weight.paceStatus === "behind_pace"
    ? { cls: "text-[#d97706]", text: "Behind pace. Consider extending the deadline or easing the weekly target." }
    : weight.paceStatus === "unrealistic"
    ? { cls: "text-[#d97706]", text: "The deadline looks unrealistic at a safe pace. Recommend moving the target date." }
    : weight.paceStatus === "on_track" || weight.isOnTrack
    ? { cls: "text-[#0d9488]", text: "On track to meet the goal by the deadline." }
    : { cls: "text-[#d97706]", text: "Consider adjusting the approach to stay on track." };

  if (!hasWeightGoal && !hasBodyFatGoal) {
    return (
      <div className="space-y-6">
        <p className="text-sm text-[#93b0b4]">
          No goals have been set for {clientName} yet.
        </p>
        <div className="bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] p-8 text-center">
          <Target className="h-12 w-12 mx-auto mb-4 text-[#93b0b4]" strokeWidth={1.5} />
          <p className="text-[#93b0b4]">
            Set goals in the client profile to track progress here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-[#93b0b4]">
        Tracking {clientName}&apos;s progress towards their goals
      </p>

      {/* Nutrition Regeneration Banner */}
      {clientData.currentWeight &&
        clientData.nutritionPlanBaseWeightKg && (
          <NutritionRegenerationBanner
            currentWeight={clientData.currentWeight}
            nutritionPlanBaseWeightKg={clientData.nutritionPlanBaseWeightKg}
            nutritionPlanEffectiveDate={clientData.nutritionPlanEffectiveDate}
          />
        )}

      {/* Deadline Overview */}
      {hasDeadline && <GoalDeadlineCard deadline={goalProgress.deadline!} />}

      {/* Weight Goal */}
      {hasWeightGoal && <WeightGoalCard weightGoal={goalProgress.weight!} />}

      {/* Body Fat Goal */}
      {hasBodyFatGoal && <BodyFatGoalCard bodyFatGoal={goalProgress.bodyFat!} />}

      {/* Summary Card */}
      <div className="rounded-[6px] p-4 bg-[rgba(13,148,136,0.05)] border border-[rgba(13,148,136,0.15)]">
        <div className="space-y-2">
          <h4 className="font-semibold flex items-center gap-2 text-[#0c1a1e]">
            <Target className="h-5 w-5 text-[#0d9488]" strokeWidth={1.5} />
            Progress Summary
          </h4>
          <div className="text-sm space-y-1 text-[#0c1a1e]">
            {hasWeightGoal && (
              <p>
                <span className="font-medium">Weight:</span>{" "}
                {weightMet ? (
                  "goal met"
                ) : (
                  <>
                    {Math.abs(
                      Math.round(
                        formatWeight(goalProgress.weight!.remaining, preference).value * 10,
                      ) / 10,
                    )}
                    {formatWeight(0, preference).unit} to go
                    {goalProgress.weight!.weeksToGoal && (
                      <span className="text-[#93b0b4]">
                        {" "}• ~{Math.round(goalProgress.weight!.weeksToGoal)} weeks remaining
                      </span>
                    )}
                  </>
                )}
              </p>
            )}
            {hasBodyFatGoal && (
              <p>
                <span className="font-medium">Body Fat:</span>{" "}
                {goalProgress.bodyFat!.status === "achieved" ||
                goalProgress.bodyFat!.status === "overshot"
                  ? "goal met"
                  : `${Math.abs(goalProgress.bodyFat!.remaining)}% to go`}
              </p>
            )}
            {progressNote && (
              <p className={`${progressNote.cls} font-medium`}>{progressNote.text}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
