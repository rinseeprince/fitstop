"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { PhaseReviewData } from "@/types/roadmap";

type PhaseReviewStatsProps = {
  data: PhaseReviewData;
};

export function PhaseReviewStats({ data }: PhaseReviewStatsProps) {
  const startWeight = data.bodyMetrics.start?.weight;
  const currentWeight = data.bodyMetrics.current?.weight;
  const weightDelta =
    startWeight && currentWeight ? currentWeight - startWeight : null;

  const startBf = data.bodyMetrics.start?.bodyFatPercentage;
  const currentBf = data.bodyMetrics.current?.bodyFatPercentage;
  const bfDelta = startBf && currentBf ? currentBf - startBf : null;

  return (
    <div className="space-y-4">
      {/* Duration */}
      <p className="text-xs text-muted-foreground">
        {data.durationDays} day{data.durationDays !== 1 ? "s" : ""} in this
        phase
      </p>

      {/* Body metrics comparison */}
      {(startWeight || currentWeight) && (
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            label="Weight"
            startValue={startWeight ? `${startWeight} kg` : "-"}
            endValue={currentWeight ? `${currentWeight} kg` : "-"}
            delta={weightDelta}
            unit="kg"
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
