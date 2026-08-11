"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricsTopBar } from "./metrics-top-bar";
import { MetricHero } from "./metric-hero";
import { MetricProgressionSection } from "./metric-progression-section";
import { MeasurementLogSection } from "./measurement-log-section";
import { LogMeasurementDialog } from "./log-measurement-dialog";
import { useMergedMetrics } from "./hooks/use-merged-metrics";
import { BlocksSubtab } from "./blocks/blocks-subtab";
import {
  DEFAULT_FOCUS,
  isJourneySubtab,
  type JourneySubtab,
  type MetricTab,
} from "./metrics-view-types";
import type { Client } from "@/types/check-in";

type MetricsTabContentProps = {
  client: Client;
  onClientUpdated?: () => void;
};

export const MetricsTabContent = ({
  client,
  onClientUpdated,
}: MetricsTabContentProps) => {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Journey owns its pane param outright (?journey=), unlike Training and
  // Nutrition, which SHARE ?subtab= and therefore need tab-match guards
  // against each other's writes. Nothing else writes ?journey=, so it is read
  // unconditionally: the value deliberately persists across top-level tab
  // switches (handleTabChange preserves it) and restores this pane on return.
  const rawPane = searchParams.get("journey");
  const pane: JourneySubtab = isJourneySubtab(rawPane) ? rawPane : "body";
  const setPane = (t: JourneySubtab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("journey", t);
    router.replace(`?${params.toString()}`, { scroll: false });
  };
  // The metric-keyed derivations below want a MetricTab; on the Blocks pane
  // they idle on "body" (nothing metric-keyed renders there).
  const tab: MetricTab = pane === "blocks" ? "body" : pane;

  // Focused metric resets on tab switch by derivation (no effects): a stored
  // focus applies only while its own tab is active.
  const [focused, setFocused] = useState<{ tab: MetricTab; id: string } | null>(
    null
  );
  const focusedId = focused?.tab === tab ? focused.id : DEFAULT_FOCUS[tab];

  const [range, setRange] = useState<30 | 60 | 90 | "all">(30);
  const [logOpen, setLogOpen] = useState(false);

  const { metricsByTab, logRowsByTab, isLoading, isError, logMeasurement } =
    useMergedMetrics(client, onClientUpdated);

  const metrics = metricsByTab[tab];
  const focusedMetric = metrics.find((m) => m.id === focusedId) ?? metrics[0] ?? null;

  return (
    <div>
      <MetricsTopBar
        tab={pane}
        onTabChange={setPane}
        onLogClick={() => setLogOpen(true)}
      />

      {pane === "blocks" ? (
        <BlocksSubtab
          clientId={client.id}
          weightMetric={
            metricsByTab.body.find((metric) => metric.id === "weight") ?? null
          }
        />
      ) : isError ? (
        <p className="py-12 text-center text-[13px] text-[#93b0b4]">
          Failed to load metrics.
        </p>
      ) : isLoading ? (
        <div>
          <Skeleton className="mb-4 h-[150px] w-full rounded-[6px] bg-[#0f2027]" />
          <div className="mb-4 grid grid-cols-3 gap-[10px]">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[88px] rounded-[6px]" />
            ))}
          </div>
          <Skeleton className="h-[380px] w-full rounded-[6px]" />
        </div>
      ) : focusedMetric ? (
        <>
          <div className="mb-4">
            <MetricHero
              metric={focusedMetric}
              metrics={metrics}
              onSelectMetric={(id) => setFocused({ tab, id })}
            />
          </div>
          <MetricProgressionSection
            metric={focusedMetric}
            range={range}
            onRangeChange={setRange}
            onLogFirst={() => setLogOpen(true)}
          />
          {/* key={tab} resets the log's page state when the tab switches */}
          <MeasurementLogSection key={tab} rows={logRowsByTab[tab]} />
        </>
      ) : null}

      <LogMeasurementDialog
        open={logOpen}
        onOpenChange={setLogOpen}
        metrics={[...metricsByTab.body, ...metricsByTab.wellness]}
        initialMetricId={focusedMetric?.id ?? DEFAULT_FOCUS[tab]}
        onSubmit={logMeasurement}
      />
    </div>
  );
};
