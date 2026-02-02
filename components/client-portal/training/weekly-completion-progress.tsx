"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2 } from "lucide-react";

interface WeeklyCompletionProgressProps {
  totalSessions: number;
  completedSessions: number;
}

export function WeeklyCompletionProgress({
  totalSessions,
  completedSessions,
}: WeeklyCompletionProgressProps) {
  const percentage = totalSessions > 0
    ? Math.round((completedSessions / totalSessions) * 100)
    : 0;

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            <span className="font-medium">This Week</span>
          </div>
          <span className="text-sm text-muted-foreground">
            {completedSessions} of {totalSessions} sessions
          </span>
        </div>
        <Progress value={percentage} className="mt-3 h-2" />
        <p className="mt-2 text-xs text-muted-foreground text-right">
          {percentage}% complete
        </p>
      </CardContent>
    </Card>
  );
}
