"use client";

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/programs/shared/segmented-control";

type NutritionSurplusSettingsProps = {
  /** Only ever tested for truthiness, so the tab asks the nutrition endpoint
   *  for a boolean instead of fetching the whole training plan. */
  hasTrainingPlan: boolean;
  isLoading: boolean;
  includeActivityBurn: boolean;
  onToggleActivityBurn: (value: boolean) => void;
  isSavingToggle?: boolean;
  /** How a training-day surplus distributes across macros (mig 117). */
  surplusAsCarbs: boolean;
  onToggleSurplusAsCarbs: (value: boolean) => void;
  isSavingSurplus?: boolean;
};

/**
 * The two training-surplus SETTINGS. Formerly
 * `NutritionTrainingCaloriesDisplay`, which also rendered the surplus.
 *
 * Both of its display branches were deleted rather than restyled. The
 * percentage branch duplicated the calendar sitting directly behind this
 * drawer, which already shows the surplus per date with real totals rather than
 * a bare percentage. The legacy branch rendered `training_burn_calories`, a
 * deprecated column that is 0 on every event written since LIB-2 — it could
 * only ever display "+0 cal/day avg", and it was reachable by any coach whose
 * program starts next week or whose current week is all rest.
 *
 * Renamed on purpose: the old name is exactly what would invite someone to add
 * a display back.
 */
export function NutritionSurplusSettings({
  hasTrainingPlan,
  isLoading,
  includeActivityBurn,
  onToggleActivityBurn,
  isSavingToggle,
  surplusAsCarbs,
  onToggleSurplusAsCarbs,
  isSavingSurplus,
}: NutritionSurplusSettingsProps) {
  if (isLoading) {
    return (
      <div className="animate-pulse space-y-2 rounded-[6px] bg-[rgba(13,148,136,0.05)] p-4">
        <div className="h-3 w-3/4 rounded-[4px] bg-[rgba(13,148,136,0.08)]" />
        <div className="h-2.5 w-1/2 rounded-[4px] bg-[rgba(13,148,136,0.08)]" />
      </div>
    );
  }

  // No training plan → no surplus to configure. Keeping this gate is what lets
  // the nutrition GET answer "does a plan exist?" with a boolean instead of
  // hydrating a ~210 kB plan payload just to test it for truthiness.
  if (!hasTrainingPlan) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <div className="space-y-0.5">
          <Label className="text-[12.5px] font-semibold text-[#0c1a1e]">
            Apply training day surplus
          </Label>
          <p className="text-[11px] text-[#93b0b4] leading-[1.4]">
            When on, training days get a percentage boost above baseline calories
          </p>
        </div>
        <Switch
          checked={includeActivityBurn}
          onCheckedChange={onToggleActivityBurn}
          disabled={isSavingToggle}
        />
      </div>

      {/* Surplus distribution — only relevant when the surplus adds calories */}
      {includeActivityBurn && (
        <div className="flex items-center justify-between px-1 pt-1">
          <div className="space-y-0.5">
            <Label className="text-[12.5px] font-semibold text-[#0c1a1e]">
              Add training calories as
            </Label>
            <p className="text-[11px] text-[#93b0b4] leading-[1.4]">
              Keep split honors your carb:fat ratio; carbs only fuels with carbs
            </p>
          </div>
          <div className="flex-shrink-0">
            <SegmentedControl
              options={[
                { value: "split", label: "Keep split", disabled: isSavingSurplus },
                { value: "carbs", label: "Carbs only", disabled: isSavingSurplus },
              ]}
              value={surplusAsCarbs ? "carbs" : "split"}
              onChange={(value) => onToggleSurplusAsCarbs(value === "carbs")}
            />
          </div>
        </div>
      )}
    </div>
  );
}
