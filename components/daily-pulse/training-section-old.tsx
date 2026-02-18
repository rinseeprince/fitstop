"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dumbbell, Activity, Plus, X, Flame } from "lucide-react";
import type { TrainingSession } from "@/types/training";
import type { Database } from "@/types/database";

type SessionCompletion = Database["public"]["Tables"]["client_session_completions"]["Row"];

interface UnplannedActivity {
  id: string;
  activityName: string;
  intensityLevel: "low" | "moderate" | "vigorous";
  durationMinutes: number;
}

interface TrainingSectionProps {
  onDataChange?: (data: {
    sessionCompleted?: boolean;
    customTrainingName?: string;
    plannedActivityStatuses?: Record<string, boolean>;
    unplannedActivities?: Array<{
      activityName: string;
      intensityLevel: "low" | "moderate" | "vigorous";
      durationMinutes: number;
    }>;
    alternativeSessionId?: string;
    trainingSession?: {
      sessionId: string;
      sessionName: string;
      estimatedCalories: number;
    } | null;
  }) => void;
  saveData?: () => Promise<void>;
  isExpanded?: boolean;
  hasLoggedToday?: boolean;
  isLoading?: boolean;
  trainingData: {
    trainingSession: {
      sessionId: string;
      sessionName: string;
      estimatedCalories: number;
    } | null;
    plannedActivities: Array<{
      sessionId: string;
      activityName: string;
      estimatedCalories: number;
    }>;
    allTrainingSessions: TrainingSession[];
  };
  trainingFormData?: any;
  savedTrainingSessionId?: string | null;
  savedTrained?: boolean | null;
  savedCompletions?: SessionCompletion[];
  savedCompletedActivityIds?: string[];
}

const COMMON_ACTIVITIES = [
  "Running", "Cycling", "Swimming", "Walking", "Hiking",
  "Basketball", "Yoga", "Boxing", "Martial Arts"
];

