"use client";

import {
  TrendingUp,
  TrendingDown,
  Minus,
  Target,
  Calendar,
} from "lucide-react";
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
    weightDeltaKg != null
      ? weightFromKg(Math.abs(weightDeltaKg), weightUnit) *
        Math.sign(weightDeltaKg)
      : null;

  const startBf = data.bodyMetrics.start?.bodyFatPercentage;
  const currentBf = data.bodyMetrics.current?.bodyFatPercentage;
  const bfDelta = startBf && currentBf ? currentBf - startBf : null;

  const displayWeight = (w: number) => weightFromKg(w, weightUnit).toFixed(1);

  return (
    <div className="space-y-4">
      {/* Duration badge */}
      <div className="inline-flex items-center gap-1.5 rounded-[6px] bg-[rgba(13,148,136,0.05)] px-2.5 py-1.5">
        <Calendar className="h-3.5 w-3.5 text-[#5a7d82]" />
        <span className="text-[12px] font-medium text-[#5a7d82]">
          {data.durationDays} day{data.durationDays !== 1 ? "s" : ""} in this
          phase
        </span>
      </div>

      {/* Phase Goal Progress */}
      {data.phaseGoals && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Target className="h-3.5 w-3.5 text-[#93b0b4]" />
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#93b0b4]">
              Phase Goal Progress
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {data.phaseGoals.goalWeight != null && (
              <MetricCard
                label="Goal Weight"
                startValue={`${displayWeight(data.phaseGoals.goalWeight)} ${weightUnit}`}
                endValue={
                  currentWeight
                    ? `${displayWeight(currentWeight)} ${weightUnit}`
                    : "-"
                }
                delta={
                  currentWeight != null
                    ? weightFromKg(
                        Math.abs(currentWeight - data.phaseGoals.goalWeight),
                        weightUnit
                      ) *
                      Math.sign(currentWeight - data.phaseGoals.goalWeight)
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
            startValue={
              startWeight
                ? `${displayWeight(startWeight)} ${weightUnit}`
                : "-"
            }
            endValue={
              currentWeight
                ? `${displayWeight(currentWeight)} ${weightUnit}`
                : "-"
            }
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
      <div className="flex rounded-[6px] border border-[rgba(13,148,136,0.08)]">
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
            showBorder
          />
        )}
        {data.nutritionAdherence && (
          <StatCard
            label="Nutrition"
            value={`${data.nutritionAdherence.averageScore}%`}
            detail={`${data.nutritionAdherence.logsCount} days logged`}
            showBorder
          />
        )}
        {data.habitCompletion && (
          <StatCard
            label="Habits"
            value={`${data.habitCompletion.percentage}%`}
            detail={`${data.habitCompletion.completed}/${data.habitCompletion.total}`}
            showBorder={false}
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
    <div className="rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-white p-3 space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#93b0b4]">
        {label}
      </p>
      <div className="flex items-center justify-between text-[13px]">
        <span className="text-[#5a7d82]">{startValue}</span>
        <span className="text-[#93b0b4]">→</span>
        <span className="font-medium font-mono-display text-[#0c1a1e]">
          {endValue}
        </span>
      </div>
      {delta !== null && (
        <div className="flex items-center gap-1 text-[11px]">
          {delta < 0 ? (
            <TrendingDown className="h-3 w-3 text-[#0d9488]" />
          ) : delta > 0 ? (
            <TrendingUp className="h-3 w-3 text-[#c06060]" />
          ) : (
            <Minus className="h-3 w-3 text-[#93b0b4]" />
          )}
          <span
            className={`font-mono-display ${
              delta < 0
                ? "text-[#0d9488]"
                : delta > 0
                  ? "text-[#c06060]"
                  : "text-[#93b0b4]"
            }`}
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
  showBorder,
}: {
  label: string;
  value: string;
  detail: string;
  showBorder: boolean;
}) {
  return (
    <div
      className={`flex-1 px-3 py-3 text-center space-y-1 ${
        showBorder ? "border-r border-[rgba(13,148,136,0.08)]" : ""
      }`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#93b0b4]">
        {label}
      </p>
      <p className="text-[22px] font-semibold font-mono-display text-[#0c1a1e]">
        {value}
      </p>
      <p className="text-[12px] text-[#5a7d82]">{detail}</p>
    </div>
  );
}
