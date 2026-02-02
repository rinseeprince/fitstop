"use client";

import { useState, memo } from "react";
import { useNutritionBuilderContext } from "@/contexts/nutrition-builder-context";
import { NutritionPlanHeader } from "../display/nutrition-plan-header";
import { WeeklyNutritionView } from "../display/weekly-nutrition-view";
import { NutritionDayAccordion } from "../display/nutrition-day-accordion";
import { NutritionPlanHistoryModal } from "../nutrition-plan-history-modal";
import { NutritionWarnings } from "../nutrition-warnings";
import { Button } from "@/components/ui/button";
import { CalendarDays, LayoutList, Apple, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type NutritionBuilderRightPanelProps = {
  onOpenSettings?: () => void;
};

export const NutritionBuilderRightPanel = memo(function NutritionBuilderRightPanel({
  onOpenSettings,
}: NutritionBuilderRightPanelProps) {
  const builder = useNutritionBuilderContext();
  const [viewMode, setViewMode] = useState<"week" | "list">("week");
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // Loading state for training plan
  if (builder.isLoadingTrainingPlan) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 rounded-xl">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Empty state - no nutrition plan
  if (!builder.hasPlan) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 px-8 text-center">
        <div className="w-16 h-16 rounded-full bg-warning/15 flex items-center justify-center mb-4">
          <Apple className="h-8 w-8 text-warning" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">No nutrition plan yet</h3>
        <p className="text-sm text-gray-500 max-w-sm mb-6">
          Generate a customized nutrition plan based on your client&apos;s goals, activity level, and training schedule.
        </p>
        {onOpenSettings && (
          <Button
            onClick={onOpenSettings}
            className="bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            Generate Plan
          </Button>
        )}
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
        onShowHistory={() => setShowHistoryModal(true)}
        onRegenerate={onOpenSettings}
      />

      {/* View Toggle - Segmented Control */}
      <div className="flex items-center justify-between mt-6 mb-4">
        <span className="text-sm font-medium text-gray-500">View</span>
        <div className="bg-gray-100 p-1 rounded-lg inline-flex">
          <button
            onClick={() => setViewMode("week")}
            className={cn(
              "px-4 py-2 text-sm font-medium rounded-md flex items-center gap-2 transition-all",
              viewMode === "week"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            <CalendarDays className="h-4 w-4" />
            Week
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={cn(
              "px-4 py-2 text-sm font-medium rounded-md flex items-center gap-2 transition-all",
              viewMode === "list"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            <LayoutList className="h-4 w-4" />
            List
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto space-y-8">
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
    <div className="bg-warning/5 rounded-xl p-8 text-center">
      <div className="text-4xl font-bold text-warning">{calories.toLocaleString()}</div>
      <div className="text-sm text-gray-500 mt-2">calories per day (custom macros)</div>
      <div className="grid grid-cols-3 gap-4 mt-6 pt-6">
        <div className="text-center bg-blue-50/50 rounded-xl p-4">
          <div className="text-2xl font-bold text-blue-600">{protein}g</div>
          <div className="text-xs text-gray-500 mt-1">Protein</div>
        </div>
        <div className="text-center bg-green-50/50 rounded-xl p-4">
          <div className="text-2xl font-bold text-green-600">{carbs}g</div>
          <div className="text-xs text-gray-500 mt-1">Carbs</div>
        </div>
        <div className="text-center bg-amber-50/50 rounded-xl p-4">
          <div className="text-2xl font-bold text-amber-600">{fat}g</div>
          <div className="text-xs text-gray-500 mt-1">Fat</div>
        </div>
      </div>
      <p className="text-xs text-amber-600 mt-4 font-medium">Custom macros active - same targets each day</p>
    </div>
  );
}
