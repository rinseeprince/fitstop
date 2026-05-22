"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Target, TrendingUp, TrendingDown } from "lucide-react";

interface GoalsSectionProps {
  client: {
    goalWeight?: number;
    goalBodyFatPercentage?: number;
    startingWeight?: number;
    startingBodyFatPercentage?: number;
    currentWeight?: number;
    currentBodyFatPercentage?: number;
    weightUnit?: string;
  };
  latestWeight?: number;
  latestBodyFat?: number;
}

export function GoalsSection({ client, latestWeight, latestBodyFat }: GoalsSectionProps) {
  const currentWeight = client.currentWeight || latestWeight;
  const currentBodyFat = client.currentBodyFatPercentage || latestBodyFat;
  const weightUnit = client.weightUnit || "lbs";

  const weightProgress = client.goalWeight && currentWeight 
    ? currentWeight - client.goalWeight 
    : null;

  const bodyFatProgress = client.goalBodyFatPercentage && currentBodyFat 
    ? currentBodyFat - client.goalBodyFatPercentage 
    : null;

  if (!client.goalWeight && !client.goalBodyFatPercentage) {
    return null;
  }

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
                  {currentWeight?.toFixed(1) || "--"}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    {weightUnit}
                  </span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Goal Weight</p>
                <p className="text-2xl font-bold">
                  {client.goalWeight.toFixed(1)}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    {weightUnit}
                  </span>
                </p>
              </div>
              {weightProgress !== null && (
                <ProgressBadge 
                  progress={weightProgress} 
                  unit={weightUnit}
                  label="to go"
                />
              )}
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
              {bodyFatProgress !== null && (
                <ProgressBadge 
                  progress={bodyFatProgress} 
                  unit="%"
                  label="to go"
                />
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ProgressBadge({ progress, unit, label }: { progress: number; unit: string; label: string }) {
  const isOverGoal = progress > 0;
  const isAtGoal = Math.abs(progress) < 0.1;

  if (isAtGoal) {
    return (
      <Badge variant="default" className="flex items-center gap-1">
        <Target className="h-3 w-3" />
        Goal reached!
      </Badge>
    );
  }

  return (
    <Badge
      variant={isOverGoal ? "secondary" : "default"}
      className="flex items-center gap-1"
    >
      {isOverGoal ? (
        <TrendingUp className="h-3 w-3" />
      ) : (
        <TrendingDown className="h-3 w-3" />
      )}
      {Math.abs(progress).toFixed(1)} {unit} {label}
    </Badge>
  );
}