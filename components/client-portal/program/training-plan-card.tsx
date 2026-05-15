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
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              {plan.planName}
            </span>
            <span className="font-mono-display text-xs text-muted-foreground">
              {trainingCount} sessions
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {plan.sessions.map((session) =>
              session.isRest ? (
                <span
                  key={session.id}
                  className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                >
                  Rest
                </span>
              ) : (
                <span
                  key={session.id}
                  className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                >
                  {session.name}
                </span>
              ),
            )}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
    </Link>
  );
}
