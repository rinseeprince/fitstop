"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DailyLogsSummary } from "./daily-logs-summary";
import { CustomQuestionsSection } from "@/components/client-portal/check-in/custom-questions-section";
import type {
  CheckInCustomAnswers,
  CheckInFormQuestion,
  SubjectiveMetrics,
} from "@/types/check-in";
import type { DailyLog } from "@/types/daily-log";

type StepSubjectiveData = Partial<SubjectiveMetrics & CheckInCustomAnswers>;

type StepSubjectiveProps = {
  data: StepSubjectiveData;
  onChange: (data: StepSubjectiveData) => void;
  dailyLogs?: DailyLog[];
  periodStart?: string;
  periodEnd?: string;
  /** The coach's enabled field keys for this client (C6b). */
  fields: readonly string[];
  /** The coach's own questions, enabled and in position order. */
  questions: CheckInFormQuestion[];
};

/**
 * Wellness step (Session 6.4): daily logs are the source of truth, so this is a
 * READ-ONLY summary of the period's wellness metrics plus a single qualitative
 * reflection textarea (`data.notes`) — the only interactive wellness element. The
 * manual mood emoji picker and energy/sleep/stress sliders were removed; the
 * server derives those averages from wellness_logs at submit time.
 *
 * The summary is UNCONDITIONAL and carries no field key: it is the client's own
 * week read back to them, not something they fill in. Only the reflection is a
 * field, and the coach can switch it off — leaving this step as the summary
 * plus whatever questions they wrote.
 */
export const StepSubjective = ({
  data,
  onChange,
  dailyLogs = [],
  periodStart,
  periodEnd,
  fields,
  questions,
}: StepSubjectiveProps) => {
  const asks = new Set(fields);

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-semibold mb-1">Your Week Summary</h3>
        <p className="text-sm text-muted-foreground">
          Based on your daily logs from this period
        </p>
      </div>

      {/* Read-only daily-logs summary (always-on path) */}
      <DailyLogsSummary dailyLogs={dailyLogs} periodStart={periodStart} periodEnd={periodEnd} />

      {/* Reflection — the only interactive wellness/nutrition element */}
      {asks.has("notes") && (
        <div className="space-y-3">
          <Label htmlFor="reflection" className="text-muted-foreground">Anything worth noting about how you felt this week?</Label>
          <Textarea
            id="reflection"
            placeholder="Any highlights, challenges, or patterns you noticed? How did you feel overall?"
            value={data.notes || ""}
            onChange={(e) => onChange({ ...data, notes: e.target.value })}
            rows={4}
            className="resize-none"
          />
        </div>
      )}

      <CustomQuestionsSection
        questions={questions}
        answers={data.customAnswers ?? []}
        onChange={(customAnswers) => onChange({ ...data, customAnswers })}
      />
    </div>
  );
};
