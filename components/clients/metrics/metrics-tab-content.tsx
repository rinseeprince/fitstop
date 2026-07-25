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
import { DEFAULT_FOCUS, type MetricTab } from "./metrics-view-types";
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

  // Honor `subtab` only when the URL's `tab` is actually ours (same guard as
  // the training page): a stale subtab written by another tab must not flash
  // the wrong pane during a tab switch.
  const rawSubtab =
    searchParams.get("tab") === "metrics" ? searchParams.get("subtab") : null;
  const tab: MetricTab = rawSubtab === "wellness" ? "wellness" : "body";
  const setTab = (t: MetricTab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("subtab", t);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

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
        client={client}
        tab={tab}
        onTabChange={setTab}
        onLogClick={() => setLogOpen(true)}
      />

      {isError ? (
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
