"use client";

import type { Client, ActivityLevel, DietType } from "@/types/check-in";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PROTEIN_TARGETS } from "@/utils/nutrition-helpers";
import { SECTION_LABEL_CLASS } from "@/components/clients/training/program-builder/builder-tokens";

/**
 * FULLY CONTROLLED, deliberately. This form used to own a second copy of the
 * three settings in local state, seeded from an `initialSettings` prop that no
 * caller ever passed. The builder hook owns another copy, and the hook's is
 * what the generate request posts — so the two could disagree, and the form
 * could display one thing while the save sent another. One owner now.
 */
type NutritionSettingsFormProps = {
  client: Client;
  workActivityLevel: ActivityLevel;
  proteinTargetGPerKg: number;
  dietType: DietType;
  onSettingsChange: (settings: {
    workActivityLevel: ActivityLevel;
    proteinTargetGPerKg: number;
    dietType: DietType;
  }) => void;
};

const selectTriggerClass =
  "bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] text-[13px] font-medium text-[#0c1a1e] focus:border-[rgba(13,148,136,0.25)] focus:shadow-[0_0_0_3px_rgba(13,148,136,0.06)] focus:ring-0 transition-all hover:border-[rgba(13,148,136,0.25)] [&>svg]:text-[#93b0b4] [&>svg]:hover:text-[#0d9488] [&>svg]:transition-colors";

const selectContentClass =
  "bg-white rounded-[6px] shadow-lg border border-[rgba(13,148,136,0.08)] p-1";

const selectItemClass =
  "rounded-[6px] cursor-pointer text-[13px] text-[#0c1a1e] focus:bg-[rgba(13,148,136,0.05)]";

export function NutritionSettingsForm({
  client,
  workActivityLevel,
  proteinTargetGPerKg,
  dietType,
  onSettingsChange,
}: NutritionSettingsFormProps) {
  const unitPreference = client.unitPreference || "imperial";

  const handleChange = (
    field: string,
    value: ActivityLevel | number | DietType | string
  ) => {
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
    });
  };

  return (
    <div className="space-y-4">
      {/* Work Activity Level */}
      <div className="space-y-1.5">
        <label className={SECTION_LABEL_CLASS}>
          Work Activity Level
        </label>
        <Select
          value={workActivityLevel}
          onValueChange={(value) =>
            handleChange("workActivityLevel", value as ActivityLevel)
          }
        >
          <SelectTrigger id="activity-level" className={selectTriggerClass}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={selectContentClass}>
            <SelectItem value="sedentary" className={selectItemClass}>Sedentary (desk job)</SelectItem>
            <SelectItem value="lightly_active" className={selectItemClass}>
              Lightly Active (light movement)
            </SelectItem>
            <SelectItem value="moderately_active" className={selectItemClass}>
              Moderately Active (on feet most of day)
            </SelectItem>
            <SelectItem value="very_active" className={selectItemClass}>
              Very Active (physical job)
            </SelectItem>
            <SelectItem value="extremely_active" className={selectItemClass}>
              Extremely Active (athlete/heavy labor)
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-[#93b0b4] leading-[1.4]">
          Daily work activity level (multiplier: 1.2x to 1.9x)
        </p>
      </div>

      {/* Protein Target */}
      <div className="space-y-1.5">
        <label className={SECTION_LABEL_CLASS}>
          Protein Target
        </label>
        <Select
          value={proteinTargetGPerKg.toString()}
          onValueChange={(value) =>
            handleChange("proteinTargetGPerKg", parseFloat(value))
          }
        >
          <SelectTrigger id="protein-target" className={selectTriggerClass}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={selectContentClass}>
            <SelectItem value={PROTEIN_TARGETS.minimum.gPerKg.toString()} className={selectItemClass}>
              {unitPreference === "metric"
                ? `${PROTEIN_TARGETS.minimum.gPerKg}g per kg - Minimum`
                : `${PROTEIN_TARGETS.minimum.gPerLb.toFixed(2)}g per lb - Minimum`}
            </SelectItem>
            <SelectItem value={PROTEIN_TARGETS.moderate.gPerKg.toString()} className={selectItemClass}>
              {unitPreference === "metric"
                ? `${PROTEIN_TARGETS.moderate.gPerKg}g per kg - Moderate`
                : `${PROTEIN_TARGETS.moderate.gPerLb.toFixed(2)}g per lb - Moderate`}
            </SelectItem>
            <SelectItem value={PROTEIN_TARGETS.high.gPerKg.toString()} className={selectItemClass}>
              {unitPreference === "metric"
                ? `${PROTEIN_TARGETS.high.gPerKg}g per kg - High`
                : `${PROTEIN_TARGETS.high.gPerLb.toFixed(2)}g per lb - High`}
            </SelectItem>
            <SelectItem value={PROTEIN_TARGETS.veryHigh.gPerKg.toString()} className={selectItemClass}>
              {unitPreference === "metric"
                ? `${PROTEIN_TARGETS.veryHigh.gPerKg}g per kg - Very High`
                : `${PROTEIN_TARGETS.veryHigh.gPerLb.toFixed(2)}g per lb - Very High`}
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-[#93b0b4] leading-[1.4]">
          Protein per {unitPreference === "metric" ? "kg" : "lb"} of body weight
        </p>
      </div>

      {/* Diet Type */}
      <div className="space-y-1.5">
        <label className={SECTION_LABEL_CLASS}>
          Diet Type
        </label>
        <Select
          value={dietType}
          onValueChange={(value) => handleChange("dietType", value as DietType)}
        >
          <SelectTrigger id="diet-type" className={selectTriggerClass}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={selectContentClass}>
            <SelectItem value="balanced" className={selectItemClass}>Balanced (50/50 carbs/fat)</SelectItem>
            <SelectItem value="high_carb" className={selectItemClass}>
              High Carb (65/35 carbs/fat)
            </SelectItem>
            <SelectItem value="low_carb" className={selectItemClass}>Low Carb (25/75 carbs/fat)</SelectItem>
            <SelectItem value="keto" className={selectItemClass}>Keto (10/90 carbs/fat)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-[#93b0b4] leading-[1.4]">
          Carb/fat split for remaining calories after protein
        </p>
      </div>

    </div>
  );
}
