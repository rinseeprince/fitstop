"use client";

import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
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
      className="space-y-2"
    >
      {targets.map((day) => (
        <AccordionItem
          key={day.day}
          value={day.day}
          className="border rounded-lg"
        >
          <AccordionTrigger className="px-4 hover:no-underline">
            <div className="flex flex-1 items-center justify-between pr-2">
              <div className="flex items-center gap-3">
                <span className="font-medium">{day.dayLabel}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {day.calories.toLocaleString()} cal
                </Badge>
                {(day.trainingSessionCalories > 0 || day.externalActivityCalories > 0) && (
                  <Badge variant="outline" className="text-xs text-orange-600">
                    <Activity className="h-3 w-3 mr-1" />
                    +{day.trainingSessionCalories + day.externalActivityCalories}
                  </Badge>
                )}
                {day.isTrainingDay ? (
                  <Badge
                    variant="default"
                    className="text-xs bg-green-600 hover:bg-green-700"
                  >
                    <Dumbbell className="h-3 w-3 mr-1" />
                    Training
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs text-muted-foreground">
                    <Moon className="h-3 w-3 mr-1" />
                    Rest
                  </Badge>
                )}
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <div className="space-y-4">
              {/* Calorie Target */}
              <div className="text-center border-b pb-3">
                <div className="text-3xl font-bold text-primary">
                  {day.calories.toLocaleString()}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  total calories
                </div>
                {(day.trainingSessionCalories > 0 || day.externalActivityCalories > 0) && (
                  <div className="text-xs text-muted-foreground mt-2 space-y-1">
                    <div className="flex items-center justify-center gap-2">
                      <span>Base: {day.baselineCalories.toLocaleString()}</span>
                      <span>+</span>
                      <span className="flex items-center gap-1 text-orange-600">
                        <Flame className="h-3 w-3" />
                        {day.trainingSessionCalories + day.externalActivityCalories}
                      </span>
                    </div>
                    {day.trainingSessions?.map((session, idx) => (
                      <div key={`training-${idx}`} className="text-xs text-green-600/80">
                        {session.name}: +{session.calories} cal
                      </div>
                    ))}
                    {day.externalActivities?.map((activity, idx) => (
                      <div key={`external-${idx}`} className="text-xs text-orange-600/80">
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
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="font-medium text-sm">Protein</span>
                    <div className="text-right">
                      <span className="font-semibold text-sm">{day.proteinG}g</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {day.proteinPercent}%
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-1.5">
                    <div
                      className="bg-blue-500 h-1.5 rounded-full"
                      style={{ width: `${day.proteinPercent}%` }}
                    />
                  </div>
                </div>

                {/* Carbs */}
                <div>
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="font-medium text-sm">Carbs</span>
                    <div className="text-right">
                      <span className="font-semibold text-sm">{day.carbsG}g</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {day.carbsPercent}%
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-1.5">
                    <div
                      className="bg-green-500 h-1.5 rounded-full"
                      style={{ width: `${day.carbsPercent}%` }}
                    />
                  </div>
                </div>

                {/* Fat */}
                <div>
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="font-medium text-sm">Fat</span>
                    <div className="text-right">
                      <span className="font-semibold text-sm">{day.fatG}g</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {day.fatPercent}%
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-1.5">
                    <div
                      className="bg-amber-500 h-1.5 rounded-full"
                      style={{ width: `${day.fatPercent}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Macro Summary */}
              <div className="grid grid-cols-3 gap-3 pt-3 border-t">
                <div className="text-center">
                  <div className="text-lg font-bold text-blue-500">{day.proteinG}g</div>
                  <div className="text-xs text-muted-foreground">Protein</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-green-500">{day.carbsG}g</div>
                  <div className="text-xs text-muted-foreground">Carbs</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-amber-500">{day.fatG}g</div>
                  <div className="text-xs text-muted-foreground">Fat</div>
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
