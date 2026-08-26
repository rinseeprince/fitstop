"use client";

import type { ClientTab } from "@/lib/client-tabs";
import type { Client } from "@/types/check-in";
import { TrainingPlanBuilder } from "./builder/training-plan-builder";

type TrainingPlanCardProps = {
  client: Client;
  // Pass-through only. One passenger today (the history table's exercise
  // drill-down, which now crosses to the Journey tab) — a SECOND one riding
  // this page → card → builder → table chain makes it a context, not a fourth
  // prop level (CONVENTIONS §4).
  onTabChange?: (
    tab: ClientTab,
    extraParams?: Record<string, string | null>
  ) => void;
};

export function TrainingPlanCard({
  client,
  onTabChange,
}: TrainingPlanCardProps) {
  return (
    <TrainingPlanBuilder
      client={client}
      onTabChange={onTabChange}
    />
  );
}
