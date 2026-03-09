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
          className="bg-card rounded-lg border border-border overflow-hidden"
        >
          <AccordionTrigger className="px-5 hover:no-underline hover:bg-muted/50 rounded-lg transition-colors">
            <div className="flex flex-1 items-center justify-between pr-2">
              <div className="flex items-center gap-3">
                <span className="font-medium text-foreground">{day.dayLabel}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center px-3 py-1 rounded-md text-xs font-medium bg-fat/10 text-fat">
                  {day.calories.toLocaleString()} cal
                </span>
                {(day.trainingSessionCalories > 0 || day.externalActivityCalories > 0) && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-warning/10 text-warning">
                    <Activity className="h-3 w-3" />
                    +{day.trainingSessionCalories + day.externalActivityCalories}
                  </span>
                )}
                {day.isTrainingDay ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium bg-training/10 text-training">
                    <Dumbbell className="h-3 w-3" />
                    Training
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium bg-muted text-muted-foreground">
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
                <div className="text-3xl font-semibold text-warning">
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
                    <span className="font-medium text-sm text-foreground">Protein</span>
                    <div className="text-right">
                      <span className="font-semibold text-sm text-foreground">{day.proteinG}g</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {day.proteinPercent}%
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all"
                      style={{ width: `${day.proteinPercent}%` }}
                    />
                  </div>
                </div>

                {/* Carbs */}
                <div>
                  <div className="flex justify-between items-baseline mb-1.5">
                    <span className="font-medium text-sm text-foreground">Carbs</span>
                    <div className="text-right">
                      <span className="font-semibold text-sm text-foreground">{day.carbsG}g</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {day.carbsPercent}%
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="bg-success h-2 rounded-full transition-all"
                      style={{ width: `${day.carbsPercent}%` }}
                    />
                  </div>
                </div>

                {/* Fat */}
                <div>
                  <div className="flex justify-between items-baseline mb-1.5">
                    <span className="font-medium text-sm text-foreground">Fat</span>
                    <div className="text-right">
                      <span className="font-semibold text-sm text-foreground">{day.fatG}g</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {day.fatPercent}%
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="bg-warning h-2 rounded-full transition-all"
                      style={{ width: `${day.fatPercent}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Macro Summary */}
              <div className="grid grid-cols-3 gap-3 pt-4">
                <div className="text-center bg-protein/10 rounded-lg p-4">
                  <div className="text-xl font-semibold text-protein">{day.proteinG}g</div>
                  <div className="text-xs text-muted-foreground">Protein</div>
                </div>
                <div className="text-center bg-carbs/10 rounded-lg p-4">
                  <div className="text-xl font-semibold text-carbs">{day.carbsG}g</div>
                  <div className="text-xs text-muted-foreground">Carbs</div>
                </div>
                <div className="text-center bg-fat/10 rounded-lg p-4">
                  <div className="text-xl font-semibold text-fat">{day.fatG}g</div>
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
