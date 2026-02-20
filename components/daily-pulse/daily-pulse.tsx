"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Flame } from "lucide-react";
import { useDailyPulse } from "@/hooks/use-daily-pulse";
import { DailyPulseContent } from "./daily-pulse-content";
import { 
  handleAlternativeSessionSelect as handleAltSession,
  handleSessionCompletion,
  saveUnplannedActivities,
  extractWellnessData,
  extractNutritionData
} from "./utils/daily-pulse-handlers";
import type { DailyLog } from "@/types/daily-log";
import type { TrainingSession } from "@/types/training";
import type { UnplannedActivity } from "./daily-pulse-content";

export function DailyPulse() {
  const { 
    todayLog, 
    streak, 
    nutritionTarget, 
    todaysTrainingSession, 
    plannedActivities, 
    allTrainingSessions, 
    isLoading, 
    isSaving, 
    saveLog 
  } = useDailyPulse();
  const [isExpanded, setIsExpanded] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  // Wellness state
  const [formData, setFormData] = useState<Partial<DailyLog>>({
    mood: undefined, energy: undefined, sleep: undefined, stress: undefined, notes: undefined,
  });
  // Nutrition state
  const [nutritionData, setNutritionData] = useState({
    caloriesConsumed: null as number | null, proteinG: null as number | null,
    carbsG: null as number | null, fatG: null as number | null,
  });
  // Training state
  const [sessionCompleted, setSessionCompleted] = useState(false);
  const [currentTrainingSession, setCurrentTrainingSession] = useState(todaysTrainingSession);
  const [originalScheduledSessionId, setOriginalScheduledSessionId] = useState<string | null>(null);
  const [selectedAlternativeSession, setSelectedAlternativeSession] = useState<string | null>(null);
  const [activityStatuses, setActivityStatuses] = useState<Record<string, { completed: boolean; activityName: string; estimatedCalories: number }>>({});
  const [unplannedActivities, setUnplannedActivities] = useState<UnplannedActivity[]>([]);
  const [wasCompletedPreviously, setWasCompletedPreviously] = useState(false);
  const [isSessionOrphaned, setIsSessionOrphaned] = useState(false);

  // Update form data when todayLog loads or changes
  useEffect(() => {
    if (isLoading) return;
    if (todayLog) {
      setFormData(extractWellnessData(todayLog));
      setNutritionData(extractNutritionData(todayLog));
      setIsExpanded(false);
    } else {
      setIsExpanded(true);
    }
  }, [todayLog, isLoading]);
  // Initialize training data
  useEffect(() => {
    if (!isLoading) {
      setCurrentTrainingSession(todaysTrainingSession);
      setOriginalScheduledSessionId(todaysTrainingSession?.id || null);
      setIsSessionOrphaned(false); // Reset when fresh day loads
    }
  }, [todaysTrainingSession, isLoading]);

  // Restore training data from saved log
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

  const handleSave = async () => {
    const trainingSessionId = sessionCompleted && currentTrainingSession ? currentTrainingSession.id : undefined;
    const trainingData = {
      sessionCompleted,
      trainingSessionId: currentTrainingSession?.id || null,
      trainingSessionName: currentTrainingSession?.name || null,
      isAlternativeSession: selectedAlternativeSession !== null,
      activityStatuses,
      unplannedActivities
    };

    await saveLog({
      ...formData,
      trained: sessionCompleted,
      trainingSessionId,
      trainingData,
      caloriesConsumed: nutritionData.caloriesConsumed || undefined,
      proteinG: nutritionData.proteinG || undefined,
      carbsG: nutritionData.carbsG || undefined,
      fatG: nutritionData.fatG || undefined,
    });
    await handleSessionCompletion(sessionCompleted, trainingSessionId, todayLog?.trainingSessionId, wasCompletedPreviously, setWasCompletedPreviously);
    await saveUnplannedActivities(unplannedActivities);
    setIsExpanded(false);
    setShowNotes(false);
  };

  const handleEdit = () => {
    setFormData(extractWellnessData(todayLog));
    setNutritionData(extractNutritionData(todayLog));
    setIsExpanded(true);
  };

  const handleAlternativeSessionSelect = (sessionId: string | null) => {
    handleAltSession(
      sessionId,
      allTrainingSessions,
      originalScheduledSessionId,
      setCurrentTrainingSession,
      setSelectedAlternativeSession,
      setSessionCompleted
    );
  };

  const handleAddUnplannedActivity = (activity: UnplannedActivity) => 
    setUnplannedActivities([...unplannedActivities, activity]);

  const handleRemoveUnplannedActivity = (index: number) => 
    setUnplannedActivities(unplannedActivities.filter((_, i) => i !== index));

  const handleActivityToggle = (activityId: string, completed: boolean) => {
    const activity = plannedActivities.find(a => a.sessionId === activityId);
    if (activity) {
      setActivityStatuses({
        ...activityStatuses,
        [activityId]: {
          completed,
          activityName: activity.activityName,
          estimatedCalories: activity.estimatedCalories
        }
      });
    }
  };

  const hasLoggedToday = !!todayLog && (todayLog.mood !== null || todayLog.energy !== null || 
    todayLog.sleep !== null || todayLog.stress !== null || todayLog.trained !== null);

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Daily Pulse</CardTitle>
          {streak > 0 && (
            <Badge variant="secondary" className="flex items-center gap-1">
              <Flame className="h-3 w-3" />
              {streak} day streak
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent>
        <DailyPulseContent
          isLoading={isLoading}
          isSaving={isSaving}
          isExpanded={isExpanded}
          hasLoggedToday={hasLoggedToday}
          showNotes={showNotes}
          todayLog={todayLog}
          nutritionTarget={nutritionTarget}
          sessionCompleted={sessionCompleted}
          currentTrainingSession={currentTrainingSession}
          originalScheduledSessionId={originalScheduledSessionId}
          selectedAlternativeSession={selectedAlternativeSession}
          activityStatuses={activityStatuses}
          unplannedActivities={unplannedActivities}
          allTrainingSessions={allTrainingSessions}
          plannedActivities={plannedActivities}
          formData={formData}
          nutritionData={nutritionData}
          handleEdit={handleEdit}
          handleSave={handleSave}
          setShowNotes={setShowNotes}
          setFormData={setFormData}
          setSessionCompleted={setSessionCompleted}
          handleAlternativeSessionSelect={handleAlternativeSessionSelect}
          handleActivityToggle={handleActivityToggle}
          handleAddUnplannedActivity={handleAddUnplannedActivity}
          handleRemoveUnplannedActivity={handleRemoveUnplannedActivity}
          setNutritionData={setNutritionData}
          isSessionOrphaned={isSessionOrphaned}
        />
      </CardContent>
    </Card>
  );
}