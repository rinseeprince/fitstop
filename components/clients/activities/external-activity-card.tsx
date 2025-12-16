"use client";

import { useState } from "react";
import type { TrainingSession } from "@/types/training";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Activity,
  Clock,
  Flame,
  Trash2,
  Loader2,
  AlertCircle,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type ExternalActivityCardProps = {
  activity: TrainingSession;
  clientId: string;
  planId: string;
  editMode: boolean;
  onUpdate: () => void;
};

export function ExternalActivityCard({
  activity,
  clientId,
  planId,
  editMode,
  onUpdate,
}: ExternalActivityCardProps) {
  const { toast } = useToast();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const metadata = activity.activityMetadata;

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/training/${planId}/activities/${activity.id}`,
        { method: "DELETE" }
      );

      if (!res.ok) throw new Error("Failed to delete activity");

      toast({ title: "Activity removed" });
      onUpdate();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete activity",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const getDayLabel = (day?: string) => {
    if (!day) return null;
    return day.charAt(0).toUpperCase() + day.slice(1);
  };

  const getIntensityColor = (intensity?: string) => {
    switch (intensity) {
      case "low":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "moderate":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
      case "vigorous":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
      default:
        return "";
    }
  };

  return (
    <>
      <Card className="p-4 bg-muted/30 border-dashed">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-primary/10">
              <Activity className="h-4 w-4 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{activity.name}</span>
                <Badge variant="outline" className="text-xs">
                  External Activity
                </Badge>
              </div>
              {metadata && (
                <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {metadata.durationMinutes}min
                  </span>
                  <span className="flex items-center gap-1">
                    <Flame className="h-3 w-3" />
                    {metadata.estimatedCalories} cal
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {activity.dayOfWeek && (
              <Badge variant="outline" className="text-xs">
                {getDayLabel(activity.dayOfWeek)}
              </Badge>
            )}
            {metadata?.intensityLevel && (
              <Badge className={`text-xs ${getIntensityColor(metadata.intensityLevel)}`}>
                {metadata.intensityLevel}
              </Badge>
            )}
            {metadata?.recoveryImpact && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                      <AlertCircle className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-xs">
                    <p className="font-medium mb-1">Recovery Impact</p>
                    <p className="text-sm">{metadata.recoveryImpact}</p>
                    {metadata.muscleGroupsImpacted?.length > 0 && (
                      <p className="text-xs mt-1 text-muted-foreground">
                        Affects: {metadata.muscleGroupsImpacted.join(", ")}
                      </p>
                    )}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {editMode && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Remove Activity"
        description={`Remove "${activity.name}" from the training plan? This will also remove its calorie contribution.`}
        confirmLabel="Remove"
        onConfirm={handleDelete}
        destructive
      />
    </>
  );
}
