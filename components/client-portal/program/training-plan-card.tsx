import Link from "next/link";
import { ChevronRight } from "lucide-react";

import type { ClientTrainingPlan } from "@/types/client-training-plan";

type Props = {
  plan: ClientTrainingPlan;
};

export function TrainingPlanCard({ plan }: Props) {
  const trainingCount = plan.sessions.filter((s) => !s.isRest).length;

  return (
    <Link
      href="/client/program/training"
      className="block rounded-md border border-border bg-card p-3 transition-colors hover:bg-accent"
    >
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">
            {plan.planName}
          </span>
          <span className="font-mono-display text-xs text-muted-foreground">
            {trainingCount} sessions
          </span>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
    </Link>
  );
}
