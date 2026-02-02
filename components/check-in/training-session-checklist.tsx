"use client";

import { useMemo } from "react";
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

type ExpandedSession = CheckInTrainingContext["sessions"][0] & {
  weekNumber?: number;
  displayName: string;
};

type TrainingSessionChecklistProps = {
  sessions: CheckInTrainingContext["sessions"];
  completions: CheckInSessionCompletion[];
  onChange: (completions: CheckInSessionCompletion[]) => void;
  frequencyDays?: number;
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
  frequencyDays = 7,
}: TrainingSessionChecklistProps) => {
  // Expand sessions for multi-week frequencies (round to nearest week)
  const expandedSessions = useMemo((): ExpandedSession[] => {
    const weeks = Math.round(frequencyDays / 7);
    if (weeks <= 1) {
      return sessions.map((s) => ({ ...s, displayName: s.name }));
    }

    const expanded: ExpandedSession[] = [];
    for (let week = 1; week <= weeks; week++) {
      for (const session of sessions) {
        expanded.push({
          ...session,
          id: `${session.id}_week${week}`,
          weekNumber: week,
          displayName: `Week ${week}: ${session.name}`,
        });
      }
    }
    return expanded;
  }, [sessions, frequencyDays]);

  const getCompletion = (sessionId: string) => {
    return completions.find((c) => c.trainingSessionId === sessionId);
  };

  const handleToggle = (session: ExpandedSession) => {
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
          sessionName: session.displayName,
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
          {completedCount}/{expandedSessions.length} completed
        </span>
      </div>

      <div className="space-y-3">
        {expandedSessions.map((session) => {
          const completion = getCompletion(session.id);
          const isCompleted = completion?.completed ?? false;
          const quality = completion?.completionQuality;

          return (
            <div
              key={session.id}
              className={`p-3 rounded-lg border transition-colors ${
                isCompleted
                  ? "bg-success/10 border-success/30"
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
                      {session.displayName}
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
