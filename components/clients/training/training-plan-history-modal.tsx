"use client";

import { useState, useEffect } from "react";
import type { TrainingPlanHistory } from "@/types/training";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";

type TrainingPlanHistoryModalProps = {
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function TrainingPlanHistoryModal({
  clientId,
  open,
  onOpenChange,
}: TrainingPlanHistoryModalProps) {
  const [history, setHistory] = useState<TrainingPlanHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (open) {
      fetchHistory();
    }
  }, [open, clientId]);

  const fetchHistory = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/training/history`);
      const data = await res.json();
      if (data.success) {
        setHistory(data.history || []);
      }
    } catch (error) {
      console.error("Failed to fetch history:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const getReasonLabel = (reason?: string) => {
    const labels: Record<string, string> = {
      initial: "Initial Plan",
      regenerated: "Regenerated",
      manual_update: "Manual Update",
    };
    return labels[reason || ""] || reason || "Created";
  };

  const getSplitLabel = (splitType: string) => {
    const labels: Record<string, string> = {
      push_pull_legs: "PPL",
      upper_lower: "U/L",
      full_body: "Full Body",
      bro_split: "Bro Split",
      push_pull: "Push/Pull",
      custom: "Custom",
    };
    return labels[splitType] || splitType;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Training Plan History</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : history.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No plan history yet</p>
        ) : (
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-4 pr-4">
              {history.map((entry, index) => (
                <div
                  key={entry.id}
                  className={`border rounded-lg p-4 ${index === 0 ? "border-primary/50 bg-primary/5" : ""}`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {entry.planSnapshot?.name || "Training Plan"}
                        </span>
                        {index === 0 && (
                          <Badge variant="default" className="text-xs">
                            Current
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-xs">
                          {getReasonLabel(entry.regenerationReason)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {format(new Date(entry.createdAt), "MMM d, yyyy 'at' h:mm a")}
                      </p>
                    </div>
                    {entry.planSnapshot && (
                      <div className="flex gap-1">
                        <Badge variant="secondary" className="text-xs">
                          {getSplitLabel(entry.planSnapshot.splitType)}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {entry.planSnapshot.frequencyPerWeek}x/week
                        </Badge>
                      </div>
                    )}
                  </div>

                  {/* Coach Prompt */}
                  <div className="mt-3 p-3 bg-muted/50 rounded text-sm">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Coach Prompt:</p>
                    <p className="text-sm">{entry.coachPrompt}</p>
                  </div>

                  {/* Metrics Snapshot */}
                  {entry.clientMetricsSnapshot && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {entry.clientMetricsSnapshot.weightKg && (
                        <span>
                          Weight: {entry.clientMetricsSnapshot.weightKg.toFixed(1)}kg
                        </span>
                      )}
                      {entry.clientMetricsSnapshot.bodyFatPercentage && (
                        <span>BF: {entry.clientMetricsSnapshot.bodyFatPercentage}%</span>
                      )}
                      {entry.clientMetricsSnapshot.goalWeightKg && (
                        <span>
                          Goal: {entry.clientMetricsSnapshot.goalWeightKg.toFixed(1)}kg
                        </span>
                      )}
                    </div>
                  )}

                  {/* Check-in Data Snapshot */}
                  {entry.checkInDataSnapshot && (
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {entry.checkInDataSnapshot.avgEnergy !== undefined && (
                        <span>Energy: {entry.checkInDataSnapshot.avgEnergy.toFixed(1)}/10</span>
                      )}
                      {entry.checkInDataSnapshot.avgSleep !== undefined && (
                        <span>Sleep: {entry.checkInDataSnapshot.avgSleep.toFixed(1)}/10</span>
                      )}
                      {entry.checkInDataSnapshot.avgStress !== undefined && (
                        <span>Stress: {entry.checkInDataSnapshot.avgStress.toFixed(1)}/10</span>
                      )}
                      {entry.checkInDataSnapshot.adherencePercentage !== undefined && (
                        <span>
                          Adherence: {entry.checkInDataSnapshot.adherencePercentage.toFixed(0)}%
                        </span>
                      )}
                    </div>
                  )}

                  {/* Sessions Summary */}
                  {entry.planSnapshot?.sessions && (
                    <div className="mt-3 text-xs">
                      <p className="font-medium text-muted-foreground mb-1">
                        Sessions ({entry.planSnapshot.sessions.length}):
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {entry.planSnapshot.sessions.map((session, i) => (
                          <Badge key={i} variant="outline" className="text-xs font-normal">
                            {session.name} ({session.exercises?.length || 0} exercises)
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
