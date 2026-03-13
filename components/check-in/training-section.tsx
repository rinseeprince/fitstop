"use client";

import { motion } from "framer-motion";
import { Dumbbell, Check, Trophy } from "lucide-react";
import type { DailyLog } from "@/types/daily-log";
import type { CheckIn } from "@/types/check-in";
import type { CheckInExerciseHighlightRow } from "@/lib/database-helpers";

type TrainingSectionProps = {
  dailyLogs: DailyLog[];
  checkIn: CheckIn;
  contextStartDate: Date;
  contextEndDate: Date;
};

type SessionRow = {
  dayAbbrev: string;
  sessionName: string;
  completed: boolean;
  hasPR: boolean;
  date: string;
};

function getDayAbbrev(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 3);
}

export const TrainingSection = ({
  dailyLogs,
  checkIn,
  contextStartDate,
  contextEndDate,
}: TrainingSectionProps) => {
  // Build session rows from daily logs
  const sessions: SessionRow[] = dailyLogs
    .filter((log) => log.trainingData?.trainingSessionId)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((log) => ({
      dayAbbrev: getDayAbbrev(log.date),
      sessionName: log.trainingData?.trainingSessionName || "Training Session",
      completed: log.trainingData?.sessionCompleted ?? false,
      hasPR: false,
      date: log.date,
    }));

  // Check for exercise highlights (PRs) from the check-in
  // API returns snake_case rows from the database directly
  const exerciseHighlights: CheckInExerciseHighlightRow[] =
    (checkIn as Record<string, unknown>).exerciseHighlights as CheckInExerciseHighlightRow[] ?? [];
  const prHighlights = exerciseHighlights.filter((h) => h.highlight_type === "pr");

  if (sessions.length === 0 && prHighlights.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: 0.1 }}
      className="bg-card border border-border rounded-lg p-5"
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-4 flex items-center gap-2">
        <Dumbbell className="w-4 h-4" />
        Training
      </div>

      {sessions.length > 0 && (
        <div className="flex flex-col gap-2">
          {sessions.map((session, i) => (
            <div
              key={`${session.date}-${i}`}
              className="flex items-center gap-3 px-3 py-2.5 bg-muted/50 rounded-md text-sm"
            >
              <span className="text-[11px] font-semibold text-muted-foreground uppercase w-8 shrink-0">
                {session.dayAbbrev}
              </span>
              <span className="flex-1 font-medium">{session.sessionName}</span>
              {session.completed && (
                <span className="text-success">
                  <Check className="w-4 h-4" />
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* PR Highlight Callout - only for structured exercise PRs */}
      {prHighlights.length > 0 && (
        <div className="mt-3 p-3 bg-warning/5 border-l-[3px] border-l-warning rounded-md flex items-center gap-2.5">
          <Trophy className="w-5 h-5 text-warning shrink-0" />
          <div className="text-sm font-medium">
            {prHighlights.map((pr, i) => (
              <span key={i}>
                {pr.exercise_name}
                {(pr.weight_value || pr.reps) && (
                  <span className="font-bold text-warning">
                    {" "}
                    {pr.weight_value && `${pr.weight_value}${pr.weight_unit || "kg"}`}
                    {pr.weight_value && pr.reps && " x "}
                    {pr.reps && `${pr.reps} reps`}
                  </span>
                )}
                {pr.details && ` - ${pr.details}`}
                {i < prHighlights.length - 1 && " | "}
              </span>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
};
