"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DailyLogsSummary } from "./daily-logs-summary";
import type { SubjectiveMetrics } from "@/types/check-in";
import type { DailyLog } from "@/types/daily-log";

type StepSubjectiveProps = {
  data: Partial<SubjectiveMetrics>;
  onChange: (data: Partial<SubjectiveMetrics>) => void;
  dailyLogs?: DailyLog[];
  periodStart?: string;
  periodEnd?: string;
};

/**
 * Wellness step (Session 6.4): daily logs are the source of truth, so this is a
 * READ-ONLY summary of the period's wellness metrics plus a single qualitative
 * reflection textarea (`data.notes`) — the only interactive wellness element. The
 * manual mood emoji picker and energy/sleep/stress sliders were removed; the
 * server derives those averages from wellness_logs at submit time.
 */
export const StepSubjective = ({ data, onChange, dailyLogs = [], periodStart, periodEnd }: StepSubjectiveProps) => {
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
    </div>
  );
};
