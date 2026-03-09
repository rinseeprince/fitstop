"use client";

import { Button } from "@/components/ui/button";
import { History, Dumbbell, Moon, TrendingUp, TrendingDown, Sparkles } from "lucide-react";
import { format } from "date-fns";
import type { Client } from "@/types/check-in";

type NutritionPlanHeaderProps = {
  client: Client;
  weeklyTotal: number;
  weightRemaining: { value: string; unit: string; isLoss: boolean } | null;
  trainingDaysCount: number;
  restDaysCount: number;
  projectedDate: Date | null;
  onShowHistory: () => void;
  onRegenerate?: () => void;
};

export function NutritionPlanHeader({
  client,
  weeklyTotal,
  weightRemaining,
  trainingDaysCount,
  restDaysCount,
  projectedDate,
  onShowHistory,
  onRegenerate,
}: NutritionPlanHeaderProps) {
  return (
    <div className="space-y-4">
      {/* Title and History button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-semibold text-foreground">Nutrition Targets</h3>
          {client.nutritionPlanCreatedDate && (
            <p className="text-sm text-muted-foreground mt-0.5">
              Created on {format(new Date(client.nutritionPlanCreatedDate), "MMM d, yyyy")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {onRegenerate && (
            <Button
              size="sm"
              onClick={onRegenerate}
              className="bg-primary hover:bg-primary/90"
            >
              <Sparkles className="h-4 w-4 mr-1.5" />
              Regenerate Plan
            </Button>
          )}
          <span className="inline-flex items-center px-3 py-1 rounded-md text-xs font-medium bg-success/10 text-success">
            Plan active
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onShowHistory}
            className="text-muted-foreground hover:text-foreground hover:bg-muted font-medium rounded-lg transition-all"
          >
            <History className="h-4 w-4 mr-2" />
            History
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="bg-warning/5 rounded-lg p-4">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Weekly Total</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold text-foreground">{weeklyTotal.toLocaleString()}</span>
              <span className="text-base text-muted-foreground">cal</span>
            </div>
          </div>

          {weightRemaining && (
            <div className="text-right">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Progress</p>
              <div className="flex items-center gap-2">
                {weightRemaining.isLoss ? (
                  <TrendingDown className="w-5 h-5 text-success" />
                ) : (
                  <TrendingUp className="w-5 h-5 text-primary" />
                )}
                <span className="text-xl font-semibold text-foreground">
                  {weightRemaining.isLoss ? "-" : "+"}
                  {weightRemaining.value} {weightRemaining.unit} to go
                </span>
              </div>
            </div>
          )}

          <div className="text-right">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Schedule</p>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium bg-training/10 text-training">
                <Dumbbell className="h-3 w-3" />
                {trainingDaysCount} training
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium bg-muted text-muted-foreground">
                <Moon className="h-3 w-3" />
                {restDaysCount} rest
              </span>
            </div>
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
            <span className="text-warning ml-2">
              (
              {Math.ceil(
                (projectedDate.getTime() - new Date(client.goalDeadline).getTime()) /
                  (1000 * 60 * 60 * 24)
              )}{" "}
              days past target)
            </span>
          )}
          {client.goalDeadline && new Date(client.goalDeadline) > projectedDate && (
            <span className="text-success ml-2">
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
