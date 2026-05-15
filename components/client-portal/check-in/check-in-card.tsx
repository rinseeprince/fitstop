"use client";

import { useRouter } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { CheckIn } from "@/types/check-in";

export function CheckInCard({ checkIn }: { checkIn: CheckIn }) {
  const router = useRouter();
  const date = new Date(checkIn.createdAt);
  const formattedDate = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const bodyMetrics = [];
  if (checkIn.weight) bodyMetrics.push(`Weight: ${checkIn.weight} ${checkIn.weightUnit || "lbs"}`);
  if (checkIn.bodyFatPercentage) bodyMetrics.push(`Body Fat: ${checkIn.bodyFatPercentage}%`);
  if (checkIn.waist) bodyMetrics.push(`Waist: ${checkIn.waist} ${checkIn.measurementUnit || "in"}`);
  if (checkIn.hips) bodyMetrics.push(`Hips: ${checkIn.hips} ${checkIn.measurementUnit || "in"}`);
  if (checkIn.chest) bodyMetrics.push(`Chest: ${checkIn.chest} ${checkIn.measurementUnit || "in"}`);
  if (checkIn.arms) bodyMetrics.push(`Arms: ${checkIn.arms} ${checkIn.measurementUnit || "in"}`);
  if (checkIn.thighs) bodyMetrics.push(`Thighs: ${checkIn.thighs} ${checkIn.measurementUnit || "in"}`);

  const wellnessMetrics = [];
  if (checkIn.mood) wellnessMetrics.push(`Mood: ${checkIn.mood}/5`);
  if (checkIn.energy) wellnessMetrics.push(`Energy: ${checkIn.energy}/10`);
  if (checkIn.sleep) wellnessMetrics.push(`Sleep: ${checkIn.sleep}/10`);
  if (checkIn.stress) wellnessMetrics.push(`Stress: ${checkIn.stress}/10`);

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
