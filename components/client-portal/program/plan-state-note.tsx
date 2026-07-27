import type { ClientTrainingPlan } from "@/types/client-training-plan";

/**
 * The one-line "when is this program?" meta, shared by the Program tab's card
 * and the training detail page so the two can never word it differently.
 *
 * Renders nothing while the program is running — an active program's dates are
 * noise. It exists for the two states that were previously indistinguishable
 * from "current": a program the coach has queued but that has not started, and
 * one whose last day has passed.
 */
export function PlanStateNote({
  plan,
  className,
}: {
  plan: Pick<ClientTrainingPlan, "state" | "startsOn" | "endsOn">;
  className?: string;
}) {
  if (plan.state === "active") return null;

  const isUpcoming = plan.state === "upcoming";
  const label = isUpcoming ? "Starts" : "Ended";
  const date = formatPlanDate(isUpcoming ? plan.startsOn : plan.endsOn);

  return (
    <span
      className={
        className ?? "font-mono-display text-xs text-muted-foreground"
      }
    >
      {label} {date}
    </span>
  );
}

function formatPlanDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
