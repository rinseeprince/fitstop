import type { TrainingSession } from "@/types/training";
import type { DailyLog } from "@/types/daily-log";

export function handleAlternativeSessionSelect(
  sessionId: string | null,
  allTrainingSessions: TrainingSession[],
  originalScheduledSessionId: string | null,
  setCurrentTrainingSession: (session: TrainingSession | null) => void,
  setSelectedAlternativeSession: (id: string | null) => void,
  setSessionCompleted: (completed: boolean) => void
) {
  setSelectedAlternativeSession(sessionId);
  if (sessionId) {
    const session = allTrainingSessions.find(s => s.id === sessionId);
    if (session) {
      setCurrentTrainingSession(session);
    }
  } else {
    setCurrentTrainingSession(originalScheduledSessionId 
      ? allTrainingSessions.find(s => s.id === originalScheduledSessionId) || null
      : null
    );
    // Only clear session completion when actually going back to a rest day (no scheduled session)
    if (originalScheduledSessionId === null) {
      setSessionCompleted(false);
    }
  }
}

export async function handleSessionCompletion(
  sessionCompleted: boolean,
  trainingSessionId: string | undefined,
  previousTrainingSessionId: string | undefined,
  wasCompletedPreviously: boolean,
  setWasCompletedPreviously: (value: boolean) => void
) {
  if (sessionCompleted && trainingSessionId) {
    // POST to session-completions for weekly tracking
    try {
      await fetch("/api/client/session-completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trainingSessionId: trainingSessionId,
        }),
      });
      setWasCompletedPreviously(true);
      
      // If switching to a different session, delete the old completion
      if (previousTrainingSessionId && previousTrainingSessionId !== trainingSessionId) {
        await fetch(`/api/client/session-completions?trainingSessionId=${previousTrainingSessionId}`, {
          method: "DELETE",
        });
      }
    } catch (error) {
      console.error("Error saving session completion:", error);
    }
  } else if (!sessionCompleted && wasCompletedPreviously && previousTrainingSessionId) {
    // DELETE from session-completions if unchecked
    try {
      await fetch(`/api/client/session-completions?trainingSessionId=${previousTrainingSessionId}`, {
        method: "DELETE",
      });
      setWasCompletedPreviously(false);
    } catch (error) {
      console.error("Error deleting session completion:", error);
    }
  }
}

export async function saveUnplannedActivities(
  unplannedActivities: Array<{
    activityName: string;
    intensityLevel: "low" | "moderate" | "vigorous";
    durationMinutes: number;
  }>
) {
  for (const activity of unplannedActivities) {
    try {
      await fetch("/api/client/daily-activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: new Date().toISOString().split('T')[0],
          activityName: activity.activityName,
          intensityLevel: activity.intensityLevel,
          durationMinutes: activity.durationMinutes,
        }),
      });
    } catch (error) {
      console.error("Error saving unplanned activity:", error);
    }
  }
}

// Form data extraction helpers (moved from form-data-helpers.ts)
export function extractWellnessData(log: DailyLog | null) {
  return {
    mood: log?.mood || undefined,
    energy: log?.energy || undefined,
    sleep: log?.sleep || undefined,
    stress: log?.stress || undefined,
    notes: log?.notes || undefined,
  };
}

export function extractNutritionData(log: DailyLog | null) {
  return {
    caloriesConsumed: log?.caloriesConsumed || null,
    proteinG: log?.proteinG || null,
    carbsG: log?.carbsG || null,
    fatG: log?.fatG || null,
  };
}