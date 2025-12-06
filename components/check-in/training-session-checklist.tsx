"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dumbbell, Calendar } from "lucide-react";
import type {
  CheckInSessionCompletion,
  CheckInTrainingContext,
} from "@/types/check-in";

type TrainingSessionChecklistProps = {
  sessions: CheckInTrainingContext["sessions"];
  completions: CheckInSessionCompletion[];
  onChange: (completions: CheckInSessionCompletion[]) => void;
};

const DAY_LABELS: Record<string, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

export const TrainingSessionChecklist = ({
  sessions,
  completions,
  onChange,
}: TrainingSessionChecklistProps) => {
  const getCompletion = (sessionId: string) => {
    return completions.find((c) => c.trainingSessionId === sessionId);
  };

  const handleToggle = (session: CheckInTrainingContext["sessions"][0]) => {
    const existing = getCompletion(session.id);

    if (existing) {
      // Toggle off - remove from list
      if (existing.completed) {
        onChange(
          completions.map((c) =>
            c.trainingSessionId === session.id ? { ...c, completed: false } : c
          )
        );
      } else {
        // Toggle on
        onChange(
          completions.map((c) =>
            c.trainingSessionId === session.id
              ? { ...c, completed: true, completionQuality: "full" }
              : c
          )
        );
      }
    } else {
      // Add new completion
      onChange([
        ...completions,
        {
          trainingSessionId: session.id,
          sessionName: session.name,
          dayOfWeek: session.dayOfWeek,
          completed: true,
          completionQuality: "full",
        },
      ]);
    }
  };

  const handleQualityChange = (
    sessionId: string,
    quality: "full" | "partial" | "skipped"
  ) => {
    onChange(
      completions.map((c) =>
        c.trainingSessionId === sessionId
          ? { ...c, completionQuality: quality, completed: quality !== "skipped" }
          : c
      )
    );
  };

  const completedCount = completions.filter((c) => c.completed).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-base font-medium">Training Sessions</Label>
        <span className="text-sm text-muted-foreground">
          {completedCount}/{sessions.length} completed
        </span>
      </div>

      <div className="space-y-3">
        {sessions.map((session) => {
          const completion = getCompletion(session.id);
          const isCompleted = completion?.completed ?? false;
          const quality = completion?.completionQuality;

          return (
            <div
              key={session.id}
              className={`p-3 rounded-lg border transition-colors ${
                isCompleted
                  ? "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-900"
                  : "bg-muted/30 border-border"
              }`}
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  id={`session-${session.id}`}
                  checked={isCompleted}
                  onCheckedChange={() => handleToggle(session)}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Dumbbell className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <label
                      htmlFor={`session-${session.id}`}
                      className="text-sm font-medium cursor-pointer"
                    >
                      {session.name}
                    </label>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    {session.dayOfWeek && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {DAY_LABELS[session.dayOfWeek] || session.dayOfWeek}
                      </span>
                    )}
                    {session.focus && (
                      <span className="truncate">• {session.focus}</span>
                    )}
                  </div>
                </div>

                {completion && (
                  <Select
                    value={quality || "full"}
                    onValueChange={(v) =>
                      handleQualityChange(
                        session.id,
                        v as "full" | "partial" | "skipped"
                      )
                    }
                  >
                    <SelectTrigger className="w-24 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full">Full</SelectItem>
                      <SelectItem value="partial">Partial</SelectItem>
                      <SelectItem value="skipped">Skipped</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Check off sessions you completed and indicate if you did the full
        workout or only part of it.
      </p>
    </div>
  );
};
