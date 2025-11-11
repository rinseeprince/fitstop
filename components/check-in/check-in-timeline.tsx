"use client";

import { CheckCircle2, Clock, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { CheckIn } from "@/types/check-in";
import { formatCheckInDate, formatRelativeTime, getStatusColor, getStatusLabel } from "@/lib/check-in-utils";

type CheckInTimelineProps = {
  checkIns: CheckIn[];
  onSelectCheckIn?: (checkIn: CheckIn) => void;
  selectedCheckInId?: string;
};

export const CheckInTimeline = ({
  checkIns,
  onSelectCheckIn,
  selectedCheckInId,
}: CheckInTimelineProps) => {
  if (checkIns.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground">No check-ins yet</p>
        <p className="text-sm text-muted-foreground mt-1">
          Send a check-in request to get started
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {checkIns.map((checkIn) => {
        const isSelected = checkIn.id === selectedCheckInId;
        const statusIcon =
          checkIn.status === "reviewed"
            ? CheckCircle2
            : checkIn.status === "ai_processed"
            ? Sparkles
            : Clock;

        const Icon = statusIcon;

        return (
          <Card
            key={checkIn.id}
            className={`p-4 cursor-pointer transition-all hover:shadow-md ${
              isSelected ? "ring-2 ring-primary" : ""
            }`}
            onClick={() => onSelectCheckIn?.(checkIn)}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 flex-1">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  checkIn.status === "reviewed"
                    ? "bg-green-100 dark:bg-green-900/20"
                    : checkIn.status === "ai_processed"
                    ? "bg-blue-100 dark:bg-blue-900/20"
                    : "bg-yellow-100 dark:bg-yellow-900/20"
                }`}>
                  <Icon className={`w-5 h-5 ${
                    checkIn.status === "reviewed"
                      ? "text-green-600"
                      : checkIn.status === "ai_processed"
                      ? "text-blue-600"
                      : "text-yellow-600"
                  }`} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-medium">
                      {formatCheckInDate(checkIn.createdAt)}
                    </p>
                    <Badge variant="secondary" className={getStatusColor(checkIn.status)}>
                      {getStatusLabel(checkIn.status)}
                    </Badge>
                  </div>

                  <p className="text-sm text-muted-foreground">
                    {formatRelativeTime(checkIn.createdAt)}
                  </p>

                  {/* Quick Stats */}
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    {checkIn.weight && (
                      <span>{checkIn.weight} {checkIn.weightUnit || "lbs"}</span>
                    )}
                    {checkIn.adherencePercentage !== undefined && (
                      <span>{checkIn.adherencePercentage}% adherence</span>
                    )}
                    {checkIn.workoutsCompleted && (
                      <span>{checkIn.workoutsCompleted} workouts</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
};
