import type { ClientProgram } from "@/types/client-program";

type Props = {
  roadmapName: string;
  longTermGoal: string | null;
  goalWeight: number | null;
  goalBodyFatPercentage: number | null;
  targetEndDate: string | null;
  startedAt: string | null;
  startingWeight: number | null;
  currentWeight: number | null;
  weightUnit: "lbs" | "kg";
  phases: ClientProgram["phases"];
};

function formatLongDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatStat(value: number | null): string {
  return value != null ? value.toFixed(1) : "-";
}

function buildTargetLine(
  goalWeight: number | null,
  goalBodyFatPercentage: number | null,
  targetEndDate: string | null,
  unit: "lbs" | "kg",
): string | null {
  const parts: string[] = [];
  if (goalWeight != null) parts.push(`${goalWeight.toFixed(1)} ${unit}`);
  if (goalBodyFatPercentage != null) parts.push(`${goalBodyFatPercentage}% BF`);
  if (targetEndDate) parts.push(`By ${formatLongDate(targetEndDate)}`);
  if (parts.length === 0) return null;
  return `Target: ${parts.join(" · ")}`;
}

export function RoadmapSummaryStrip({
  roadmapName,
  longTermGoal,
  goalWeight,
  goalBodyFatPercentage,
  targetEndDate,
  startedAt,
  startingWeight,
  currentWeight,
  weightUnit,
  phases,
}: Props) {
  const targetLine = buildTargetLine(
    goalWeight,
    goalBodyFatPercentage,
    targetEndDate,
    weightUnit,
  );

  const delta =
    currentWeight != null && startingWeight != null
      ? currentWeight - startingWeight
      : null;

  const toGo =
    goalWeight != null && currentWeight != null
      ? Math.abs(goalWeight - currentWeight)
      : null;

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <h1 className="text-lg font-semibold text-foreground">{roadmapName}</h1>
      {longTermGoal && (
        <p className="mt-1 text-sm text-muted-foreground">{longTermGoal}</p>
      )}
      {targetLine && (
        <p className="mt-1 text-sm text-muted-foreground">{targetLine}</p>
      )}

      {phases.length > 0 && (
        <div className="mt-4">
          <div className="flex gap-1">
            {phases.map((phase) => (
              <div
                key={phase.id}
                className={`h-1.5 flex-1 rounded-full ${
                  phase.status === "completed" || phase.status === "active"
                    ? "bg-primary"
                    : "bg-muted"
                }`}
              />
            ))}
          </div>
          {(startedAt || targetEndDate) && (
            <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground font-mono-display">
              <span>{startedAt ? formatLongDate(startedAt) : ""}</span>
              <span>{targetEndDate ? formatLongDate(targetEndDate) : ""}</span>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-4">
        <StatColumn
          label="Start Weight"
          value={formatStat(startingWeight)}
          unit={weightUnit}
        />
        <StatColumn
          label="Current Weight"
          value={formatStat(currentWeight)}
          unit={weightUnit}
          sub={
            delta != null ? (
              <span className={delta <= 0 ? "text-success" : "text-warning"}>
                {delta > 0 ? "+" : ""}
                {delta.toFixed(1)} {weightUnit}
              </span>
            ) : null
          }
        />
        <StatColumn
          label="Goal Weight"
          value={formatStat(goalWeight)}
          unit={weightUnit}
          sub={
            toGo != null ? (
              <span className="text-muted-foreground">
                {toGo.toFixed(1)} {weightUnit} to go
              </span>
            ) : null
          }
        />
      </div>
    </div>
  );
}

function StatColumn({
  label,
  value,
  unit,
  sub,
}: {
  label: string;
  value: string;
  unit: string;
  sub?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
        {label}
      </span>
      <span className="mt-1 text-2xl font-semibold font-mono-display text-foreground leading-none">
        {value}
      </span>
      <span className="mt-1 text-[11px] font-mono-display text-muted-foreground">
        {sub ?? unit}
      </span>
    </div>
  );
}
