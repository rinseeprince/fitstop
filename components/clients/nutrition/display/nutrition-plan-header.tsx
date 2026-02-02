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
          <h3 className="text-xl font-semibold text-gray-900">Nutrition Targets</h3>
          {client.nutritionPlanCreatedDate && (
            <p className="text-sm text-gray-500 mt-0.5">
              Created on {format(new Date(client.nutritionPlanCreatedDate), "MMM d, yyyy")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {onRegenerate && (
            <Button
              size="sm"
              onClick={onRegenerate}
              className="bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90"
            >
              <Sparkles className="h-4 w-4 mr-1.5" />
              Regenerate Plan
            </Button>
          )}
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-50 text-green-600">
            Plan active
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onShowHistory}
            className="text-gray-600 hover:text-gray-900 hover:bg-gray-100 font-medium rounded-lg transition-all"
          >
            <History className="h-4 w-4 mr-2" />
            History
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="bg-warning/5 rounded-xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Weekly Total</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-gray-900">{weeklyTotal.toLocaleString()}</span>
              <span className="text-base text-gray-500">cal</span>
            </div>
          </div>

          {weightRemaining && (
            <div className="text-right">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Progress</p>
              <div className="flex items-center gap-2">
                {weightRemaining.isLoss ? (
                  <TrendingDown className="w-5 h-5 text-green-500" />
                ) : (
                  <TrendingUp className="w-5 h-5 text-blue-500" />
                )}
                <span className="text-xl font-semibold text-gray-900">
                  {weightRemaining.isLoss ? "-" : "+"}
                  {weightRemaining.value} {weightRemaining.unit} to go
                </span>
              </div>
            </div>
          )}

          <div className="text-right">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Schedule</p>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-teal-50 text-teal-600">
                <Dumbbell className="h-3 w-3" />
                {trainingDaysCount} training
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                <Moon className="h-3 w-3" />
                {restDaysCount} rest
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Projected date */}
      {projectedDate && (
        <div className="text-sm text-gray-500">
          Projected goal date:{" "}
          <span className="font-medium text-gray-900">
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
