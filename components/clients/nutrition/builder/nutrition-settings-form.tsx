"use client";

import { useState } from "react";
import type { Client, ActivityLevel, DietType } from "@/types/check-in";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { PROTEIN_TARGETS } from "@/utils/nutrition-helpers";

type NutritionSettingsFormProps = {
  client: Client;
  onSettingsChange: (settings: {
    workActivityLevel: ActivityLevel;
    proteinTargetGPerKg: number;
    dietType: DietType;
    goalDeadline?: string;
  }) => void;
};

export function NutritionSettingsForm({
  client,
  onSettingsChange,
}: NutritionSettingsFormProps) {
  const unitPreference = client.unitPreference || "imperial";

  const [workActivityLevel, setWorkActivityLevel] = useState<ActivityLevel>(
    client.workActivityLevel || "sedentary"
  );
  const [proteinTargetGPerKg, setProteinTargetGPerKg] = useState<number>(
    client.proteinTargetGPerKg || PROTEIN_TARGETS.high.gPerKg
  );
  const [dietType, setDietType] = useState<DietType>(
    client.dietType || "balanced"
  );
  const [goalDeadline, setGoalDeadline] = useState<string>(
    client.goalDeadline || ""
  );

  const handleChange = (
    field: string,
    value: ActivityLevel | number | DietType | string
  ) => {
    switch (field) {
      case "workActivityLevel":
        setWorkActivityLevel(value as ActivityLevel);
        break;
      case "proteinTargetGPerKg":
        setProteinTargetGPerKg(value as number);
        break;
      case "dietType":
        setDietType(value as DietType);
        break;
      case "goalDeadline":
        setGoalDeadline(value as string);
        break;
    }

    // Notify parent of changes
    onSettingsChange({
      workActivityLevel:
        field === "workActivityLevel"
          ? (value as ActivityLevel)
          : workActivityLevel,
      proteinTargetGPerKg:
        field === "proteinTargetGPerKg"
          ? (value as number)
          : proteinTargetGPerKg,
      dietType: field === "dietType" ? (value as DietType) : dietType,
      goalDeadline: field === "goalDeadline" ? (value as string) : goalDeadline,
    });
  };

  return (
    <div className="space-y-4">
      {/* Work Activity Level */}
      <div className="space-y-1.5">
        <Label htmlFor="activity-level" className="text-sm font-medium text-foreground">
          Work Activity Level
        </Label>
        <Select
          value={workActivityLevel}
          onValueChange={(value) =>
            handleChange("workActivityLevel", value as ActivityLevel)
          }
        >
          <SelectTrigger id="activity-level" className="bg-card border-border rounded-lg focus:border-primary focus:ring-1 focus:ring-ring">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-card rounded-lg shadow-lg border border-border p-1">
            <SelectItem value="sedentary" className="rounded-lg cursor-pointer focus:bg-muted">Sedentary (desk job)</SelectItem>
            <SelectItem value="lightly_active" className="rounded-lg cursor-pointer focus:bg-muted">
              Lightly Active (light movement)
            </SelectItem>
            <SelectItem value="moderately_active" className="rounded-lg cursor-pointer focus:bg-muted">
              Moderately Active (on feet most of day)
            </SelectItem>
            <SelectItem value="very_active" className="rounded-lg cursor-pointer focus:bg-muted">
              Very Active (physical job)
            </SelectItem>
            <SelectItem value="extremely_active" className="rounded-lg cursor-pointer focus:bg-muted">
              Extremely Active (athlete/heavy labor)
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Daily work activity level (multiplier: 1.2x to 1.9x)
        </p>
      </div>

      {/* Protein Target */}
      <div className="space-y-1.5">
        <Label htmlFor="protein-target" className="text-sm font-medium text-foreground">
          Protein Target
        </Label>
        <Select
          value={proteinTargetGPerKg.toString()}
          onValueChange={(value) =>
            handleChange("proteinTargetGPerKg", parseFloat(value))
          }
        >
          <SelectTrigger id="protein-target" className="bg-card border-border rounded-lg focus:border-primary focus:ring-1 focus:ring-ring">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-card rounded-lg shadow-lg border border-border p-1">
            <SelectItem value={PROTEIN_TARGETS.minimum.gPerKg.toString()} className="rounded-lg cursor-pointer focus:bg-muted">
              {unitPreference === "metric"
                ? `${PROTEIN_TARGETS.minimum.gPerKg}g per kg - Minimum`
                : `${PROTEIN_TARGETS.minimum.gPerLb.toFixed(2)}g per lb - Minimum`}
            </SelectItem>
            <SelectItem value={PROTEIN_TARGETS.moderate.gPerKg.toString()} className="rounded-lg cursor-pointer focus:bg-muted">
              {unitPreference === "metric"
                ? `${PROTEIN_TARGETS.moderate.gPerKg}g per kg - Moderate`
                : `${PROTEIN_TARGETS.moderate.gPerLb.toFixed(2)}g per lb - Moderate`}
            </SelectItem>
            <SelectItem value={PROTEIN_TARGETS.high.gPerKg.toString()} className="rounded-lg cursor-pointer focus:bg-muted">
              {unitPreference === "metric"
                ? `${PROTEIN_TARGETS.high.gPerKg}g per kg - High`
                : `${PROTEIN_TARGETS.high.gPerLb.toFixed(2)}g per lb - High`}
            </SelectItem>
            <SelectItem value={PROTEIN_TARGETS.veryHigh.gPerKg.toString()} className="rounded-lg cursor-pointer focus:bg-muted">
              {unitPreference === "metric"
                ? `${PROTEIN_TARGETS.veryHigh.gPerKg}g per kg - Very High`
                : `${PROTEIN_TARGETS.veryHigh.gPerLb.toFixed(2)}g per lb - Very High`}
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Protein per {unitPreference === "metric" ? "kg" : "lb"} of body weight
        </p>
      </div>

      {/* Diet Type */}
      <div className="space-y-1.5">
        <Label htmlFor="diet-type" className="text-sm font-medium text-foreground">
          Diet Type
        </Label>
        <Select
          value={dietType}
          onValueChange={(value) => handleChange("dietType", value as DietType)}
        >
          <SelectTrigger id="diet-type" className="bg-card border-border rounded-lg focus:border-primary focus:ring-1 focus:ring-ring">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-card rounded-lg shadow-lg border border-border p-1">
            <SelectItem value="balanced" className="rounded-lg cursor-pointer focus:bg-muted">Balanced (50/50 carbs/fat)</SelectItem>
            <SelectItem value="high_carb" className="rounded-lg cursor-pointer focus:bg-muted">
              High Carb (65/35 carbs/fat)
            </SelectItem>
            <SelectItem value="low_carb" className="rounded-lg cursor-pointer focus:bg-muted">Low Carb (25/75 carbs/fat)</SelectItem>
            <SelectItem value="keto" className="rounded-lg cursor-pointer focus:bg-muted">Keto (10/90 carbs/fat)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Carb/fat split for remaining calories after protein
        </p>
      </div>

      {/* Goal Deadline */}
      <div className="space-y-1.5">
        <Label htmlFor="goal-deadline" className="text-sm font-medium text-foreground">
          Goal Deadline (Optional)
        </Label>
        <Input
          id="goal-deadline"
          type="date"
          value={goalDeadline}
          onChange={(e) => handleChange("goalDeadline", e.target.value)}
          min={new Date().toISOString().split("T")[0]}
          className="w-full px-3.5 py-2.5 bg-card border border-border rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-ring focus:outline-none transition-all"
        />
        <p className="text-xs text-muted-foreground">
          Target date to reach goal weight (affects calorie deficit/surplus)
        </p>
      </div>
    </div>
  );
}
