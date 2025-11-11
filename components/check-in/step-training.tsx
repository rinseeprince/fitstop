"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import type { TrainingMetrics } from "@/types/check-in";

type StepTrainingProps = {
  data: Partial<TrainingMetrics>;
  onChange: (data: Partial<TrainingMetrics>) => void;
};

export const StepTraining = ({ data, onChange }: StepTrainingProps) => {
  const adherenceColor =
    !data.adherencePercentage || data.adherencePercentage < 50
      ? "text-red-500"
      : data.adherencePercentage < 75
      ? "text-orange-500"
      : data.adherencePercentage < 90
      ? "text-yellow-500"
      : "text-green-500";

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-semibold mb-1">Training & Nutrition</h3>
        <p className="text-sm text-muted-foreground">
          How did this week go? Be honest - it helps your coach help you!
        </p>
      </div>

      {/* Workouts Completed */}
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

      {/* Nutrition Adherence */}
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
          <span>0% (Didn't follow)</span>
          <span>100% (Perfect)</span>
        </div>
        <p className="text-xs text-muted-foreground">
          How well did you stick to your nutrition goals?
        </p>
      </div>

      {/* PRs and Wins */}
      <div className="space-y-3">
        <Label htmlFor="prs">Personal Records & Wins (Optional)</Label>
        <Textarea
          id="prs"
          placeholder="Any PRs, breakthroughs, or wins this week?
Examples:
• Hit a new squat PR of 225 lbs
• Ran 5k without stopping for the first time
• Stuck to meal prep all week"
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
