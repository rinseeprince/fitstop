"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { TrainingSessionChecklist } from "./training-session-checklist";
import { NutritionAdherenceSection } from "./nutrition-adherence-section";
import { ExerciseHighlightsSection } from "./exercise-highlights-section";
import { ExternalActivitiesCheckin } from "./external-activities-checkin";
import { DailyLogsTrainingSummary } from "./daily-logs-training-summary";
import type {
  EnhancedTrainingMetrics,
  CheckInTrainingContext,
  CheckInNutritionContext,
} from "@/types/check-in";
import type { DailyLog } from "@/types/daily-log";

type StepTrainingProps = {
  data: Partial<EnhancedTrainingMetrics>;
  onChange: (data: Partial<EnhancedTrainingMetrics>) => void;
  trainingContext?: CheckInTrainingContext;
  nutritionContext?: CheckInNutritionContext;
  clientWeightKg?: number;
  weightUnit?: "lbs" | "kg";
  frequencyDays?: number;
  dailyLogs?: DailyLog[];
};

export const StepTraining = ({
  data,
  onChange,
  trainingContext,
  nutritionContext,
  clientWeightKg,
  weightUnit = "lbs",
  frequencyDays = 7,
  dailyLogs = [],
}: StepTrainingProps) => {
  const hasActivePlan = trainingContext?.hasActivePlan ?? false;
  const hasNutritionPlan = nutritionContext?.hasNutritionPlan ?? false;
  const hasDailyLogs = dailyLogs && dailyLogs.length > 0;

  // Legacy adherence color for fallback slider
  const adherenceColor =
    !data.adherencePercentage || data.adherencePercentage < 50
      ? "text-destructive"
      : data.adherencePercentage < 75
      ? "text-warning"
      : data.adherencePercentage < 90
      ? "text-warning"
      : "text-success";

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-semibold mb-1">Training & Nutrition</h3>
        <p className="text-sm text-muted-foreground">
          How did this week go? Be honest - it helps your coach help you!
        </p>
      </div>

      {/* Training Sessions Section */}
      {hasDailyLogs ? (
        // Show auto-calculated summary from daily logs
        <DailyLogsTrainingSummary dailyLogs={dailyLogs} />
      ) : hasActivePlan && trainingContext && trainingContext.sessions.length > 0 ? (
        <TrainingSessionChecklist
          sessions={trainingContext.sessions}
          completions={data.sessionCompletions || []}
          onChange={(sessionCompletions) =>
            onChange({ ...data, sessionCompletions })
          }
          frequencyDays={frequencyDays}
        />
      ) : (
        <div className="space-y-3">
          <Label htmlFor="workouts">Workouts Completed This Week</Label>
          <Input
            id="workouts"
            type="number"
            min="0"
            max="20"
            placeholder="e.g., 5"
            value={data.workoutsCompleted || ""}
            onChange={(e) =>
              onChange({
                ...data,
                workoutsCompleted: parseInt(e.target.value) || undefined,
              })
            }
          />
          <p className="text-xs text-muted-foreground">
            Include all training sessions, not just gym workouts
          </p>
        </div>
      )}

      {/* Only show separator if NOT using daily logs (daily logs summary includes nutrition) */}
      {!hasDailyLogs && <Separator />}

      {/* Nutrition Adherence Section - Only show manual entry if no daily logs */}
      {!hasDailyLogs && (
        hasNutritionPlan ? (
          <NutritionAdherenceSection
            nutritionContext={nutritionContext}
            adherence={data.nutritionAdherence || {}}
            onChange={(nutritionAdherence) =>
              onChange({ ...data, nutritionAdherence })
            }
            frequencyDays={frequencyDays}
          />
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Nutrition Plan Adherence</Label>
              <span className={`text-sm font-semibold ${adherenceColor}`}>
                {data.adherencePercentage || 50}%
              </span>
            </div>
            <Slider
              value={[data.adherencePercentage || 50]}
              onValueChange={(value) =>
                onChange({ ...data, adherencePercentage: value[0] })
              }
              min={0}
              max={100}
              step={5}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0% (Didn&apos;t follow)</span>
              <span>100% (Perfect)</span>
            </div>
            <p className="text-xs text-muted-foreground">
              How well did you stick to your nutrition goals?
            </p>
          </div>
        )
      )}

      {/* Additional nutrition question when using daily logs */}
      {hasDailyLogs && (
        <div className="space-y-3">
          <Label htmlFor="nutrition-factors">Anything that affected your nutrition this week?</Label>
          <Textarea
            id="nutrition-factors"
            placeholder="Examples:
• Travel made it tough to track
• Social events affected targets
• Felt extra hungry after hard training
• Dealing with stress eating"
            value={data.nutritionAdherence?.notes || ""}
            onChange={(e) => 
              onChange({ 
                ...data, 
                nutritionAdherence: { 
                  ...data.nutritionAdherence,
                  notes: e.target.value 
                }
              })
            }
            rows={4}
            className="resize-none"
          />
          <p className="text-xs text-muted-foreground">
            Optional: Help your coach understand any nutrition challenges
          </p>
        </div>
      )}

      <Separator />

      {/* Exercise Highlights (Collapsible) */}
      {hasActivePlan && trainingContext && (
        <ExerciseHighlightsSection
          exercises={trainingContext.sessions.map((s) => s.exercises)}
          highlights={data.exerciseHighlights || []}
          onChange={(exerciseHighlights) =>
            onChange({ ...data, exerciseHighlights })
          }
          weightUnit={weightUnit}
        />
      )}

      {/* External Activities (Collapsible) */}
      <ExternalActivitiesCheckin
        activities={data.externalActivities || []}
        onChange={(externalActivities) =>
          onChange({ ...data, externalActivities })
        }
        clientWeightKg={clientWeightKg}
      />

      <Separator />

      {/* Other Wins */}
      <div className="space-y-3">
        <Label htmlFor="prs">Other Wins & Achievements (Optional)</Label>
        <Textarea
          id="prs"
          placeholder="Any non-training wins or achievements this week?
Examples:
• Stuck to meal prep all week
• Hit 10k steps every day
• Got better sleep by limiting screen time"
          value={data.prs || ""}
          onChange={(e) => onChange({ ...data, prs: e.target.value })}
          rows={4}
          className="resize-none"
        />
      </div>

      {/* Challenges */}
      <div className="space-y-3">
        <Label htmlFor="challenges">Challenges & Struggles (Optional)</Label>
        <Textarea
          id="challenges"
          placeholder="What was difficult this week?
Examples:
• Felt really tired, hard to complete workouts
• Travel made it tough to eat right
• Dealing with knee pain during squats"
          value={data.challenges || ""}
          onChange={(e) => onChange({ ...data, challenges: e.target.value })}
          rows={4}
          className="resize-none"
        />
        <p className="text-xs text-muted-foreground">
          Being honest about challenges helps your coach adjust your plan
        </p>
      </div>
    </div>
  );
};
