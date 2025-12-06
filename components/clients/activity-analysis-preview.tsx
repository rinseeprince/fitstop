"use client";

import { Badge } from "@/components/ui/badge";
import { Loader2, Flame, Clock, AlertCircle } from "lucide-react";
import type { ActivityAnalysis } from "@/types/external-activity";

type ActivityAnalysisPreviewProps = {
  analysis: ActivityAnalysis | null;
  isLoading: boolean;
};

export function ActivityAnalysisPreview({
  analysis,
  isLoading,
}: ActivityAnalysisPreviewProps) {
  if (!analysis && !isLoading) {
    return null;
  }

  return (
    <div className="rounded-lg bg-muted p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Estimated Impact</span>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
      </div>
      {analysis && (
        <>
          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1">
              <Flame className="h-4 w-4 text-orange-500" />
              <strong>{analysis.estimatedCalories}</strong> calories
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4 text-blue-500" />
              <strong>{analysis.recoveryHours}h</strong> recovery
            </span>
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {analysis.muscleGroupsImpacted.map((muscle) => (
              <Badge key={muscle} variant="secondary" className="text-xs">
                {muscle}
              </Badge>
            ))}
          </div>
          {analysis.recoveryImpact && (
            <div className="flex items-start gap-2 mt-2 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{analysis.recoveryImpact}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
