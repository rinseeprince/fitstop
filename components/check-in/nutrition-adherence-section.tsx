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
};

export const NutritionAdherenceSection = ({
  nutritionContext,
  adherence,
  onChange,
}: NutritionAdherenceSectionProps) => {
  const daysOnTarget = adherence.daysOnTarget ?? 0;

  const handleIncrement = () => {
    if (daysOnTarget < 7) {
      onChange({ ...adherence, daysOnTarget: daysOnTarget + 1 });
    }
  };

  const handleDecrement = () => {
    if (daysOnTarget > 0) {
      onChange({ ...adherence, daysOnTarget: daysOnTarget - 1 });
    }
  };

  const getAdherenceColor = () => {
    if (daysOnTarget >= 6) return "text-green-600";
    if (daysOnTarget >= 4) return "text-yellow-600";
    if (daysOnTarget >= 2) return "text-orange-600";
    return "text-red-600";
  };

  const getAdherenceLabel = () => {
    if (daysOnTarget === 7) return "Perfect week!";
    if (daysOnTarget >= 5) return "Great progress";
    if (daysOnTarget >= 3) return "Keep pushing";
    if (daysOnTarget >= 1) return "Room for improvement";
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
            <div className="text-sm text-muted-foreground">of 7 days</div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleIncrement}
            disabled={daysOnTarget === 7}
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
            daysOnTarget >= 6
              ? "bg-green-500"
              : daysOnTarget >= 4
              ? "bg-yellow-500"
              : daysOnTarget >= 2
              ? "bg-orange-500"
              : "bg-red-500"
          }`}
          style={{ width: `${(daysOnTarget / 7) * 100}%` }}
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
