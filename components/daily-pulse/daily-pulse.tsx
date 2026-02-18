"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Smile, Frown, Meh, SmilePlus, Heart, Flame, ChevronDown, Edit } from "lucide-react";
import { useDailyPulse } from "@/hooks/use-daily-pulse";
import { TrainingSection } from "./training-section";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { DailyLog } from "@/types/daily-log";
type UnplannedActivity = {
  activityName: string;
  intensityLevel: "low" | "moderate" | "vigorous";
  durationMinutes: number;
};

const moodEmojis = [
  { value: 1, icon: Frown, label: "Poor", color: "text-destructive" },
  { value: 2, icon: Meh, label: "Below Average", color: "text-warning" },
  { value: 3, icon: Smile, label: "Good", color: "text-warning" },
  { value: 4, icon: SmilePlus, label: "Great", color: "text-success" },
  { value: 5, icon: Heart, label: "Excellent", color: "text-success" },
];

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
  const [customTrainingName, setCustomTrainingName] = useState("");
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

  const getMoodEmoji = (value: number | null | undefined) => {
    if (!value) return null;
    return moodEmojis.find(m => m.value === value);
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
            <div className="grid grid-cols-4 gap-3 text-center">
              {todayLog.mood && (() => {
                const moodData = getMoodEmoji(todayLog.mood);
                const MoodIcon = moodData?.icon;
                const moodColor = moodData?.color;
                return (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Mood</p>
                    {MoodIcon && <MoodIcon className={cn("h-5 w-5 mx-auto", moodColor)} />}
                  </div>
                );
              })()}
              {todayLog.energy && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Energy</p>
                  <p className="font-semibold">{todayLog.energy}/10</p>
                </div>
              )}
              {todayLog.sleep && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Sleep</p>
                  <p className="font-semibold">{todayLog.sleep}/10</p>
                </div>
              )}
              {todayLog.stress && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Stress</p>
                  <p className="font-semibold">{todayLog.stress}/10</p>
                </div>
              )}
            </div>

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
              customTrainingName={customTrainingName}
              allTrainingSessions={allTrainingSessions}
              plannedActivities={plannedActivities}
              onSessionCompletedChange={setSessionCompleted}
              onAlternativeSessionSelect={handleAlternativeSessionSelect}
              onActivityToggle={handleActivityToggle}
              onAddUnplannedActivity={handleAddUnplannedActivity}
              onRemoveUnplannedActivity={handleRemoveUnplannedActivity}
              onCustomTrainingNameChange={setCustomTrainingName}
            />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Wellness Section */}
            <div className="space-y-6">
              <div className="space-y-3">
                <Label>Overall Mood</Label>
                <div className="grid grid-cols-5 gap-2">
                  {moodEmojis.map(({ value, icon: Icon, label, color }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setFormData({ ...formData, mood: value })}
                      className={cn(
                        "flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all duration-200 hover:scale-105",
                        formData.mood === value
                          ? "border-primary bg-primary/5 shadow-lg"
                          : "border-border hover:border-primary/50"
                      )}
                    >
                      <Icon className={cn("w-5 h-5", formData.mood === value ? color : "text-muted-foreground")} />
                      <span className="text-xs font-medium">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Energy Level</Label>
                  <span className="text-sm font-semibold text-primary">{formData.energy || 5}/10</span>
                </div>
                <Slider
                  value={[formData.energy || 5]}
                  onValueChange={(value) => setFormData({ ...formData, energy: value[0] })}
                  min={1}
                  max={10}
                  step={1}
                  className="w-full"
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Sleep Quality</Label>
                  <span className="text-sm font-semibold text-primary">{formData.sleep || 5}/10</span>
                </div>
                <Slider
                  value={[formData.sleep || 5]}
                  onValueChange={(value) => setFormData({ ...formData, sleep: value[0] })}
                  min={1}
                  max={10}
                  step={1}
                  className="w-full"
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Stress Level</Label>
                  <span className="text-sm font-semibold text-primary">{formData.stress || 5}/10</span>
                </div>
                <Slider
                  value={[formData.stress || 5]}
                  onValueChange={(value) => setFormData({ ...formData, stress: value[0] })}
                  min={1}
                  max={10}
                  step={1}
                  className="w-full"
                />
              </div>

              <Collapsible open={showNotes} onOpenChange={setShowNotes}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between">
                    <span>Add notes (optional)</span>
                    <ChevronDown className={cn("h-4 w-4 transition-transform", showNotes && "rotate-180")} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <Textarea
                    placeholder="How are you feeling today?"
                    value={formData.notes || ""}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    rows={3}
                    className="resize-none"
                  />
                </CollapsibleContent>
              </Collapsible>
            </div>

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
              customTrainingName={customTrainingName}
              allTrainingSessions={allTrainingSessions}
              plannedActivities={plannedActivities}
              onSessionCompletedChange={setSessionCompleted}
              onAlternativeSessionSelect={handleAlternativeSessionSelect}
              onActivityToggle={handleActivityToggle}
              onAddUnplannedActivity={handleAddUnplannedActivity}
              onRemoveUnplannedActivity={handleRemoveUnplannedActivity}
              onCustomTrainingNameChange={setCustomTrainingName}
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