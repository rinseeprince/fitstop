import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type PhaseGoalFieldsProps = {
  weightUnit: "lbs" | "kg";
  phaseGoalWeight: string;
  onWeightChange: (value: string) => void;
  phaseGoalBodyFatPercentage: string;
  onBodyFatChange: (value: string) => void;
  disabled?: boolean;
  idPrefix?: string;
};

export const PhaseGoalFields = ({
  weightUnit,
  phaseGoalWeight,
  onWeightChange,
  phaseGoalBodyFatPercentage,
  onBodyFatChange,
  disabled = false,
  idPrefix = "phase",
}: PhaseGoalFieldsProps) => (
  <div className="space-y-2">
    <Label className="text-sm font-medium">Phase Goals (optional)</Label>
    {disabled ? (
      <p className="text-xs text-muted-foreground">
        Goals cannot be changed after a phase has started
      </p>
    ) : (
      <p className="text-xs text-muted-foreground">
        Leave blank to use the client&apos;s overall goal
      </p>
    )}
    <div className="flex gap-3">
      <div className="flex-1 space-y-1">
        <Label htmlFor={`${idPrefix}-goal-weight`} className="text-xs">
          Goal Weight ({weightUnit})
        </Label>
        <Input
          id={`${idPrefix}-goal-weight`}
          type="number"
          step="0.1"
          min="0"
          placeholder={weightUnit === "lbs" ? "e.g., 165" : "e.g., 75"}
          value={phaseGoalWeight}
          onChange={(e) => onWeightChange(e.target.value)}
          disabled={disabled}
        />
      </div>
      <div className="flex-1 space-y-1">
        <Label htmlFor={`${idPrefix}-goal-bf`} className="text-xs">
          Goal Body Fat (%)
        </Label>
        <Input
          id={`${idPrefix}-goal-bf`}
          type="number"
          step="0.1"
          min="0"
          max="60"
          placeholder="e.g., 15"
          value={phaseGoalBodyFatPercentage}
          onChange={(e) => onBodyFatChange(e.target.value)}
          disabled={disabled}
        />
      </div>
    </div>
  </div>
);
