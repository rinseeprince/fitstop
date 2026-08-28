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
import { SectionLabel } from "@/components/programs/shared/section-label";
import { OverviewCard } from "./overview-primitives";
import { formatMetricValue, formatRelativeShort, pluralize } from "./overview-format";
import type { ActivityItem } from "@/types/coach-brief";
import { useUnits } from "@/contexts/units-context";
import {
  formatLength,
  formatLoad,
  formatWeight,
  type UnitSystem,
} from "@/utils/unit-conversions";

type SinceLastVisitSectionProps = {
  lastViewedAt: string | null;
  activity: ActivityItem[];
  onMarkSeen: () => void;
  isMarkingSeen: boolean;
};

function definitionFor(metricKey: string) {
  return METRIC_DEFINITIONS.find((definition) => definition.id === metricKey);
}

function metricName(metricKey: string): string {
  return definitionFor(metricKey)?.name ?? "Measurement";
}

// Feed values arrive as canonical kg/cm (types/coach-brief.ts). The unit label
// and the conversion both resolve here, from the same METRIC_DEFINITIONS entry
// the Metrics page uses — so the two surfaces cannot disagree.
function toViewer(metricKey: string, value: number, viewer: UnitSystem): number {
  const convert = definitionFor(metricKey)?.convert;
  if (convert === "weight") return formatWeight(value, viewer).value;
  if (convert === "length") return formatLength(value, viewer).value;
  return value;
}

function Mono({ children }: { children: ReactNode }) {
  return <span className={MONO}>{children}</span>;
}

/** One feed row's icon, headline and detail line. */
function describe(
  item: ActivityItem,
  viewer: UnitSystem,
): { icon: ReactNode; title: string; detail?: ReactNode } {
  switch (item.type) {
    case "check_in":
      return { icon: <ClipboardCheck className="h-4 w-4" strokeWidth={1.5} />, title: "Check-in submitted" };

    case "measurement": {
      const unit = definitionFor(item.metricKey)?.getUnit(viewer) ?? "";
      const shown = toViewer(item.metricKey, item.value, viewer);
      const value = formatMetricValue(shown, unit);
      // The delta is taken between DISPLAYED values so it reconciles with them.
      const delta =
        item.previousValue === null
          ? null
          : shown - toViewer(item.metricKey, item.previousValue, viewer);
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
            {/* A PR is a barbell load, so formatLoad — it snaps to something
                you can actually put on a bar. */}
            <Mono>
              {formatLoad(item.weight, viewer).value} {formatLoad(item.weight, viewer).unit}
            </Mono>
            {", was "}
            <Mono>
              {formatLoad(item.previousBest, viewer).value}{" "}
              {formatLoad(item.previousBest, viewer).unit}
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
  const { preference } = useUnits();
  return (
    // Its own rail, deliberately OUTSIDE the page's window control: this feed
    // is anchored to `last_viewed_at`, not to a period, so it must not read as
    // something the 30/60 selector governs.
    <div className="flex flex-1 flex-col">
      <SectionLabel
        label="Since your last visit"
        actions={
          activity.length > 0 ? (
            <button
              type="button"
              onClick={onMarkSeen}
              disabled={isMarkingSeen}
              className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-[#5a7d82] transition-colors hover:text-[#0d9488] disabled:opacity-50"
            >
              {isMarkingSeen && <Loader2 className="h-3 w-3 animate-spin" />}
              Mark seen
            </button>
          ) : undefined
        }
      />

      <OverviewCard className="flex-1" animationDelay="0.08s">
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
              <p className="mt-2 text-sm text-[#5a7d82]">You&apos;re all caught up</p>
            )}
          </div>
        ) : (
          <div className="px-3 py-3">
            {activity.map((item, i) => {
              const { icon, title, detail } = describe(item, preference);
              return (
                <div
                  key={`${item.type}-${item.at}-${i}`}
                  className="flex items-start gap-3 px-2 py-2"
                >
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
    </div>
  );
}
