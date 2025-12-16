"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RefreshCw, Loader2 } from "lucide-react";
import { PreGenerationActivities } from "../../activities/pre-generation-activities";
import type { PreGenerationActivity } from "@/types/training";

type PlanPromptFormProps = {
  prompt: string;
  onPromptChange: (value: string) => void;
  onGenerate: () => void;
  onCancel?: () => void;
  isGenerating: boolean;
  isRegeneration: boolean;
  showCancel: boolean;
  // Pre-generation activities
  preGenerationActivities: PreGenerationActivity[];
  onAddActivity: (activity: PreGenerationActivity) => void;
  onRemoveActivity: (tempId: string) => void;
  clientWeightKg: number;
  // Same-day training option
  allowSameDayTraining: boolean;
  onAllowSameDayTrainingChange: (value: boolean) => void;
};

export function PlanPromptForm({
  prompt,
  onPromptChange,
  onGenerate,
  onCancel,
  isGenerating,
  isRegeneration,
  showCancel,
  preGenerationActivities,
  onAddActivity,
  onRemoveActivity,
  clientWeightKg,
  allowSameDayTraining,
  onAllowSameDayTrainingChange,
}: PlanPromptFormProps) {
  return (
    <div className="space-y-4">
      {/* Pre-generation activities section */}
      <PreGenerationActivities
        activities={preGenerationActivities}
        onAddActivity={onAddActivity}
        onRemoveActivity={onRemoveActivity}
        clientWeightKg={clientWeightKg}
      />

      {/* Same-day training option - only show when activities exist */}
      {preGenerationActivities.length > 0 && (
        <div className="flex items-start space-x-3 p-3 bg-muted/50 rounded-lg">
          <Checkbox
            id="allowSameDayTraining"
            checked={allowSameDayTraining}
            onCheckedChange={(checked) => onAllowSameDayTrainingChange(checked === true)}
          />
          <div className="grid gap-1.5 leading-none">
            <label
              htmlFor="allowSameDayTraining"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
            >
              Client can train on activity days
            </label>
            <p className="text-xs text-muted-foreground">
              Enable for athletes or clients comfortable with multiple training sessions per day
            </p>
          </div>
        </div>
      )}

      <div>
        <label className="text-sm font-medium mb-2 block">
          Describe the training program you want to create
        </label>
        <Textarea
          placeholder="E.g., Client wants to lose body fat while maintaining muscle. Focus on compound lifts with progressive overload. 4 days per week, moderate volume. Include some conditioning work..."
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          rows={4}
          className="resize-none"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Include goals, preferences, experience level, available equipment, and any constraints
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={onGenerate} disabled={isGenerating} className="flex-1">
          {isGenerating ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          {isGenerating ? "Generating..." : isRegeneration ? "Regenerate Plan" : "Generate Plan"}
        </Button>
        {showCancel && onCancel && (
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