export function TrainingSection({ 
  onDataChange, 
  isExpanded = true, 
  hasLoggedToday = false,
  isLoading = false,
  trainingData,
  trainingFormData,
  savedTrainingSessionId,
  savedTrained,
  savedCompletions = [],
  savedCompletedActivityIds = []
}: TrainingSectionProps) {
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [selectedAlternativeSession, setSelectedAlternativeSession] = useState<string | null>(null);
  const [currentTrainingSession, setCurrentTrainingSession] = useState(trainingData.trainingSession);
  const originalScheduledSessionId = trainingData.trainingSession?.sessionId || null;
  
  const [sessionCompleted, setSessionCompleted] = useState(false);
  const [customTrainingName, setCustomTrainingName] = useState("");
  const [activityStatuses, setActivityStatuses] = useState<Record<string, boolean>>({});
  const [unplannedActivities, setUnplannedActivities] = useState<UnplannedActivity[]>([]);
  const [showAddActivity, setShowAddActivity] = useState(false);
  const [showRestDaySessionPicker, setShowRestDaySessionPicker] = useState(false);
  const [newActivity, setNewActivity] = useState({
    activityName: "",
    intensityLevel: "moderate" as "low" | "moderate" | "vigorous",
    durationMinutes: "",
  });

  // Restore saved training state on mount
  useEffect(() => {
    // Wait for all data to be loaded before attempting restoration
    if (isLoading) {
      // Still loading data from the API
      return;
    }
    
    // Check if savedCompletions is still loading (undefined means not loaded yet)
    if (savedCompletions === undefined) {
      // Completions data hasn't been fetched yet
      return;
    }
    
    // Ensure training sessions are loaded
    if (!trainingData.allTrainingSessions || trainingData.allTrainingSessions.length === 0) {
      // Training plan not loaded yet or no sessions available
      // Don't return here if there are truly no sessions (empty plan)
      // Only return if we're expecting sessions but they haven't loaded
      if (savedTrained === true || savedTrainingSessionId) {
        // We expect sessions but they're not loaded yet
        return;
      }
    }
    
    // IMPORTANT: Check savedTrained FIRST to ensure consistency
    // If trained is explicitly false, don't restore any completions
    if (savedTrained === false) {
      // User explicitly marked as not trained, ignore any completion records
      setSessionCompleted(false);
      return;
    }
    
    // Only restore from completions if savedTrained is true
    if (savedTrained === true) {
      // First try to restore from savedTrainingSessionId for backward compatibility
      if (savedTrainingSessionId && trainingData.allTrainingSessions.length > 0) {
        // Check if the saved session is different from today's scheduled session
        if (!trainingData.trainingSession || savedTrainingSessionId !== trainingData.trainingSession.sessionId) {
          // This was an alternative or rest day session
          const savedSession = trainingData.allTrainingSessions.find((s: TrainingSession) => s.id === savedTrainingSessionId);
          if (savedSession) {
            setSelectedAlternativeSession(savedTrainingSessionId);
            setCurrentTrainingSession({
              sessionId: savedSession.id,
              sessionName: savedSession.name,
              estimatedCalories: savedSession.estimatedCalories || 0
            });
          }
        }
        setSessionCompleted(true);
      }
      
      // Also check completion records for more detailed restoration
      if (savedCompletions && savedCompletions.length > 0) {
        // Check for training session completion
        const trainingCompletion = savedCompletions.find(c => 
          trainingData.allTrainingSessions.some(s => s.id === c.training_session_id)
        );
        
        if (trainingCompletion) {
          const completedSessionId = trainingCompletion.training_session_id;
          
          // Check if this is different from today's scheduled session (alternative or rest day session)
          if (!trainingData.trainingSession || completedSessionId !== trainingData.trainingSession.sessionId) {
            const completedSession = trainingData.allTrainingSessions.find((s: TrainingSession) => s.id === completedSessionId);
            if (completedSession) {
              setSelectedAlternativeSession(completedSessionId);
              setCurrentTrainingSession({
                sessionId: completedSession.id,
                sessionName: completedSession.name,
                estimatedCalories: completedSession.estimatedCalories || 0
              });
            }
          }
          setSessionCompleted(true);
        }
        
        // Activity completions are now restored from savedCompletedActivityIds
      }
    }
    
    // Restore activity completions from savedCompletedActivityIds
    if (savedCompletedActivityIds && savedCompletedActivityIds.length > 0) {
      const activityStatuses: Record<string, boolean> = {};
      savedCompletedActivityIds.forEach(activityId => {
        // Only restore if this is a planned activity for today
        if (trainingData.plannedActivities.some(a => a.sessionId === activityId)) {
          activityStatuses[activityId] = true;
        }
      });
      
      if (Object.keys(activityStatuses).length > 0) {
        setActivityStatuses(activityStatuses);
      }
    }
  }, [isLoading, savedTrained, savedTrainingSessionId, savedCompletions, savedCompletedActivityIds, trainingData.allTrainingSessions, trainingData.trainingSession, trainingData.plannedActivities]);

  useEffect(() => {
    if (onDataChange) {
      const dataToSend = {
        sessionCompleted,
        customTrainingName,
        plannedActivityStatuses: activityStatuses,
        unplannedActivities: unplannedActivities.map(a => ({
          activityName: a.activityName,
          intensityLevel: a.intensityLevel,
          durationMinutes: a.durationMinutes
        })),
        alternativeSessionId: selectedAlternativeSession || undefined,
        trainingSession: currentTrainingSession
      };
      onDataChange(dataToSend);
    }
  }, [sessionCompleted, customTrainingName, activityStatuses, unplannedActivities, selectedAlternativeSession, onDataChange, currentTrainingSession]);

  const handleSessionToggle = (checked: boolean) => {
    setSessionCompleted(checked);
    if (!currentTrainingSession && checked) {
      setCustomTrainingName("");
    }
  };

  const handleActivityToggle = (sessionId: string, completed: boolean) => {
    setActivityStatuses(prev => ({ ...prev, [sessionId]: completed }));
  };

  const handleAddActivity = () => {
    if (!newActivity.activityName || !newActivity.durationMinutes) return;

    const durationMinutes = parseInt(newActivity.durationMinutes);

    const activity: UnplannedActivity = {
      id: `temp-${Date.now()}`,
      activityName: newActivity.activityName,
      intensityLevel: newActivity.intensityLevel,
      durationMinutes: durationMinutes
    };

    setUnplannedActivities(prev => [...prev, activity]);
    setNewActivity({ activityName: "", intensityLevel: "moderate", durationMinutes: "" });
    setShowAddActivity(false);
  };

  const handleRemoveActivity = (id: string) => {
    setUnplannedActivities(prev => prev.filter(a => a.id !== id));
  };
  
  const handleSelectAlternativeSession = (sessionId: string) => {
    const session = trainingData.allTrainingSessions.find(s => s.id === sessionId);
    if (session) {
      setSelectedAlternativeSession(sessionId);
      setCurrentTrainingSession({
        sessionId: session.id,
        sessionName: session.name,
        estimatedCalories: session.estimatedCalories || 0
      });
      setShowSessionPicker(false);
    }
  };

  // No need for loading state since data comes from parent

  const totalCalories = (sessionCompleted && currentTrainingSession ? currentTrainingSession.estimatedCalories : 0) +
    trainingData.plannedActivities.filter(a => activityStatuses[a.sessionId]).reduce((sum, a) => sum + a.estimatedCalories, 0);

  // Show compact summary if already logged and not expanded
  if (hasLoggedToday && !isExpanded) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-base">Training & Activity</Label>
          {totalCalories > 0 && (
            <Badge variant="secondary" className="flex items-center gap-1 text-xs">
              <Flame className="h-3 w-3" />
              {totalCalories} cal
            </Badge>
          )}
        </div>
        {(sessionCompleted || Object.values(activityStatuses).some(v => v) || unplannedActivities.length > 0) && (
          <div className="text-sm text-muted-foreground space-y-1">
            {sessionCompleted && currentTrainingSession && (
              <div>✓ {currentTrainingSession.sessionName}</div>
            )}
            {Object.entries(activityStatuses).filter(([_, v]) => v).map(([id]) => {
              const activity = trainingData.plannedActivities.find(a => a.sessionId === id);
              return activity ? <div key={id}>✓ {activity.activityName}</div> : null;
            })}
            {unplannedActivities.map(a => (
              <div key={a.id}>✓ {a.activityName} ({a.durationMinutes} min)</div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Label className="text-base">Training & Activity</Label>
        {totalCalories > 0 && (
          <Badge variant="secondary" className="flex items-center gap-1 text-xs">
            <Flame className="h-3 w-3" />
            {totalCalories} cal burned
          </Badge>
        )}
      </div>
        {currentTrainingSession ? (
          <div className="space-y-2">
            <Label>Today's Training</Label>
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div className="flex items-center gap-2">
                <Dumbbell className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{currentTrainingSession.sessionName}</span>
                <span className="text-sm text-muted-foreground">~{currentTrainingSession.estimatedCalories} cal</span>
              </div>
              <Switch checked={sessionCompleted} onCheckedChange={handleSessionToggle} />
            </div>
            <Button
              variant="link"
              size="sm"
              onClick={() => setShowSessionPicker(!showSessionPicker)}
              className="text-xs p-0 h-auto"
            >
              {selectedAlternativeSession ? "Change session" : "Do a different session"}
            </Button>
            {originalScheduledSessionId === null && selectedAlternativeSession !== null && (
              <div className="mt-1">
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => {
                    setSelectedAlternativeSession(null);
                    setCurrentTrainingSession(null);
                    setSessionCompleted(false);
                    setShowSessionPicker(false);
                  }}
                  className="text-xs p-0 h-auto"
                >
                  Back to rest day
                </Button>
              </div>
            )}
            {showSessionPicker && (
              <Select onValueChange={handleSelectAlternativeSession}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a different session" />
                </SelectTrigger>
                <SelectContent>
                  {trainingData.allTrainingSessions
                    .map(session => (
                      <SelectItem key={session.id} value={session.id}>
                        {session.name}
                        {session.id === originalScheduledSessionId && " (scheduled)"}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <Label>Rest Day</Label>
            {!selectedAlternativeSession ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowRestDaySessionPicker(true)}
                  className="w-full justify-start"
                >
                  <Dumbbell className="h-4 w-4 mr-2" />
                  Want to train today?
                </Button>
                {showRestDaySessionPicker && (
                  <Select
                    onValueChange={(sessionId) => {
                      handleSelectAlternativeSession(sessionId);
                      setShowRestDaySessionPicker(false);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a training session" />
                    </SelectTrigger>
                    <SelectContent>
                      {trainingData.allTrainingSessions.map(session => (
                        <SelectItem key={session.id} value={session.id}>
                          {session.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </>
            ) : (
              <>
                {(() => {
                  const selectedSession = trainingData.allTrainingSessions.find(s => s.id === selectedAlternativeSession);
                  if (!selectedSession) {
                    // Session not found, but still show back button
                    return (
                      <div className="space-y-2">
                        <div className="text-sm text-muted-foreground">Session not found</div>
                        <Button
                          variant="link"
                          size="sm"
                          onClick={() => {
                            setSelectedAlternativeSession(null);
                            setCurrentTrainingSession(trainingData.trainingSession); // Reset to original
                            setSessionCompleted(false);
                            setShowRestDaySessionPicker(false);
                          }}
                          className="text-xs p-0 h-auto text-primary hover:underline"
                        >
                          Back to rest day
                        </Button>
                      </div>
                    );
                  }
                  return (
                    <>
                      <div className="flex items-center justify-between p-3 rounded-lg border">
                        <div className="flex items-center gap-2">
                          <Dumbbell className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{selectedSession.name}</span>
                          <span className="text-sm text-muted-foreground">~{selectedSession.estimatedCalories || 0} cal</span>
                        </div>
                        <Switch checked={sessionCompleted} onCheckedChange={handleSessionToggle} />
                      </div>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => {
                          setSelectedAlternativeSession(null);
                          setCurrentTrainingSession(trainingData.trainingSession); // Reset to original
                          setSessionCompleted(false);
                          setShowRestDaySessionPicker(false);
                        }}
                        className="text-xs p-0 h-auto text-primary hover:underline"
                      >
                        Back to rest day
                      </Button>
                    </>
                  );
                })()}
              </>
            )}
          </div>
        )}

        {trainingData.plannedActivities.length > 0 && (
          <div className="space-y-2">
            <Label>Planned Activities</Label>
            {trainingData.plannedActivities.map(activity => (
              <div key={activity.sessionId} className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{activity.activityName}</span>
                  <span className="text-sm text-muted-foreground">~{activity.estimatedCalories} cal</span>
                </div>
                <Switch
                  checked={activityStatuses[activity.sessionId] || false}
                  onCheckedChange={(checked) => handleActivityToggle(activity.sessionId, checked)}
                />
              </div>
            ))}
          </div>
        )}

        {unplannedActivities.length > 0 && (
          <div className="space-y-2">
            {unplannedActivities.map(activity => (
              <div key={activity.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{activity.activityName}</span>
                  <Badge variant="outline" className="text-xs">
                    {activity.intensityLevel}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {activity.durationMinutes} min
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => handleRemoveActivity(activity.id)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {showAddActivity ? (
          <div className="space-y-3 p-3 rounded-lg border">
            <Input
              placeholder="Activity name"
              value={newActivity.activityName}
              onChange={(e) => setNewActivity(prev => ({ ...prev, activityName: e.target.value }))}
              list="common-activities"
            />
            <datalist id="common-activities">
              {COMMON_ACTIVITIES.map(a => <option key={a} value={a} />)}
            </datalist>
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={newActivity.intensityLevel}
                onValueChange={(v) => setNewActivity(prev => ({ ...prev, intensityLevel: v as any }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="moderate">Moderate</SelectItem>
                  <SelectItem value="vigorous">Vigorous</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                placeholder="Duration (min)"
                value={newActivity.durationMinutes}
                onChange={(e) => setNewActivity(prev => ({ ...prev, durationMinutes: e.target.value }))}
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAddActivity}>Add</Button>
              <Button size="sm" variant="outline" onClick={() => setShowAddActivity(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setShowAddActivity(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add Activity
          </Button>
        )}
    </div>
  );
}