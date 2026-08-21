"use client";

import type { ClientTab } from "@/lib/client-tabs";
import type { Client } from "@/types/check-in";
import { NutritionPlanBuilder } from "./builder/nutrition-plan-builder";

type NutritionCalculatorCardEnhancedProps = {
  client: Client;
  onUpdate?: () => void;
  /** Pass-through for the Journey round trip's way back (7.4). */
  onTabChange?: (tab: ClientTab, extraParams?: Record<string, string>) => void;
};

export function NutritionCalculatorCardEnhanced({
  client,
  onUpdate,
  onTabChange,
}: NutritionCalculatorCardEnhancedProps) {
  return (
    <NutritionPlanBuilder
      client={client}
      onUpdate={onUpdate}
      onTabChange={onTabChange}
    />
  );
}
