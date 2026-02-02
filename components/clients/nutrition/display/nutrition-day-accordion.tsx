"use client";

import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Dumbbell, Moon, Activity, Flame } from "lucide-react";

type NutritionDayAccordionProps = {
  targets: DailyNutritionTargets[];
  defaultExpanded?: string;
};

export function NutritionDayAccordion({
  targets,
  defaultExpanded = "monday",
}: NutritionDayAccordionProps) {
  return (
    <Accordion
      type="single"
      collapsible
      defaultValue={defaultExpanded}
      className="space-y-4"
    >
      {targets.map((day) => (
        <AccordionItem
          key={day.day}
          value={day.day}
          className="bg-white rounded-xl border border-gray-200 overflow-hidden"
        >
          <AccordionTrigger className="px-5 hover:no-underline hover:bg-gray-50/50 rounded-xl transition-colors">
            <div className="flex flex-1 items-center justify-between pr-2">
              <div className="flex items-center gap-3">
                <span className="font-medium text-gray-900">{day.dayLabel}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-600">
                  {day.calories.toLocaleString()} cal
                </span>
                {(day.trainingSessionCalories > 0 || day.externalActivityCalories > 0) && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-orange-50 text-orange-600">
                    <Activity className="h-3 w-3" />
                    +{day.trainingSessionCalories + day.externalActivityCalories}
                  </span>
                )}
                {day.isTrainingDay ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-teal-50 text-teal-600">
                    <Dumbbell className="h-3 w-3" />
                    Training
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                    <Moon className="h-3 w-3" />
                    Rest
                  </span>
                )}
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-5 pb-5">
            <div className="space-y-4">
              {/* Calorie Target */}
              <div className="text-center pb-4">
                <div className="text-3xl font-bold text-warning">
                  {day.calories.toLocaleString()}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  total calories
                </div>
                {(day.trainingSessionCalories > 0 || day.externalActivityCalories > 0) && (
                  <div className="text-xs text-gray-500 mt-2 space-y-1">
                    <div className="flex items-center justify-center gap-2">
                      <span>Base: {day.baselineCalories.toLocaleString()}</span>
                      <span>+</span>
                      <span className="flex items-center gap-1 text-warning font-medium">
                        <Flame className="h-3 w-3" />
                        {day.trainingSessionCalories + day.externalActivityCalories}
                      </span>
                    </div>
                    {day.trainingSessions?.map((session, idx) => (
                      <div key={`training-${idx}`} className="text-xs text-secondary">
                        {session.name}: +{session.calories} cal
                      </div>
                    ))}
                    {day.externalActivities?.map((activity, idx) => (
                      <div key={`external-${idx}`} className="text-xs text-warning">
                        {activity.name}: +{activity.calories} cal
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Macro Breakdown */}
              <div className="space-y-3">
                {/* Protein */}
                <div>
                  <div className="flex justify-between items-baseline mb-1.5">
                    <span className="font-medium text-sm text-gray-700">Protein</span>
                    <div className="text-right">
                      <span className="font-semibold text-sm text-gray-900">{day.proteinG}g</span>
                      <span className="text-xs text-gray-500 ml-2">
                        {day.proteinPercent}%
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all"
                      style={{ width: `${day.proteinPercent}%` }}
                    />
                  </div>
                </div>

                {/* Carbs */}
                <div>
                  <div className="flex justify-between items-baseline mb-1.5">
                    <span className="font-medium text-sm text-gray-700">Carbs</span>
                    <div className="text-right">
                      <span className="font-semibold text-sm text-gray-900">{day.carbsG}g</span>
                      <span className="text-xs text-gray-500 ml-2">
                        {day.carbsPercent}%
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className="bg-success h-2 rounded-full transition-all"
                      style={{ width: `${day.carbsPercent}%` }}
                    />
                  </div>
                </div>

                {/* Fat */}
                <div>
                  <div className="flex justify-between items-baseline mb-1.5">
                    <span className="font-medium text-sm text-gray-700">Fat</span>
                    <div className="text-right">
                      <span className="font-semibold text-sm text-gray-900">{day.fatG}g</span>
                      <span className="text-xs text-gray-500 ml-2">
                        {day.fatPercent}%
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className="bg-warning h-2 rounded-full transition-all"
                      style={{ width: `${day.fatPercent}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Macro Summary */}
              <div className="grid grid-cols-3 gap-3 pt-4">
                <div className="text-center bg-blue-50/50 rounded-xl p-4">
                  <div className="text-xl font-bold text-blue-600">{day.proteinG}g</div>
                  <div className="text-xs text-gray-500">Protein</div>
                </div>
                <div className="text-center bg-green-50/50 rounded-xl p-4">
                  <div className="text-xl font-bold text-green-600">{day.carbsG}g</div>
                  <div className="text-xs text-gray-500">Carbs</div>
                </div>
                <div className="text-center bg-amber-50/50 rounded-xl p-4">
                  <div className="text-xl font-bold text-amber-600">{day.fatG}g</div>
                  <div className="text-xs text-gray-500">Fat</div>
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
