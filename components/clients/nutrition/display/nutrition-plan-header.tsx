"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { History, Dumbbell, Moon } from "lucide-react";
import { format } from "date-fns";
import type { Client } from "@/types/check-in";

type NutritionPlanHeaderProps = {
  client: Client;
  weeklyTotal: number;
  weightRemaining: { value: string; unit: string; isLoss: boolean } | null;
  trainingDaysCount: number;
  restDaysCount: number;
  projectedDate: Date | null;
  formatWeight: (kg: number) => string;
  onShowHistory: () => void;
};

export function NutritionPlanHeader({
  client,
  weeklyTotal,
  weightRemaining,
  trainingDaysCount,
  restDaysCount,
  projectedDate,
  formatWeight,
  onShowHistory,
}: NutritionPlanHeaderProps) {
  return (
    <div className="space-y-4 pb-4 border-b">
      {/* Title and History button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Nutrition Targets</h3>
          {client.nutritionPlanCreatedDate && (
            <p className="text-sm text-muted-foreground">
              Created on {format(new Date(client.nutritionPlanCreatedDate), "MMM d, yyyy")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">Plan active</Badge>
          <Button variant="ghost" size="sm" onClick={onShowHistory} className="gap-2">
            <History className="h-4 w-4" />
            History
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-muted/50 rounded-lg p-4">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Weekly Total</p>
          <p className="text-2xl font-bold">{weeklyTotal.toLocaleString()} cal</p>
        </div>

        {weightRemaining && (
          <div className="text-right">
            <p className="text-xs text-muted-foreground mb-1">Progress</p>
            <p className="text-lg font-semibold">
              {weightRemaining.isLoss ? "-" : "+"}
              {weightRemaining.value} {weightRemaining.unit} to go
            </p>
          </div>
        )}

        <div className="text-right">
          <p className="text-xs text-muted-foreground mb-1">Schedule</p>
          <div className="flex items-center gap-2">
            <Badge variant="default" className="text-xs bg-green-600">
              <Dumbbell className="h-3 w-3 mr-1" />
              {trainingDaysCount} training
            </Badge>
            <Badge variant="outline" className="text-xs">
              <Moon className="h-3 w-3 mr-1" />
              {restDaysCount} rest
            </Badge>
          </div>
        </div>
      </div>

      {/* Projected date */}
      {projectedDate && (
        <div className="text-sm text-muted-foreground">
          Projected goal date:{" "}
          <span className="font-medium text-foreground">
            {format(projectedDate, "MMM d, yyyy")}
          </span>
          {client.goalDeadline && new Date(client.goalDeadline) < projectedDate && (
            <span className="text-amber-600 ml-2">
              (
              {Math.ceil(
                (projectedDate.getTime() - new Date(client.goalDeadline).getTime()) /
                  (1000 * 60 * 60 * 24)
              )}{" "}
              days past target)
            </span>
          )}
          {client.goalDeadline && new Date(client.goalDeadline) > projectedDate && (
            <span className="text-green-600 ml-2">
              (
              {Math.ceil(
                (new Date(client.goalDeadline).getTime() - projectedDate.getTime()) /
                  (1000 * 60 * 60 * 24)
              )}{" "}
              days ahead)
            </span>
          )}
        </div>
      )}
    </div>
  );
}
