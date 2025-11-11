"use client";

import { Heart, Zap, Moon, AlertTriangle, Scale, Activity, Target, Trophy } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { CheckIn } from "@/types/check-in";
import { formatCheckInDate } from "@/lib/check-in-utils";

type CheckInDataDisplayProps = {
  checkIn: CheckIn;
};

export const CheckInDataDisplay = ({ checkIn }: CheckInDataDisplayProps) => {
  return (
    <div className="space-y-6">
      {/* Date */}
      <div>
        <p className="text-sm text-muted-foreground">
          Submitted {formatCheckInDate(checkIn.createdAt)}
        </p>
      </div>

      {/* Subjective Metrics */}
      {(checkIn.mood || checkIn.energy || checkIn.sleep || checkIn.stress) && (
        <Card className="p-4 space-y-4">
          <h4 className="font-semibold text-sm">How They're Feeling</h4>
          <div className="grid grid-cols-2 gap-4">
            {checkIn.mood && (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Heart className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Mood</p>
                  <p className="font-semibold">{checkIn.mood}/5</p>
                </div>
              </div>
            )}

            {checkIn.energy && (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/20 flex items-center justify-center">
                  <Zap className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Energy</p>
                  <p className="font-semibold">{checkIn.energy}/10</p>
                </div>
              </div>
            )}

            {checkIn.sleep && (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center">
                  <Moon className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Sleep</p>
                  <p className="font-semibold">{checkIn.sleep}/10</p>
                </div>
              </div>
            )}

            {checkIn.stress && (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Stress</p>
                  <p className="font-semibold">{checkIn.stress}/10</p>
                </div>
              </div>
            )}
          </div>

          {checkIn.notes && (
            <div className="pt-3 border-t">
              <p className="text-xs text-muted-foreground mb-2">Notes</p>
              <p className="text-sm">{checkIn.notes}</p>
            </div>
          )}
        </Card>
      )}

      {/* Body Metrics */}
      {(checkIn.weight || checkIn.bodyFatPercentage) && (
        <Card className="p-4 space-y-4">
          <h4 className="font-semibold text-sm">Body Metrics</h4>
          <div className="grid grid-cols-2 gap-4">
            {checkIn.weight && (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/20 flex items-center justify-center">
                  <Scale className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Weight</p>
                  <p className="font-semibold">
                    {checkIn.weight} {checkIn.weightUnit || "lbs"}
                  </p>
                </div>
              </div>
            )}

            {checkIn.bodyFatPercentage && (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-teal-100 dark:bg-teal-900/20 flex items-center justify-center">
                  <Activity className="w-5 h-5 text-teal-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Body Fat</p>
                  <p className="font-semibold">{checkIn.bodyFatPercentage}%</p>
                </div>
              </div>
            )}
          </div>

          {/* Measurements */}
          {(checkIn.waist || checkIn.hips || checkIn.chest) && (
            <div className="pt-3 border-t space-y-2">
              <p className="text-xs text-muted-foreground font-medium">
                Measurements ({checkIn.measurementUnit || "in"})
              </p>
              <div className="grid grid-cols-3 gap-3 text-sm">
                {checkIn.waist && (
                  <div>
                    <p className="text-muted-foreground text-xs">Waist</p>
                    <p className="font-medium">{checkIn.waist}</p>
                  </div>
                )}
                {checkIn.hips && (
                  <div>
                    <p className="text-muted-foreground text-xs">Hips</p>
                    <p className="font-medium">{checkIn.hips}</p>
                  </div>
                )}
                {checkIn.chest && (
                  <div>
                    <p className="text-muted-foreground text-xs">Chest</p>
                    <p className="font-medium">{checkIn.chest}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Training & Nutrition */}
      {(checkIn.workoutsCompleted || checkIn.adherencePercentage) && (
        <Card className="p-4 space-y-4">
          <h4 className="font-semibold text-sm">Training & Nutrition</h4>
          <div className="grid grid-cols-2 gap-4">
            {checkIn.workoutsCompleted && (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center">
                  <Activity className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Workouts</p>
                  <p className="font-semibold">{checkIn.workoutsCompleted}</p>
                </div>
              </div>
            )}

            {checkIn.adherencePercentage !== undefined && (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center">
                  <Target className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Adherence</p>
                  <p className="font-semibold">{checkIn.adherencePercentage}%</p>
                </div>
              </div>
            )}
          </div>

          {checkIn.prs && (
            <div className="pt-3 border-t">
              <div className="flex items-center gap-2 mb-2">
                <Trophy className="w-4 h-4 text-amber-600" />
                <p className="text-xs font-medium">Personal Records & Wins</p>
              </div>
              <p className="text-sm whitespace-pre-wrap">{checkIn.prs}</p>
            </div>
          )}

          {checkIn.challenges && (
            <div className="pt-3 border-t">
              <p className="text-xs text-muted-foreground mb-2 font-medium">
                Challenges
              </p>
              <p className="text-sm whitespace-pre-wrap">{checkIn.challenges}</p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};
