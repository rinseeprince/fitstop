"use client";

import { useEffect } from "react";
import type { DailyLog } from "@/types/daily-log";
import type { TrainingSession } from "@/types/training";
import type { UnplannedActivity } from "@/components/daily-pulse/daily-pulse-content";

interface UseTrainingRestorationProps {
  isLoading: boolean;
  isExpanded: boolean;
  todayLog: DailyLog | null;
  todaysTrainingSession: TrainingSession | null;
  allTrainingSessions: TrainingSession[];
  setSessionCompleted: (completed: boolean) => void;
  setCurrentTrainingSession: (session: TrainingSession | null) => void;
  setSelectedAlternativeSession: (sessionId: string | null) => void;
  setActivityStatuses: (statuses: Record<string, { completed: boolean; activityName: string; estimatedCalories: number }>) => void;
  setUnplannedActivities: (activities: UnplannedActivity[]) => void;
  setWasCompletedPreviously: (completed: boolean) => void;
  setIsSessionOrphaned: (orphaned: boolean) => void;
}

/**
 * Hook to handle restoring training data from a saved daily log.
 * Extracted from daily-pulse.tsx to reduce component size.
 */
export function useTrainingRestoration({
  isLoading,
  isExpanded,
  todayLog,
  todaysTrainingSession,
  allTrainingSessions,
  setSessionCompleted,
  setCurrentTrainingSession,
  setSelectedAlternativeSession,
  setActivityStatuses,
  setUnplannedActivities,
  setWasCompletedPreviously,
  setIsSessionOrphaned,
}: UseTrainingRestorationProps) {
  const scheduledSessionId = todaysTrainingSession?.id || null;
  const savedTrainingSessionId = todayLog?.trainingData?.trainingSessionId || null;
  
  useEffect(() => {
    if (isLoading || !todayLog?.trainingData) return;
    if (isExpanded) return; // Don't overwrite user edits
    
    const data = todayLog.trainingData;
    
    // Always restore these from training_data
    setSessionCompleted(data.sessionCompleted);
    setActivityStatuses(data.activityStatuses || {});
    setUnplannedActivities(data.unplannedActivities.map(activity => ({
      ...activity,
      intensityLevel: activity.intensityLevel as "low" | "moderate" | "vigorous"
    })));
    
    // Always restore the session from training_data if one was logged
    if (data.trainingSessionId) {
      const loggedSession = allTrainingSessions.find(s => s.id === data.trainingSessionId);
      if (loggedSession) {
        setCurrentTrainingSession(loggedSession);
        setIsSessionOrphaned(false);
        
        // Determine if this is an alternative session based on current schedule
        if (data.trainingSessionId !== scheduledSessionId) {
          setSelectedAlternativeSession(data.trainingSessionId);
        }
      } else if (data.trainingSessionName) {
        // Session ID is orphaned (plan was regenerated) - create display-only session
        const orphanedSession: TrainingSession = {
          id: data.trainingSessionId,
          planId: '', // No plan exists anymore
          name: data.trainingSessionName,
          orderIndex: 0,
          exercises: [],
          sessionType: 'training',
          estimatedCalories: 0, // We don't have this data anymore
          calorieSurplusPercentage: null,
          createdAt: '',
          updatedAt: '',
        };
        setCurrentTrainingSession(orphanedSession);
        setIsSessionOrphaned(true);
        // Mark as orphaned so UI can disable session picker
        setSelectedAlternativeSession('orphaned');
      }
    }
    
    if (data.sessionCompleted) {
      setWasCompletedPreviously(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, todayLog?.id, savedTrainingSessionId, scheduledSessionId, isExpanded]);
}