"use client";

import type { Client } from "@/types/check-in";
import { NutritionPlanBuilder } from "./builder/nutrition-plan-builder";

type NutritionCalculatorCardEnhancedProps = {
  client: Client;
  onUpdate?: () => void;
};

export function NutritionCalculatorCardEnhanced({
  client,
  onUpdate,
}: NutritionCalculatorCardEnhancedProps) {
  return <NutritionPlanBuilder client={client} onUpdate={onUpdate} />;
}
