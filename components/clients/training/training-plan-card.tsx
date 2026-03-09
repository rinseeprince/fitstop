"use client";

import { useState } from "react";
import type { Client } from "@/types/check-in";
import { TrainingPlanBuilder } from "./builder/training-plan-builder";
import { AddSessionDialog } from "./sessions/add-session-dialog";
import { AddActivityDialog } from "../activities/add-activity-dialog";
import { useTrainingPlan } from "@/hooks/use-training-plan";
import { Loader2 } from "lucide-react";
import { weightToKg } from "@/utils/nutrition-helpers";

type TrainingPlanCardProps = {
  client: Client;
  onUpdate?: () => void;
};

export function TrainingPlanCard({ client, onUpdate }: TrainingPlanCardProps) {
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
      <div className="bg-card rounded-lg border border-border p-5">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <>
      <TrainingPlanBuilder client={client} onUpdate={onUpdate} />

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
