"use client";

import { useState } from "react";
import type { Client } from "@/types/check-in";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrainingSessionCard } from "./training-session-card";
import { TrainingPlanHistoryModal } from "./training-plan-history-modal";
import { AddSessionDialog } from "./add-session-dialog";
import { AddActivityDialog } from "./add-activity-dialog";
import { PlanPromptForm } from "./plan-prompt-form";
import { PlanDisplayHeader } from "./plan-display-header";
import { ExternalActivitiesSection } from "./external-activities-section";
import { WeeklyScheduleView } from "./weekly-schedule-view";
import { useTrainingPlan } from "@/hooks/use-training-plan";
import { useToast } from "@/hooks/use-toast";
import { Dumbbell, History, Plus, Loader2, Activity, LayoutList, CalendarDays } from "lucide-react";
import { weightToKg } from "@/utils/nutrition-helpers";

type TrainingPlanCardProps = {
  client: Client;
  onUpdate?: () => void;
};

export function TrainingPlanCard({ client, onUpdate }: TrainingPlanCardProps) {
  const { toast } = useToast();
  const [showPromptForm, setShowPromptForm] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showAddSession, setShowAddSession] = useState(false);
  const [showAddActivity, setShowAddActivity] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "week">("week");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const clientWeightKg = client.currentWeight
    ? weightToKg(client.currentWeight, client.weightUnit || "lbs")
    : 70;

  const {
    plan,
    isLoading,
    isGenerating,
    prompt,
    setPrompt,
    preGenerationActivities,
    setPreGenerationActivities,
    allowSameDayTraining,
    setAllowSameDayTraining,
    handleGenerate,
    handleAddPreGenActivity,
    handleRemovePreGenActivity,
    fetchPlan,
    trainingSessions,
    externalActivities,
  } = useTrainingPlan({ clientId: client.id, onUpdate });

  const onGenerate = async () => {
    const success = await handleGenerate();
    if (success) {
      setShowPromptForm(false);
    }
  };

  const handleRegenerate = () => {
    // Convert existing external activities to pre-generation format
    // Filter out activities without valid dayOfWeek and activityName (required by schema)
    const validDays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    const activitiesFromPlan = externalActivities
      .filter((a) => {
        const activityName = a.activityMetadata?.activityName || a.name;
        const hasValidName = activityName && activityName.trim().length > 0;
        const hasValidDay = a.dayOfWeek && validDays.includes(a.dayOfWeek.toLowerCase());
        return hasValidName && hasValidDay;
      })
      .map((a) => ({
        tempId: a.id,
        activityName: (a.activityMetadata?.activityName || a.name).trim(),
        dayOfWeek: a.dayOfWeek!.toLowerCase(),
        intensityLevel: a.activityMetadata?.intensityLevel || "moderate" as const,
        durationMinutes: a.activityMetadata?.durationMinutes || 60,
        notes: a.notes,
        analysis: a.activityMetadata
          ? {
              estimatedCalories: a.activityMetadata.estimatedCalories,
              metValue: a.activityMetadata.metValue,
              recoveryImpact: a.activityMetadata.recoveryImpact,
              recoveryHours: a.activityMetadata.recoveryHours,
              muscleGroupsImpacted: a.activityMetadata.muscleGroupsImpacted,
              trainingRecommendations: [],
            }
          : undefined,
      }));
    setPreGenerationActivities(activitiesFromPlan);
    setShowPromptForm(true);
  };

  const handleRefreshExercises = async () => {
    if (!plan) return;

    setIsRefreshing(true);
    try {
      const res = await fetch(
        `/api/clients/${client.id}/training/${plan.id}/refresh-exercises`,
        { method: "POST" }
      );
      const data = await res.json();

      if (data.success) {
        toast({
          title: "Exercises refreshed",
          description: "New exercises have been generated for your training sessions",
        });
        fetchPlan();
      } else {
        throw new Error(data.error || "Failed to refresh exercises");
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to refresh exercises",
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Dumbbell className="h-5 w-5" />
              Training Plan
            </CardTitle>
            <div className="flex items-center gap-2">
              {plan && (
                <>
                  <Badge variant="outline">Plan active</Badge>
                  <Button variant="ghost" size="sm" onClick={() => setShowHistory(true)}>
                    <History className="h-4 w-4 mr-1" /> History
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {(!plan || showPromptForm) && (
            <PlanPromptForm
              prompt={prompt}
              onPromptChange={setPrompt}
              onGenerate={onGenerate}
              onCancel={() => setShowPromptForm(false)}
              isGenerating={isGenerating}
              isRegeneration={!!plan}
              showCancel={!!plan && showPromptForm}
              preGenerationActivities={preGenerationActivities}
              onAddActivity={handleAddPreGenActivity}
              onRemoveActivity={handleRemovePreGenActivity}
              clientWeightKg={clientWeightKg}
              allowSameDayTraining={allowSameDayTraining}
              onAllowSameDayTrainingChange={setAllowSameDayTraining}
            />
          )}

          {plan && !showPromptForm && (
            <div className="space-y-4">
              <PlanDisplayHeader
                plan={plan}
                editMode={editMode}
                onToggleEdit={() => setEditMode(!editMode)}
                onRegenerate={handleRegenerate}
                onRefreshExercises={handleRefreshExercises}
                isRefreshing={isRefreshing}
              />

              <div className="flex items-center justify-end gap-1 border-b pb-2">
                <span className="text-sm text-muted-foreground mr-2">View:</span>
                <Button
                  variant={viewMode === "week" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("week")}
                  className="h-8"
                >
                  <CalendarDays className="h-4 w-4 mr-1" />
                  Week
                </Button>
                <Button
                  variant={viewMode === "list" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("list")}
                  className="h-8"
                >
                  <LayoutList className="h-4 w-4 mr-1" />
                  List
                </Button>
              </div>

              {viewMode === "week" ? (
                <WeeklyScheduleView
                  sessions={trainingSessions}
                  activities={externalActivities}
                  editMode={editMode}
                  clientId={client.id}
                  planId={plan.id}
                  onUpdate={fetchPlan}
                />
              ) : (
                <>
                  <div className="space-y-2">
                    {trainingSessions.map((session) => (
                      <TrainingSessionCard
                        key={session.id}
                        session={session}
                        clientId={client.id}
                        planId={plan.id}
                        editMode={editMode}
                        onUpdate={fetchPlan}
                      />
                    ))}
                  </div>

                  <ExternalActivitiesSection
                    activities={externalActivities}
                    clientId={client.id}
                    planId={plan.id}
                    editMode={editMode}
                    onUpdate={fetchPlan}
                  />
                </>
              )}

              {editMode && (
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setShowAddSession(true)}>
                    <Plus className="h-4 w-4 mr-2" /> Add Session
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={() => setShowAddActivity(true)}>
                    <Activity className="h-4 w-4 mr-2" /> Add Activity
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <TrainingPlanHistoryModal
        clientId={client.id}
        open={showHistory}
        onOpenChange={setShowHistory}
      />

      {plan && (
        <>
          <AddSessionDialog
            clientId={client.id}
            planId={plan.id}
            open={showAddSession}
            onOpenChange={setShowAddSession}
            onSuccess={fetchPlan}
          />
          <AddActivityDialog
            clientId={client.id}
            planId={plan.id}
            clientWeightKg={clientWeightKg}
            open={showAddActivity}
            onOpenChange={setShowAddActivity}
            onSuccess={fetchPlan}
          />
        </>
      )}
    </>
  );
}
