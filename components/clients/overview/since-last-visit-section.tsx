"use client";

import type { ReactNode } from "react";
import { ClipboardCheck, Dumbbell, Inbox, Loader2, Ruler, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { METRIC_DEFINITIONS } from "@/components/clients/metrics/hooks/use-metrics-data";
import {
  MONO,
  MONO_META_CLASS,
  THUMB_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { CardHeader, OverviewCard } from "./overview-primitives";
import { formatDateOnlyShort, formatMetricValue, formatRelativeShort, pluralize } from "./overview-format";
import type { ActivityItem } from "@/types/coach-brief";

type SinceLastVisitSectionProps = {
  lastViewedAt: string | null;
  activity: ActivityItem[];
  onMarkSeen: () => void;
  isMarkingSeen: boolean;
};

// PR weights come off set_logs, which the coach exercise-data surface renders
// in kilograms (components/training/exercise-data/exercise-pr-view.tsx).
const PR_WEIGHT_UNIT = "kg";

function metricName(metricKey: string): string {
  return METRIC_DEFINITIONS.find((definition) => definition.id === metricKey)?.name ?? "Measurement";
}

function Mono({ children }: { children: ReactNode }) {
  return <span className={MONO}>{children}</span>;
}

/** One feed row's icon, headline and detail line. */
function describe(item: ActivityItem): { icon: ReactNode; title: string; detail?: ReactNode } {
  switch (item.type) {
    case "check_in":
      return { icon: <ClipboardCheck className="h-4 w-4" strokeWidth={1.5} />, title: "Check-in submitted" };

    case "measurement": {
      const value = formatMetricValue(item.value, item.unit);
      const delta = item.previousValue === null ? null : item.value - item.previousValue;
      return {
        icon: <Ruler className="h-4 w-4" strokeWidth={1.5} />,
        title: `${metricName(item.metricKey)} logged`,
        detail: (
          <>
            <Mono>{value}</Mono>
            {delta !== null && (
              <>
                {" · "}
                <Mono>
                  {delta > 0 ? "+" : ""}
                  {delta.toFixed(1)}
                </Mono>
                {" from last"}
              </>
            )}
          </>
        ),
      };
    }

    case "pr":
      return {
        icon: <Trophy className="h-4 w-4" strokeWidth={1.5} />,
        title: "New personal record",
        detail: (
          <>
            {item.exerciseName}
            {" · "}
            <Mono>
              {item.weight} {PR_WEIGHT_UNIT}
            </Mono>
            {", was "}
            <Mono>
              {item.previousBest} {PR_WEIGHT_UNIT}
            </Mono>
          </>
        ),
      };

    case "session_completed":
      return {
        icon: <Dumbbell className="h-4 w-4" strokeWidth={1.5} />,
        title: "Session completed",
        detail: (
          <>
            {item.sessionName}
            {" · "}
            <Mono>{pluralize(item.exerciseCount, "exercise")}</Mono>
          </>
        ),
      };
  }
}

export function SinceLastVisitSection({
  lastViewedAt,
  activity,
  onMarkSeen,
  isMarkingSeen,
}: SinceLastVisitSectionProps) {
  return (
    <OverviewCard animationDelay="0.04s">
      <CardHeader
        title="Since your last visit"
        right={
          activity.length > 0 ? (
            <button
              type="button"
              onClick={onMarkSeen}
              disabled={isMarkingSeen}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#5a7d82] transition-colors hover:text-[#0d9488] disabled:opacity-50"
            >
              {isMarkingSeen && <Loader2 className="h-3 w-3 animate-spin" />}
              Mark seen
            </button>
          ) : undefined
        }
      />

      {activity.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-5 py-8 text-center">
          <Inbox className="h-8 w-8 text-[#93b0b4] opacity-50" strokeWidth={1.5} />
          {lastViewedAt === null ? (
            <>
              <p className="mt-2 text-sm text-[#5a7d82]">First time viewing this client</p>
              <p className="mt-1 text-xs text-[#93b0b4]">
                From your next visit, everything they log lands here.
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-[#5a7d82]">You&apos;re all caught up</p>
              <p className={cn(MONO_META_CLASS, "mt-1 text-xs")}>
                Nothing new since {formatDateOnlyShort(lastViewedAt.slice(0, 10))}
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="px-3 pb-4">
          {activity.map((item, i) => {
            const { icon, title, detail } = describe(item);
            return (
              <div key={`${item.type}-${item.at}-${i}`} className="flex items-start gap-3 px-2 py-2">
                <span className={cn(THUMB_CLASS, "h-8 w-8")}>{icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-[#0c1a1e]">{title}</p>
                  {detail && (
                    <p className="mt-0.5 truncate text-[11px] text-[#93b0b4]">{detail}</p>
                  )}
                </div>
                <span className={cn(MONO_META_CLASS, "shrink-0 pt-0.5 text-[10px]")}>
                  {formatRelativeShort(item.at)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </OverviewCard>
  );
}
