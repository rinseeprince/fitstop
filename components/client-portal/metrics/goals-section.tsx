"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Target } from "lucide-react";
import { useUnits } from "@/contexts/units-context";
import { formatWeight } from "@/utils/unit-conversions";
import { goalProgressChip, type GoalChipTone } from "@/lib/goals/goal-chip";
import type { ProgressData } from "@/services/client-portal-progress";

interface GoalsSectionProps {
  client: ProgressData["client"];
  latestWeight?: number;
  latestBodyFat?: number;
}

type Chip = { text: string; tone: GoalChipTone };

export function GoalsSection({ client, latestWeight, latestBodyFat }: GoalsSectionProps) {
  // The client's own unit. client.weightUnit was a mapper constant, so the
  // `|| "lbs"` never fired and everyone saw kilograms. Body weight, so
  // formatWeight — converts freely, never snaps.
  const { preference } = useUnits();
  const w = (kg: number) => Math.round(formatWeight(kg, preference).value * 10) / 10;
  const weightUnit = formatWeight(0, preference).unit;

  const currentWeight = client.currentWeight || latestWeight;
  const currentBodyFat = client.currentBodyFatPercentage || latestBodyFat;

  if (!client.goalWeight && !client.goalBodyFatPercentage) {
    return null;
  }

  // How far the client is from each target, in the words every goal card uses
  // (`goalProgressChip`): the goal's type and its start reading say which way
  // it points, so a client past the target never reads "to go". Between the
  // DISPLAYED values, so the amount reconciles with the two numbers beside it.
  const weightChip = client.goalWeight
    ? goalProgressChip({
        type: client.goalType,
        metric: "weight",
        start: client.goalStartWeight !== undefined ? w(client.goalStartWeight) : null,
        current: currentWeight !== undefined ? w(currentWeight) : null,
        target: w(client.goalWeight),
        unit: weightUnit,
      })
    : null;
  const bodyFatChip = client.goalBodyFatPercentage
    ? goalProgressChip({
        type: client.goalType,
        metric: "bodyFat",
        start: client.goalStartBodyFatPercentage,
        current: currentBodyFat,
        target: client.goalBodyFatPercentage,
        unit: "%",
      })
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Target className="h-5 w-5" />
          Goals & Progress
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Weight Goal */}
          {client.goalWeight && (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Current Weight</p>
                <p className="text-2xl font-bold">
                  {currentWeight !== undefined ? w(currentWeight).toFixed(1) : "--"}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    {weightUnit}
                  </span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Goal Weight</p>
                <p className="text-2xl font-bold">
                  {w(client.goalWeight).toFixed(1)}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    {weightUnit}
                  </span>
                </p>
              </div>
              {weightChip && <ProgressBadge chip={weightChip} />}
            </div>
          )}

          {/* Body Fat Goal */}
          {client.goalBodyFatPercentage && (
            <div className={`flex items-center justify-between ${client.goalWeight ? 'pt-4 border-t' : ''}`}>
              <div>
                <p className="text-sm text-muted-foreground">Current Body Fat</p>
                <p className="text-2xl font-bold">
                  {currentBodyFat?.toFixed(1) || "--"}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">%</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Goal Body Fat</p>
                <p className="text-2xl font-bold">
                  {client.goalBodyFatPercentage.toFixed(1)}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">%</span>
                </p>
              </div>
              {bodyFatChip && <ProgressBadge chip={bodyFatChip} />}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ProgressBadge({ chip }: { chip: Chip }) {
  return (
    <Badge variant={chip.tone === "positive" ? "default" : "secondary"}>
      {chip.text}
    </Badge>
  );
}
