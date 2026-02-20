"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type { CalorieFeedback } from "@/utils/nutrition-tracking-helpers";

interface MacroInputsProps {
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  adjustedProteinG: number;
  adjustedCarbsG: number;
  adjustedFatG: number;
  proteinFeedback: CalorieFeedback;
  carbsFeedback: CalorieFeedback;
  fatFeedback: CalorieFeedback;
  hasLoggedToday: boolean;
  isExpanded: boolean;
  onProteinChange: (value: string) => void;
  onCarbsChange: (value: string) => void;
  onFatChange: (value: string) => void;
  getFeedbackText: (feedback: CalorieFeedback, isCalories?: boolean) => string;
  getFeedbackColor: (colour: string) => string;
}

export function MacroInputs({
  proteinG,
  carbsG,
  fatG,
  adjustedProteinG,
  adjustedCarbsG,
  adjustedFatG,
  proteinFeedback,
  carbsFeedback,
  fatFeedback,
  hasLoggedToday,
  isExpanded,
  onProteinChange,
  onCarbsChange,
  onFatChange,
  getFeedbackText,
  getFeedbackColor,
}: MacroInputsProps) {
  return (
    <div className="space-y-3 pl-4 border-l-2 border-muted">
      <div className="space-y-1">
        <Label htmlFor="protein">Protein (g)</Label>
        <div className="flex items-center gap-2">
          <Input
            id="protein"
            type="number"
            value={proteinG || ""}
            onChange={(e) => onProteinChange(e.target.value)}
            placeholder="0"
            disabled={!hasLoggedToday && !isExpanded}
          />
          <div className="text-sm text-muted-foreground whitespace-nowrap">
            Target: {adjustedProteinG}g
          </div>
          {proteinG !== null && (
            <div className={`text-sm whitespace-nowrap ${getFeedbackColor(proteinFeedback.colour)}`}>
              {getFeedbackText(proteinFeedback)}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="carbs">Carbs (g)</Label>
        <div className="flex items-center gap-2">
          <Input
            id="carbs"
            type="number"
            value={carbsG || ""}
            onChange={(e) => onCarbsChange(e.target.value)}
            placeholder="0"
            disabled={!hasLoggedToday && !isExpanded}
          />
          <div className="text-sm text-muted-foreground whitespace-nowrap">
            Target: {adjustedCarbsG}g
          </div>
          {carbsG !== null && (
            <div className={`text-sm whitespace-nowrap ${getFeedbackColor(carbsFeedback.colour)}`}>
              {getFeedbackText(carbsFeedback)}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="fat">Fat (g)</Label>
        <div className="flex items-center gap-2">
          <Input
            id="fat"
            type="number"
            value={fatG || ""}
            onChange={(e) => onFatChange(e.target.value)}
            placeholder="0"
            disabled={!hasLoggedToday && !isExpanded}
          />
          <div className="text-sm text-muted-foreground whitespace-nowrap">
            Target: {adjustedFatG}g
          </div>
          {fatG !== null && (
            <div className={`text-sm whitespace-nowrap ${getFeedbackColor(fatFeedback.colour)}`}>
              {getFeedbackText(fatFeedback)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}