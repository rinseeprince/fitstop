"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SinceLastVisit } from "@/types/coach-brief";

type SinceLastVisitSectionProps = {
  lastViewedAt: string | null;
  deltas: SinceLastVisit;
};

function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${n === 1 ? singular : pluralForm ?? `${singular}s`}`;
}

function formatViewed(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export function SinceLastVisitSection({ lastViewedAt, deltas }: SinceLastVisitSectionProps) {
  const items: string[] = [];
  if (deltas.newCheckIns > 0) items.push(plural(deltas.newCheckIns, "new check-in"));
  if (deltas.newLogs > 0) items.push(plural(deltas.newLogs, "day logged", "days logged"));
  if (deltas.newWorkoutsLogged > 0) items.push(plural(deltas.newWorkoutsLogged, "workout logged", "workouts logged"));
  if (deltas.eventStatusChanges > 0) items.push(plural(deltas.eventStatusChanges, "session update"));
  if (deltas.newBodyMetrics > 0) items.push(plural(deltas.newBodyMetrics, "new measurement"));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Since your last visit</CardTitle>
      </CardHeader>
      <CardContent>
        {lastViewedAt === null ? (
          <p className="text-sm text-muted-foreground">First time viewing this client.</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing new since {formatViewed(lastViewedAt)}.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {items.map((item) => (
              <li key={item} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
