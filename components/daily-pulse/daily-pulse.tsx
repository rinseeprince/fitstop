"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Flame, Edit } from "lucide-react";
import { useDailyPulse } from "@/hooks/use-daily-pulse";
import { TrainingSection } from "./training-section";
import { WellnessSection } from "./wellness-section";
import { DailyPulseSummary } from "./daily-pulse-summary";
import { useToast } from "@/hooks/use-toast";
import type { DailyLog } from "@/types/daily-log";
type UnplannedActivity = {
  activityName: string;
  intensityLevel: "low" | "moderate" | "vigorous";
  durationMinutes: number;
};


export function DailyPulse() {
  const { todayLog, streak, nutritionTarget, todaysTrainingSession, plannedActivities, allTrainingSessions, isLoading, isSaving, saveLog } = useDailyPulse();
  const { toast } = useToast();
  const [isExpanded, setIsExpanded] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  
  // Wellness state
  const [formData, setFormData] = useState<Partial<DailyLog>>({
    mood: undefined,
    energy: undefined,
    sleep: undefined,
    stress: undefined,
    notes: undefined,
  });
  
  // Training state (lifted state pattern)
  const [sessionCompleted, setSessionCompleted] = useState(false);
  const [currentTrainingSession, setCurrentTrainingSession] = useState(todaysTrainingSession);
  const [originalScheduledSessionId, setOriginalScheduledSessionId] = useState<string | null>(null);
  const [selectedAlternativeSession, setSelectedAlternativeSession] = useState<string | null>(null);
  const [activityStatuses, setActivityStatuses] = useState<Record<string, boolean>>({});
  const [unplannedActivities, setUnplannedActivities] = useState<UnplannedActivity[]>([]);
  const [wasCompletedPreviously, setWasCompletedPreviously] = useState(false);

  // Update form data when todayLog loads or changes
  useEffect(() => {
    if (todayLog && !isLoading) {
      setFormData({
        mood: todayLog.mood || undefined,
        energy: todayLog.energy || undefined,
        sleep: todayLog.sleep || undefined,
        stress: todayLog.stress || undefined,
        notes: todayLog.notes || undefined,
      });
      setIsExpanded(false);
    } else if (!todayLog && !isLoading) {
      setIsExpanded(true);
    }
  }, [todayLog, isLoading]);
  
  // Initialize training data
  useEffect(() => {
    if (!isLoading && todaysTrainingSession) {
      setCurrentTrainingSession(todaysTrainingSession);
      setOriginalScheduledSessionId(todaysTrainingSession.id);
    } else if (!isLoading && !todaysTrainingSession) {
      setOriginalScheduledSessionId(null);
    }
  }, [todaysTrainingSession, isLoading]);

  // Single restoration effect - safe to run multiple times
  const scheduledSessionId = todaysTrainingSession?.id || null;
  
  useEffect(() => {
    if (isLoading || !todayLog?.trainingData) return;
    if (isExpanded) return; // Don't overwrite user edits
    
    const data = todayLog.trainingData;
    setSessionCompleted(data.sessionCompleted);
    setActivityStatuses(data.activityStatuses);
    setUnplannedActivities(data.unplannedActivities.map(activity => ({
      ...activity,
      intensityLevel: activity.intensityLevel as "low" | "moderate" | "vigorous"
    })));
    
    if (data.isAlternativeSession && data.trainingSessionId !== scheduledSessionId) {
      const altSession = allTrainingSessions.find(s => s.id === data.trainingSessionId);
      if (altSession) {
        setCurrentTrainingSession(altSession);
        setSelectedAlternativeSession(data.trainingSessionId);
      }
    }
    
    if (data.sessionCompleted) {
      setWasCompletedPreviously(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, todayLog?.id, scheduledSessionId, isExpanded]);

  const handleSave = async () => {
    // Determine training session ID
    const trainingSessionId = sessionCompleted && currentTrainingSession 
      ? currentTrainingSession.id 
      : undefined;

    // Build training data object
    const trainingData = {
      sessionCompleted,
      trainingSessionId: currentTrainingSession?.id || null,
      isAlternativeSession: selectedAlternativeSession !== null,
      activityStatuses,
      unplannedActivities
    };

    // Save to daily logs
    await saveLog({
      mood: formData.mood || undefined,
      energy: formData.energy || undefined,
      sleep: formData.sleep || undefined,
      stress: formData.stress || undefined,
      notes: formData.notes || undefined,
      trained: sessionCompleted,
      trainingSessionId: trainingSessionId,
      trainingData: trainingData,
    });
    
    // Handle session completion tracking
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
      } catch (error) {
        console.error("Error saving session completion:", error);
      }
    } else if (!sessionCompleted && wasCompletedPreviously && trainingSessionId) {
      // DELETE from session-completions if unchecked
      try {
        await fetch(`/api/client/session-completions?trainingSessionId=${trainingSessionId}`, {
          method: "DELETE",
        });
        setWasCompletedPreviously(false);
      } catch (error) {
        console.error("Error deleting session completion:", error);
      }
    }
    
    // Save unplanned activities
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
    
    setIsExpanded(false);
    setShowNotes(false);
  };

  const handleEdit = () => {
    setFormData({
      mood: todayLog?.mood || undefined,
      energy: todayLog?.energy || undefined,
      sleep: todayLog?.sleep || undefined,
      stress: todayLog?.stress || undefined,
      notes: todayLog?.notes || undefined,
    });
    setIsExpanded(true);
  };


  const handleAlternativeSessionSelect = (sessionId: string | null) => {
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
      setSessionCompleted(false); // Clear session completion when going back to rest day
    }
  };

  const handleAddUnplannedActivity = (activity: UnplannedActivity) => {
    setUnplannedActivities([...unplannedActivities, activity]);
  };

  const handleRemoveUnplannedActivity = (index: number) => {
    setUnplannedActivities(unplannedActivities.filter((_, i) => i !== index));
  };

  const handleActivityToggle = (activityId: string, completed: boolean) => {
    setActivityStatuses({ ...activityStatuses, [activityId]: completed });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading daily pulse...
        </CardContent>
      </Card>
    );
  }

  const hasLoggedToday = !!todayLog && (
    todayLog.mood !== null ||
    todayLog.energy !== null ||
    todayLog.sleep !== null ||
    todayLog.stress !== null ||
    todayLog.trained !== null
  );

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
        {hasLoggedToday && !isExpanded ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Today's log complete</span>
              <Button variant="ghost" size="sm" onClick={handleEdit}>
                <Edit className="h-4 w-4 mr-1" />
                Edit
              </Button>
            </div>
            
            {/* Wellness Summary */}
            <DailyPulseSummary todayLog={todayLog} />

            <Separator />
            
            {/* Training Summary */}
            <TrainingSection
              isExpanded={false}
              hasLoggedToday={hasLoggedToday}
              sessionCompleted={sessionCompleted}
              currentTrainingSession={currentTrainingSession}
              originalScheduledSessionId={originalScheduledSessionId}
              selectedAlternativeSession={selectedAlternativeSession}
              activityStatuses={activityStatuses}
              unplannedActivities={unplannedActivities}
              allTrainingSessions={allTrainingSessions}
              plannedActivities={plannedActivities}
              onSessionCompletedChange={setSessionCompleted}
              onAlternativeSessionSelect={handleAlternativeSessionSelect}
              onActivityToggle={handleActivityToggle}
              onAddUnplannedActivity={handleAddUnplannedActivity}
              onRemoveUnplannedActivity={handleRemoveUnplannedActivity}
            />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Wellness Section */}
            <WellnessSection
              formData={formData}
              setFormData={setFormData}
              showNotes={showNotes}
              setShowNotes={setShowNotes}
            />

            <Separator />
            
            {/* Training Section */}
            <TrainingSection
              isExpanded={true}
              hasLoggedToday={hasLoggedToday}
              sessionCompleted={sessionCompleted}
              currentTrainingSession={currentTrainingSession}
              originalScheduledSessionId={originalScheduledSessionId}
              selectedAlternativeSession={selectedAlternativeSession}
              activityStatuses={activityStatuses}
              unplannedActivities={unplannedActivities}
              allTrainingSessions={allTrainingSessions}
              plannedActivities={plannedActivities}
              onSessionCompletedChange={setSessionCompleted}
              onAlternativeSessionSelect={handleAlternativeSessionSelect}
              onActivityToggle={handleActivityToggle}
              onAddUnplannedActivity={handleAddUnplannedActivity}
              onRemoveUnplannedActivity={handleRemoveUnplannedActivity}
            />

            <Button onClick={handleSave} disabled={isSaving} className="w-full">
              {isSaving ? "Saving..." : todayLog ? "Update Log" : "Log Day"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}