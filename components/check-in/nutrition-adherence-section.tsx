"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Minus, Plus, Utensils, Target } from "lucide-react";
import type {
  NutritionAdherence,
  CheckInNutritionContext,
} from "@/types/check-in";

type NutritionAdherenceSectionProps = {
  nutritionContext?: CheckInNutritionContext;
  adherence: NutritionAdherence;
  onChange: (adherence: NutritionAdherence) => void;
  frequencyDays?: number;
};

export const NutritionAdherenceSection = ({
  nutritionContext,
  adherence,
  onChange,
  frequencyDays = 7,
}: NutritionAdherenceSectionProps) => {
  const daysOnTarget = adherence.daysOnTarget ?? 0;

  const handleIncrement = () => {
    if (daysOnTarget < frequencyDays) {
      onChange({ ...adherence, daysOnTarget: daysOnTarget + 1 });
    }
  };

  const handleDecrement = () => {
    if (daysOnTarget > 0) {
      onChange({ ...adherence, daysOnTarget: daysOnTarget - 1 });
    }
  };

  const getAdherenceColor = () => {
    const percentage = daysOnTarget / frequencyDays;
    if (percentage >= 0.85) return "text-success";
    if (percentage >= 0.57) return "text-warning";
    return "text-destructive";
  };

  const getAdherenceLabel = () => {
    const percentage = daysOnTarget / frequencyDays;
    if (percentage === 1) return "Perfect!";
    if (percentage >= 0.7) return "Great progress";
    if (percentage >= 0.4) return "Keep pushing";
    if (percentage >= 0.15) return "Room for improvement";
    return "Let's get back on track";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Utensils className="h-5 w-5 text-muted-foreground" />
        <Label className="text-base font-medium">Nutrition Adherence</Label>
      </div>

      {/* Targets Summary */}
      {nutritionContext?.hasNutritionPlan && nutritionContext.averageTargets && (
        <div className="p-3 rounded-lg bg-muted/50 border">
          <div className="flex items-center gap-2 mb-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Your Daily Targets</span>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            <div>
              <div className="text-lg font-semibold">
                {nutritionContext.averageTargets.calories}
              </div>
              <div className="text-xs text-muted-foreground">Calories</div>
            </div>
            <div>
              <div className="text-lg font-semibold">
                {nutritionContext.averageTargets.proteinG}g
              </div>
              <div className="text-xs text-muted-foreground">Protein</div>
            </div>
            <div>
              <div className="text-lg font-semibold">
                {nutritionContext.averageTargets.carbsG}g
              </div>
              <div className="text-xs text-muted-foreground">Carbs</div>
            </div>
            <div>
              <div className="text-lg font-semibold">
                {nutritionContext.averageTargets.fatG}g
              </div>
              <div className="text-xs text-muted-foreground">Fat</div>
            </div>
          </div>
        </div>
      )}

      {/* Days Counter */}
      <div className="space-y-3">
        <div className="text-sm text-muted-foreground">
          How many days did you hit your nutrition targets?
        </div>

        <div className="flex items-center justify-center gap-4">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleDecrement}
            disabled={daysOnTarget === 0}
            className="h-12 w-12"
          >
            <Minus className="h-5 w-5" />
          </Button>

          <div className="text-center min-w-24">
            <div className={`text-4xl font-bold ${getAdherenceColor()}`}>
              {daysOnTarget}
            </div>
            <div className="text-sm text-muted-foreground">of {frequencyDays} days</div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleIncrement}
            disabled={daysOnTarget === frequencyDays}
            className="h-12 w-12"
          >
            <Plus className="h-5 w-5" />
          </Button>
        </div>

        <div className={`text-center text-sm font-medium ${getAdherenceColor()}`}>
          {getAdherenceLabel()}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-300 ${
            daysOnTarget / frequencyDays >= 0.85
              ? "bg-success"
              : daysOnTarget / frequencyDays >= 0.57
              ? "bg-warning"
              : daysOnTarget / frequencyDays >= 0.28
              ? "bg-warning"
              : "bg-destructive"
          }`}
          style={{ width: `${(daysOnTarget / frequencyDays) * 100}%` }}
        />
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <Label htmlFor="nutrition-notes" className="text-sm">
          Notes (optional)
        </Label>
        <Textarea
          id="nutrition-notes"
          placeholder="Any nutrition wins or challenges this week?"
          value={adherence.notes || ""}
          onChange={(e) => onChange({ ...adherence, notes: e.target.value })}
          rows={2}
          className="resize-none text-sm"
        />
      </div>
    </div>
  );
};
