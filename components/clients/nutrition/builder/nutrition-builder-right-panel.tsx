"use client";

import { useState, memo } from "react";
import { Button } from "@/components/ui/button";
import { useNutritionBuilderContext } from "@/contexts/nutrition-builder-context";
import { NutritionPlanHeader } from "../display/nutrition-plan-header";
import { WeeklyNutritionView } from "../display/weekly-nutrition-view";
import { NutritionDayAccordion } from "../display/nutrition-day-accordion";
import { NutritionPlanHistoryModal } from "../nutrition-plan-history-modal";
import { NutritionWarnings } from "../nutrition-warnings";
import { CalendarDays, LayoutList, Apple, Loader2 } from "lucide-react";

export const NutritionBuilderRightPanel = memo(function NutritionBuilderRightPanel() {
  const builder = useNutritionBuilderContext();
  const [viewMode, setViewMode] = useState<"week" | "list">("week");
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // Loading state for training plan
  if (builder.isLoadingTrainingPlan) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-50 rounded-lg border-2 border-dashed border-slate-200">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  // Empty state - no nutrition plan
  if (!builder.hasPlan) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-50 rounded-lg border-2 border-dashed border-slate-200 p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
          <Apple className="h-8 w-8 text-slate-400" />
        </div>
        <h3 className="text-lg font-medium text-slate-700 mb-2">No nutrition plan yet</h3>
        <p className="text-sm text-slate-500 max-w-sm">
          Configure your nutrition settings on the left and generate a plan to see your daily
          calorie and macro targets.
        </p>
      </div>
    );
  }

  // Plan exists - show content
  return (
    <div className="flex flex-col h-full">
      {/* Warnings */}
      {builder.warnings.length > 0 && (
        <div className="mb-4">
          <NutritionWarnings warnings={builder.warnings} />
        </div>
      )}

      {/* Header */}
      <NutritionPlanHeader
        client={builder.client}
        weeklyTotal={builder.weeklyTotal}
        weightRemaining={builder.weightRemaining}
        trainingDaysCount={builder.trainingDaysCount}
        restDaysCount={builder.restDaysCount}
        projectedDate={builder.projectedDate}
        formatWeight={builder.formatWeight}
        onShowHistory={() => setShowHistoryModal(true)}
      />

      {/* View Toggle */}
      <div className="flex items-center justify-end gap-1 border-b pb-2 mb-4 mt-4">
        <span className="text-sm text-muted-foreground mr-2">View:</span>
        <Button
          variant={viewMode === "week" ? "default" : "ghost"}
          size="sm"
          onClick={() => setViewMode("week")}
          className="h-8"
        >
          <CalendarDays className="h-4 w-4 mr-1" />
          Week
        </Button>
        <Button
          variant={viewMode === "list" ? "default" : "ghost"}
          size="sm"
          onClick={() => setViewMode("list")}
          className="h-8"
        >
          <LayoutList className="h-4 w-4 mr-1" />
          List
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {builder.weeklyTargets ? (
          viewMode === "week" ? (
            <WeeklyNutritionView targets={builder.weeklyTargets} />
          ) : (
            <NutritionDayAccordion targets={builder.weeklyTargets} />
          )
        ) : builder.client.customMacrosEnabled ? (
          <CustomMacrosDisplay
            calories={builder.client.calorieTarget || 0}
            protein={builder.client.customProteinG || builder.client.proteinTargetG || 0}
            carbs={builder.client.customCarbG || builder.client.carbTargetG || 0}
            fat={builder.client.customFatG || builder.client.fatTargetG || 0}
          />
        ) : null}
      </div>

      {/* History Modal */}
      <NutritionPlanHistoryModal
        clientId={builder.client.id}
        unitPreference={builder.unitPreference}
        open={showHistoryModal}
        onOpenChange={setShowHistoryModal}
      />
    </div>
  );
});

type CustomMacrosDisplayProps = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

function CustomMacrosDisplay({ calories, protein, carbs, fat }: CustomMacrosDisplayProps) {
  return (
    <div className="text-center py-6 border rounded-lg">
      <div className="text-4xl font-bold text-primary">{calories.toLocaleString()}</div>
      <div className="text-sm text-muted-foreground mt-1">calories per day (custom macros)</div>
      <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t mx-4">
        <div className="text-center">
          <div className="text-xl font-bold text-blue-500">{protein}g</div>
          <div className="text-xs text-muted-foreground">Protein</div>
        </div>
        <div className="text-center">
          <div className="text-xl font-bold text-green-500">{carbs}g</div>
          <div className="text-xs text-muted-foreground">Carbs</div>
        </div>
        <div className="text-center">
          <div className="text-xl font-bold text-amber-500">{fat}g</div>
          <div className="text-xs text-muted-foreground">Fat</div>
        </div>
      </div>
      <p className="text-xs text-amber-600 mt-3">Custom macros active - same targets each day</p>
    </div>
  );
}
