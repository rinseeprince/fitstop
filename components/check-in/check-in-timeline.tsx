"use client";

import { CheckCircle2, Clock, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { CheckIn } from "@/types/check-in";
import { formatCheckInDate, formatRelativeTime, getStatusColor, getStatusLabel } from "@/lib/check-in-utils";

// Extended CheckIn type with daily log count fields
interface CheckInWithLogCounts extends CheckIn {
  dailyLogsCount?: number;
  expectedDays?: number;
}

type CheckInTimelineProps = {
  checkIns: CheckInWithLogCounts[];
  onSelectCheckIn?: (checkIn: CheckInWithLogCounts) => void;
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
                    ? "bg-success/15"
                    : checkIn.status === "ai_processed"
                    ? "bg-primary/15"
                    : "bg-warning/15"
                }`}>
                  <Icon className={`w-5 h-5 ${
                    checkIn.status === "reviewed"
                      ? "text-success"
                      : checkIn.status === "ai_processed"
                      ? "text-primary"
                      : "text-warning"
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
                    {checkIn.dailyLogsCount !== undefined && checkIn.expectedDays !== undefined && (
                      <Badge 
                        variant="outline"
                        className={`text-xs ${
                          checkIn.dailyLogsCount >= checkIn.expectedDays * 0.7 
                            ? 'bg-success/10 text-success border-success/30'
                            : checkIn.dailyLogsCount >= checkIn.expectedDays * 0.4
                            ? 'bg-warning/10 text-warning border-warning/30'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {checkIn.dailyLogsCount}/{checkIn.expectedDays} days logged
                      </Badge>
                    )}
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
