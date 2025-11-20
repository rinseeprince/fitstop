"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import type { GoalProgress, CheckInComparison } from "@/types/check-in";
import { Target } from "lucide-react";
import { GoalDeadlineCard } from "./goal-deadline-card";
import { WeightGoalCard } from "./weight-goal-card";
import { BodyFatGoalCard } from "./body-fat-goal-card";
import { NutritionRegenerationBanner } from "../clients/nutrition-regeneration-banner";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";

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
  const { toast } = useToast();
  const router = useRouter();
  const [isRegenerating, setIsRegenerating] = useState(false);

  const hasWeightGoal = goalProgress.weight !== undefined;
  const hasBodyFatGoal = goalProgress.bodyFat !== undefined;
  const hasDeadline = goalProgress.deadline !== undefined;

  const handleRegenerateNutrition = async () => {
    setIsRegenerating(true);
    try {
      // Navigate to the client page where they can regenerate
      router.push(`/clients/${clientData.id}#nutrition`);
      toast({
        title: "Navigate to Client Profile",
        description: "Opening client profile to regenerate nutrition plan",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to navigate to client profile",
        variant: "destructive",
      });
    } finally {
      setIsRegenerating(false);
    }
  };

  if (!hasWeightGoal && !hasBodyFatGoal) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">Goal Progress</h3>
          <p className="text-sm text-muted-foreground">
            No goals have been set for {clientName} yet.
          </p>
        </div>
        <Card className="p-8 text-center">
          <Target className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">
            Set goals in the client profile to track progress here.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Goal Progress</h3>
        <p className="text-sm text-muted-foreground">
          Tracking {clientName}'s progress towards their goals
        </p>
      </div>

      {/* Nutrition Regeneration Banner */}
      {clientData.currentWeight &&
        clientData.nutritionPlanBaseWeightKg &&
        clientData.weightUnit && (
          <NutritionRegenerationBanner
            currentWeight={clientData.currentWeight}
            weightUnit={clientData.weightUnit}
            nutritionPlanBaseWeightKg={clientData.nutritionPlanBaseWeightKg}
            nutritionPlanCreatedDate={clientData.nutritionPlanCreatedDate}
            unitPreference={clientData.unitPreference}
            onRegenerate={handleRegenerateNutrition}
            showRegenerateButton={true}
          />
        )}

      {/* Deadline Overview */}
      {hasDeadline && <GoalDeadlineCard deadline={goalProgress.deadline!} />}

      {/* Weight Goal */}
      {hasWeightGoal && <WeightGoalCard weightGoal={goalProgress.weight!} />}

      {/* Body Fat Goal */}
      {hasBodyFatGoal && <BodyFatGoalCard bodyFatGoal={goalProgress.bodyFat!} />}

      {/* Summary Card */}
      <Card className="p-4 bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
        <div className="space-y-2">
          <h4 className="font-semibold flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Progress Summary
          </h4>
          <div className="text-sm space-y-1">
            {hasWeightGoal && (
              <p>
                <span className="font-medium">Weight:</span>{" "}
                {Math.abs(goalProgress.weight!.remaining)}{goalProgress.weight!.unit} to go
                {goalProgress.weight!.weeksToGoal && (
                  <span className="text-muted-foreground">
                    {" "}• ~{Math.round(goalProgress.weight!.weeksToGoal)} weeks remaining
                  </span>
                )}
              </p>
            )}
            {hasBodyFatGoal && (
              <p>
                <span className="font-medium">Body Fat:</span>{" "}
                {Math.abs(goalProgress.bodyFat!.remaining)}% to go
              </p>
            )}
            {hasWeightGoal && goalProgress.weight!.isOnTrack && (
              <p className="text-green-600 dark:text-green-400 font-medium">
                ✓ Progress is on track to meet goals
              </p>
            )}
            {hasWeightGoal && !goalProgress.weight!.isOnTrack && (
              <p className="text-yellow-600 dark:text-yellow-400 font-medium">
                ⚠ Consider adjusting approach to stay on track
              </p>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
};
