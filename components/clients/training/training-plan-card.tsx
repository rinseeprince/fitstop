"use client";

import { useState } from "react";
import type { Client } from "@/types/check-in";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrainingPlanBuilder } from "./builder/training-plan-builder";
import { TrainingPlanHistoryModal } from "./training-plan-history-modal";
import { AddSessionDialog } from "./sessions/add-session-dialog";
import { AddActivityDialog } from "../activities/add-activity-dialog";
import { useTrainingPlan } from "@/hooks/use-training-plan";
import { Dumbbell, History, Loader2 } from "lucide-react";
import { weightToKg } from "@/utils/nutrition-helpers";

type TrainingPlanCardProps = {
  client: Client;
  onUpdate?: () => void;
};

export function TrainingPlanCard({ client, onUpdate }: TrainingPlanCardProps) {
  const [showHistory, setShowHistory] = useState(false);
  const [showAddSession, setShowAddSession] = useState(false);
  const [showAddActivity, setShowAddActivity] = useState(false);

  const clientWeightKg = client.currentWeight
    ? weightToKg(client.currentWeight, client.weightUnit || "lbs")
    : 70;

  const { plan, isLoading, fetchPlan } = useTrainingPlan({
    clientId: client.id,
    onUpdate,
  });

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
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Dumbbell className="h-5 w-5" />
              Training Plan
            </CardTitle>
            {plan && (
              <Button variant="ghost" size="sm" onClick={() => setShowHistory(true)}>
                <History className="h-4 w-4 mr-1" /> History
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent>
          <TrainingPlanBuilder
            client={client}
            onUpdate={onUpdate}
          />
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
