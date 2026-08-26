"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { TrainingSessionChecklist } from "./training-session-checklist";
import { ExerciseHighlightsSection } from "./exercise-highlights-section";
import { DailyLogsTrainingSummary } from "./daily-logs-training-summary";
import type {
  EnhancedTrainingMetrics,
  CheckInTrainingContext,
  CheckInTrainingEventDetail,
  SessionCompletionQuality,
} from "@/types/check-in";
import type { DailyLog } from "@/types/daily-log";

type TrainingPeriodStats = {
  sessionsCompleted: number;
  sessionsPlanned: number;
};

type StepTrainingProps = {
  data: Partial<EnhancedTrainingMetrics>;
  onChange: (data: Partial<EnhancedTrainingMetrics>) => void;
  trainingContext?: CheckInTrainingContext;
  // Per-event training detail for the period — drives the editable/locked
  // training rows (Session 6.4). Source of truth: training_events + session_logs.
  trainingEventDetails?: CheckInTrainingEventDetail[];
  clientTimezone?: string;
  // Fill-gap log writer (registers an in-flight POST the page flushes pre-submit).
  onLogEvent: (
    eventId: string,
    payload: { completionQuality: SessionCompletionQuality; notes?: string }
  ) => Promise<void>;
  trainingPeriodStats?: TrainingPeriodStats;
  periodDays?: number;
  dailyLogs?: DailyLog[];
};

export const StepTraining = ({
  data,
  onChange,
  trainingContext,
  trainingEventDetails = [],
  clientTimezone = "UTC",
  onLogEvent,
  trainingPeriodStats,
  periodDays,
  dailyLogs = [],
}: StepTrainingProps) => {
  const hasActivePlan = trainingContext?.hasActivePlan ?? false;

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-semibold mb-1">Training & Nutrition</h3>
        <p className="text-sm text-muted-foreground">
          Your training is logged from your daily logs. Fill in any sessions you
          missed logging below.
        </p>
      </div>

      {/* Training Sessions — editable/locked viewer over the period's events.
          Daily logs are the source of truth (Session 6.4). */}
      <TrainingSessionChecklist
        events={trainingEventDetails}
        clientTimezone={clientTimezone}
        onLogEvent={onLogEvent}
      />

      <Separator />

      {/* Nutrition — read-only summary derived from daily logs. */}
      <DailyLogsTrainingSummary
        dailyLogs={dailyLogs}
        trainingPeriodStats={trainingPeriodStats}
        periodDays={periodDays}
      />

      <Separator />

      {/* Exercise Highlights (Collapsible) */}
      {hasActivePlan && trainingContext && (
        <>
          <ExerciseHighlightsSection
            exercises={trainingContext.sessions.map((s) => s.exercises)}
            highlights={data.exerciseHighlights || []}
            onChange={(exerciseHighlights) =>
              onChange({ ...data, exerciseHighlights })
            }
          />
          <Separator />
        </>
      )}

      {/* Other Wins */}
      <div className="space-y-3">
        <Label htmlFor="prs">Other Wins & Achievements (Optional)</Label>
        <Textarea
          id="prs"
          placeholder="Any non-training wins or achievements this week?
Examples:
• Stuck to meal prep all week
• Hit 10k steps every day
• Got better sleep by limiting screen time"
          value={data.prs || ""}
          onChange={(e) => onChange({ ...data, prs: e.target.value })}
          rows={4}
          className="resize-none"
        />
      </div>

      {/* Challenges */}
      <div className="space-y-3">
        <Label htmlFor="challenges">Challenges & Struggles (Optional)</Label>
        <Textarea
          id="challenges"
          placeholder="What was difficult this week?
Examples:
• Felt really tired, hard to complete workouts
• Travel made it tough to eat right
• Dealing with knee pain during squats"
          value={data.challenges || ""}
          onChange={(e) => onChange({ ...data, challenges: e.target.value })}
          rows={4}
          className="resize-none"
        />
        <p className="text-xs text-muted-foreground">
          Being honest about challenges helps your coach adjust your plan
        </p>
      </div>
    </div>
  );
};
