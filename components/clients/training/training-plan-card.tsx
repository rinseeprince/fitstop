"use client";

import type { Client } from "@/types/check-in";
import { TrainingPlanBuilder } from "./builder/training-plan-builder";

type TrainingPlanCardProps = {
  client: Client;
  onUpdate?: () => void;
};

export function TrainingPlanCard({ client, onUpdate }: TrainingPlanCardProps) {
  return <TrainingPlanBuilder client={client} onUpdate={onUpdate} />;
}
