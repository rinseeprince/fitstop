"use client";

import { TrendingUp, TrendingDown, Minus, Target } from "lucide-react";
import { weightFromKg } from "@/utils/nutrition-helpers";
import type { PhaseReviewData } from "@/types/roadmap";

type PhaseReviewStatsProps = {
  data: PhaseReviewData;
  weightUnit: "lbs" | "kg";
};

export function PhaseReviewStats({ data, weightUnit }: PhaseReviewStatsProps) {
  const startWeight = data.bodyMetrics.start?.weight;
  const currentWeight = data.bodyMetrics.current?.weight;
  const weightDeltaKg =
    startWeight && currentWeight ? currentWeight - startWeight : null;
  const weightDelta =
    weightDeltaKg != null ? weightFromKg(Math.abs(weightDeltaKg), weightUnit) * Math.sign(weightDeltaKg) : null;

  const startBf = data.bodyMetrics.start?.bodyFatPercentage;
  const currentBf = data.bodyMetrics.current?.bodyFatPercentage;
  const bfDelta = startBf && currentBf ? currentBf - startBf : null;

  const displayWeight = (w: number) => weightFromKg(w, weightUnit).toFixed(1);

  return (
    <div className="space-y-4">
      {/* Duration */}
      <p className="text-xs text-muted-foreground">
        {data.durationDays} day{data.durationDays !== 1 ? "s" : ""} in this
        phase
      </p>

      {/* Phase Goal Progress */}
      {data.phaseGoals && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Target className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs font-medium text-muted-foreground">Phase Goal Progress</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {data.phaseGoals.goalWeight != null && (
              <MetricCard
                label="Goal Weight"
                startValue={`${displayWeight(data.phaseGoals.goalWeight)} ${weightUnit}`}
                endValue={currentWeight ? `${displayWeight(currentWeight)} ${weightUnit}` : "-"}
                delta={
                  currentWeight != null
                    ? weightFromKg(Math.abs(currentWeight - data.phaseGoals.goalWeight), weightUnit) * Math.sign(currentWeight - data.phaseGoals.goalWeight)
                    : null
                }
                unit={weightUnit}
              />
            )}
            {data.phaseGoals.goalBodyFatPercentage != null && (
              <MetricCard
                label="Goal Body Fat"
                startValue={`${data.phaseGoals.goalBodyFatPercentage}%`}
                endValue={currentBf ? `${currentBf}%` : "-"}
                delta={
                  currentBf != null
                    ? currentBf - data.phaseGoals.goalBodyFatPercentage
                    : null
                }
                unit="%"
              />
            )}
          </div>
        </div>
      )}

      {/* Body metrics comparison */}
      {(startWeight || currentWeight) && (
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            label="Weight"
            startValue={startWeight ? `${displayWeight(startWeight)} ${weightUnit}` : "-"}
            endValue={currentWeight ? `${displayWeight(currentWeight)} ${weightUnit}` : "-"}
            delta={weightDelta}
            unit={weightUnit}
          />
          {(startBf || currentBf) && (
            <MetricCard
              label="Body Fat"
              startValue={startBf ? `${startBf}%` : "-"}
              endValue={currentBf ? `${currentBf}%` : "-"}
              delta={bfDelta}
              unit="%"
            />
          )}
        </div>
      )}

      {/* Adherence stats */}
      <div className="grid grid-cols-3 gap-3">
        {data.trainingAdherence && (
          <StatCard
            label="Training"
            value={
              data.trainingAdherence.percentage !== null
                ? `${data.trainingAdherence.percentage}%`
                : `${data.trainingAdherence.completed}`
            }
            detail={
              data.trainingAdherence.prescribed > 0
                ? `${data.trainingAdherence.completed}/${data.trainingAdherence.prescribed} sessions`
                : `${data.trainingAdherence.completed} sessions`
            }
          />
        )}
        {data.nutritionAdherence && (
          <StatCard
            label="Nutrition"
            value={`${data.nutritionAdherence.averageScore}%`}
            detail={`${data.nutritionAdherence.logsCount} days logged`}
          />
        )}
        {data.habitCompletion && (
          <StatCard
            label="Habits"
            value={`${data.habitCompletion.percentage}%`}
            detail={`${data.habitCompletion.completed}/${data.habitCompletion.total}`}
          />
        )}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  startValue,
  endValue,
  delta,
  unit,
}: {
  label: string;
  startValue: string;
  endValue: string;
  delta: number | null;
  unit: string;
}) {
  return (
    <div className="rounded-md border p-3 space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-center justify-between text-sm">
        <span>{startValue}</span>
        <span className="text-muted-foreground">to</span>
        <span className="font-medium">{endValue}</span>
      </div>
      {delta !== null && (
        <div className="flex items-center gap-1 text-xs">
          {delta < 0 ? (
            <TrendingDown className="h-3 w-3 text-green-600" />
          ) : delta > 0 ? (
            <TrendingUp className="h-3 w-3 text-red-600" />
          ) : (
            <Minus className="h-3 w-3 text-muted-foreground" />
          )}
          <span
            className={
              delta < 0
                ? "text-green-600"
                : delta > 0
                  ? "text-red-600"
                  : "text-muted-foreground"
            }
          >
            {delta > 0 ? "+" : ""}
            {delta.toFixed(1)} {unit}
          </span>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border p-3 text-center space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
