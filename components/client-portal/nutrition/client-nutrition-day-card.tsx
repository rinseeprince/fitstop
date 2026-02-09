"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChevronDown,
  Flame,
  Dumbbell,
  Moon,
  Beef,
  Wheat,
  Droplets,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";

interface ClientNutritionDayCardProps {
  dayTarget: DailyNutritionTargets;
}

export function ClientNutritionDayCard({ dayTarget }: ClientNutritionDayCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  const hasActivities =
    dayTarget.trainingSessionCalories > 0 || dayTarget.externalActivityCalories > 0;

  const totalActivityCalories = dayTarget.trainingSessionCalories + dayTarget.externalActivityCalories;

  return (
    <Card className={cn(
      "transition-colors",
      dayTarget.isTrainingDay
        ? "border-primary/30 bg-primary/5"
        : "border-border"
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base capitalize">{dayTarget.dayLabel}</CardTitle>
              <Badge 
                variant={dayTarget.isTrainingDay ? "default" : "secondary"}
                className={cn(
                  "shrink-0",
                  dayTarget.isTrainingDay 
                    ? "bg-primary text-primary-foreground" 
                    : "bg-gray-100 text-gray-600"
                )}
              >
                {dayTarget.isTrainingDay ? (
                  <>
                    <Dumbbell className="mr-1 h-3 w-3" />
                    Training
                  </>
                ) : (
                  <>
                    <Moon className="mr-1 h-3 w-3" />
                    Rest
                  </>
                )}
              </Badge>
            </div>
            
            <div className="mt-1 flex items-center gap-2">
              <span className="text-2xl font-bold text-primary">
                {dayTarget.calories.toLocaleString()}
              </span>
              <span className="text-sm text-muted-foreground">calories</span>
              {hasActivities && (
                <div className="flex items-center gap-1 text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded">
                  <Flame className="h-3 w-3" />
                  +{totalActivityCalories}
                </div>
              )}
            </div>
            
            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Beef className="h-3.5 w-3.5 text-red-500" />
                {dayTarget.proteinG}g protein
              </span>
              <span className="flex items-center gap-1">
                <Wheat className="h-3.5 w-3.5 text-amber-500" />
                {dayTarget.carbsG}g carbs
              </span>
              <span className="flex items-center gap-1">
                <Droplets className="h-3.5 w-3.5 text-blue-500" />
                {dayTarget.fatG}g fat
              </span>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-between text-muted-foreground hover:text-foreground"
            >
              <span>View details</span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform",
                  isOpen && "rotate-180"
                )}
              />
            </Button>
          </CollapsibleTrigger>

          <CollapsibleContent className="mt-3">
            <div className="space-y-4">
              {/* Calorie breakdown */}
              {hasActivities && (
                <div className="rounded-md bg-muted/50 p-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Calorie Breakdown
                  </p>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span>Baseline calories</span>
                      <span>{dayTarget.baselineCalories.toLocaleString()}</span>
                    </div>
                    {dayTarget.trainingSessionCalories > 0 && (
                      <div className="flex justify-between text-primary">
                        <span>Training sessions</span>
                        <span>+{dayTarget.trainingSessionCalories}</span>
                      </div>
                    )}
                    {dayTarget.externalActivityCalories > 0 && (
                      <div className="flex justify-between text-orange-600">
                        <span>Other activities</span>
                        <span>+{dayTarget.externalActivityCalories}</span>
                      </div>
                    )}
                    <div className="border-t pt-1 flex justify-between font-medium">
                      <span>Total</span>
                      <span>{dayTarget.calories.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Macro percentages */}
              <div className="rounded-md bg-muted/50 p-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Macro Distribution
                </p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-red-500"></div>
                      <span>Protein</span>
                    </div>
                    <span>{dayTarget.proteinG}g ({dayTarget.proteinPercent}%)</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-amber-500"></div>
                      <span>Carbs</span>
                    </div>
                    <span>{dayTarget.carbsG}g ({dayTarget.carbsPercent}%)</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                      <span>Fat</span>
                    </div>
                    <span>{dayTarget.fatG}g ({dayTarget.fatPercent}%)</span>
                  </div>
                </div>
              </div>

              {/* Activities */}
              {(dayTarget.trainingSessions?.length > 0 || dayTarget.externalActivities?.length > 0) && (
                <div className="rounded-md bg-muted/50 p-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Planned Activities
                  </p>
                  <div className="space-y-1">
                    {dayTarget.trainingSessions?.map((session, idx) => (
                      <div key={`training-${idx}`} className="flex justify-between text-sm">
                        <span className="flex items-center gap-1 text-primary">
                          <Dumbbell className="h-3 w-3" />
                          {session.name}
                        </span>
                        <span className="text-primary">+{session.calories} cal</span>
                      </div>
                    ))}
                    {dayTarget.externalActivities?.map((activity, idx) => (
                      <div key={`external-${idx}`} className="flex justify-between text-sm">
                        <span className="flex items-center gap-1 text-orange-600">
                          <Flame className="h-3 w-3" />
                          {activity.name}
                        </span>
                        <span className="text-orange-600">+{activity.calories} cal</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}