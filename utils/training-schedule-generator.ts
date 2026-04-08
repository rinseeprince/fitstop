/**
 * Training Schedule Generator
 * Pure function that builds a day-by-day training schedule from pre-fetched data.
 * No DB calls — receives data from schedule-data-service.
 */

import type { ScheduleDay, TrainingDayStatus } from "@/types/schedule";
import type {
  TrainingPlanWithSessions,
  SessionLogRow,
  TrainingLogRow,
} from "@/services/schedule-data-service";

const DAY_NAMES: Record<number, string> = {
  0: "sunday", 1: "monday", 2: "tuesday", 3: "wednesday",
  4: "thursday", 5: "friday", 6: "saturday",
};

function getDayOfWeek(dateStr: string): string {
  return DAY_NAMES[new Date(dateStr + "T00:00:00").getDay()];
}

function findActivePlan(
  plans: TrainingPlanWithSessions[],
  date: string
): TrainingPlanWithSessions | null {
  return plans.find((p) =>
    p.effectiveFrom <= date &&
    (p.effectiveUntil === null || p.effectiveUntil >= date)
  ) ?? null;
}

export function buildTrainingSchedule(
  dates: string[],
  plans: TrainingPlanWithSessions[],
  sessionLogs: SessionLogRow[],
  trainingLogs: TrainingLogRow[]
): ScheduleDay[] {
  // Build lookup maps for O(1) access per date
  const sessionLogsByDate = new Map<string, SessionLogRow>();
  for (const log of sessionLogs) {
    // If multiple session logs on same date, keep the first (most relevant)
    if (!sessionLogsByDate.has(log.completedAt)) {
      sessionLogsByDate.set(log.completedAt, log);
    }
  }

  const trainingLogsByDate = new Map<string, TrainingLogRow>();
  for (const log of trainingLogs) {
    if (!trainingLogsByDate.has(log.date)) {
      trainingLogsByDate.set(log.date, log);
    }
  }

  return dates.map((date): ScheduleDay => {
    const dayOfWeek = getDayOfWeek(date);
    const plan = findActivePlan(plans, date);

    // Find prescribed session for this day
    const prescribedSession = plan?.sessions.find(
      (s) => s.dayOfWeek?.toLowerCase() === dayOfWeek && s.sessionType === "training"
    ) ?? null;

    // Find logs for this date
    const sessionLog = sessionLogsByDate.get(date) ?? null;
    const trainingLog = trainingLogsByDate.get(date) ?? null;
    const hasLog = sessionLog !== null || trainingLog !== null;

    // Determine if this was an alternative session
    const isAlternative = trainingLog?.trainingData?.isAlternativeSession ?? false;
    const loggedSessionName = trainingLog?.trainingData?.trainingSessionName ?? null;

    // Determine status
    const status = resolveStatus(prescribedSession, sessionLog, hasLog, isAlternative);

    return {
      date,
      dayOfWeek,
      status,
      plannedSessionId: prescribedSession?.id ?? null,
      plannedSessionName: prescribedSession?.name ?? null,
      loggedSessionName: loggedSessionName ?? sessionLog?.notes ?? null,
      completionQuality: sessionLog?.completionQuality ?? null,
      isAlternative,
      notes: sessionLog?.notes ?? null,
    };
  });
}

function resolveStatus(
  prescribed: { id: string } | null,
  sessionLog: SessionLogRow | null,
  hasLog: boolean,
  isAlternative: boolean
): TrainingDayStatus {
  if (prescribed && hasLog) {
    // Was the logged session a swap?
    if (isAlternative) return "completed_swap";
    // Check if session IDs match (when both are available)
    if (sessionLog?.trainingSessionId && sessionLog.trainingSessionId !== prescribed.id) {
      return "completed_swap";
    }
    // Check completion quality
    if (sessionLog?.completionQuality === "partial") return "partial";
    return "completed";
  }

  if (prescribed && !hasLog) return "missed";
  if (!prescribed && hasLog) return "rest_trained";
  return "rest";
}
