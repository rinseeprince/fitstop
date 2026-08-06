"use client";

import { useRouter } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { CheckIn } from "@/types/check-in";
import { useUnits } from "@/contexts/units-context";
import { formatLength, formatWeight } from "@/utils/unit-conversions";

export function CheckInCard({ checkIn }: { checkIn: CheckIn }) {
  const { preference } = useUnits();
  const router = useRouter();
  const date = new Date(checkIn.createdAt);
  const formattedDate = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  // Stored weights are kilograms and girths centimetres; checkIn.weightUnit and
  // measurementUnit are mapper constants, so the `|| "lbs"` / `|| "in"` never
  // fired and the labels described the storage, not the client's preference.
  const showWeight = (kg: number) => {
    const { value, unit } = formatWeight(kg, preference);
    return `${Math.round(value * 10) / 10} ${unit}`;
  };
  const showLength = (cm: number) => {
    const { value, unit } = formatLength(cm, preference);
    return `${Math.round(value * 10) / 10} ${unit}`;
  };

  const bodyMetrics = [];
  if (checkIn.weight) bodyMetrics.push(`Weight: ${showWeight(checkIn.weight)}`);
  if (checkIn.bodyFatPercentage) bodyMetrics.push(`Body Fat: ${checkIn.bodyFatPercentage}%`);
  if (checkIn.waist) bodyMetrics.push(`Waist: ${showLength(checkIn.waist)}`);
  if (checkIn.hips) bodyMetrics.push(`Hips: ${showLength(checkIn.hips)}`);
  if (checkIn.chest) bodyMetrics.push(`Chest: ${showLength(checkIn.chest)}`);
  if (checkIn.arms) bodyMetrics.push(`Arms: ${showLength(checkIn.arms)}`);
  if (checkIn.thighs) bodyMetrics.push(`Thighs: ${showLength(checkIn.thighs)}`);

  const wellnessMetrics = [];
  if (checkIn.mood) wellnessMetrics.push(`Mood: ${checkIn.mood}/5`);
  if (checkIn.energy) wellnessMetrics.push(`Energy: ${checkIn.energy}/10`);
  if (checkIn.sleep) wellnessMetrics.push(`Sleep: ${checkIn.sleep}/10`);
  if (checkIn.stress) wellnessMetrics.push(`Stress: ${checkIn.stress}/10`);
  if (checkIn.soreness) wellnessMetrics.push(`Soreness: ${checkIn.soreness}/10`);

  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-muted/50"
      onClick={() => router.push(`/client/check-in/${checkIn.id}`)}
    >
      <CardContent className="py-4">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <p className="font-medium">{formattedDate}</p>
            <Badge variant="outline" className="capitalize">
              {checkIn.status.replace(/_/g, " ")}
            </Badge>
          </div>

          {bodyMetrics.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Body Measurements</p>
              <div className="flex flex-wrap gap-2 text-sm">
                {bodyMetrics.map((metric, idx) => (
                  <span key={idx} className="bg-muted/50 px-2 py-1 rounded text-xs">
                    {metric}
                  </span>
                ))}
              </div>
            </div>
          )}

          {wellnessMetrics.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Wellness</p>
              <div className="flex flex-wrap gap-2 text-sm">
                {wellnessMetrics.map((metric, idx) => (
                  <span key={idx} className="bg-muted/50 px-2 py-1 rounded text-xs">
                    {metric}
                  </span>
                ))}
              </div>
            </div>
          )}

          {(checkIn.workoutsCompleted || checkIn.adherencePercentage || checkIn.nutritionDaysOnTarget) && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Training & Nutrition</p>
              <div className="flex flex-wrap gap-2 text-sm">
                {checkIn.workoutsCompleted && (
                  <span className="bg-muted/50 px-2 py-1 rounded text-xs">
                    Workouts: {checkIn.workoutsCompleted}
                  </span>
                )}
                {checkIn.adherencePercentage && (
                  <span className="bg-muted/50 px-2 py-1 rounded text-xs">
                    Adherence: {checkIn.adherencePercentage}%
                  </span>
                )}
                {checkIn.nutritionDaysOnTarget && (
                  <span className="bg-muted/50 px-2 py-1 rounded text-xs">
                    Nutrition: {checkIn.nutritionDaysOnTarget}/7 days
                  </span>
                )}
              </div>
            </div>
          )}

          {checkIn.coachResponse && (
            <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3">
              <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p className="text-sm">{checkIn.coachResponse}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
