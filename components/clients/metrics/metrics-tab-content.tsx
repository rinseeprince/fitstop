"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricsTopBar } from "./metrics-top-bar";
import { MetricHero } from "./metric-hero";
import { MetricProgressionSection } from "./metric-progression-section";
import { MeasurementLogSection } from "./measurement-log-section";
import { LogMeasurementDialog } from "./log-measurement-dialog";
import { useMergedMetrics } from "./hooks/use-merged-metrics";
import { useClientBlocks } from "./hooks/use-client-blocks";
import { BlocksSubtab } from "./blocks/blocks-subtab";
import { shapeBlockBandIdentity } from "./blocks/block-chart-bands";
// The Training pane's analytics live under clients/training/ and are MOUNTED
// here (Session 7.1): analytics belong to Journey, prescription stays on the
// Training tab. Same coach-facing audience, and the dependency runs one way —
// Journey imports the view; the view knows nothing of Journey.
import { ExerciseDataView } from "@/components/clients/training/exercise-data/exercise-data-view";
import {
  DEFAULT_FOCUS,
  isJourneySubtab,
  toMetricTab,
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

  // Journey owns its pane param outright (?journey=) — the shape Training and
  // Nutrition adopted in Session 7.2. Nothing else writes it, so it is read
  // unconditionally: the value deliberately persists across top-level tab
  // switches (handleTabChange preserves it) and restores this pane on return.
  const rawPane = searchParams.get("journey");
  const pane: JourneySubtab = isJourneySubtab(rawPane) ? rawPane : "body";
  const setPane = (t: JourneySubtab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("journey", t);
    router.replace(`?${params.toString()}`, { scroll: false });
  };
  // The metric-keyed derivations below want a MetricTab; the panes that key
  // nothing (Training, Blocks) idle on "body". The mapping is a whitelist in
  // metrics-view-types.ts so the next pane is safe without touching this line.
  const tab: MetricTab = toMetricTab(pane);

  // Focused metric resets on tab switch by derivation (no effects): a stored
  // focus applies only while its own tab is active.
  const [focused, setFocused] = useState<{ tab: MetricTab; id: string } | null>(
    null
  );
  const focusedId = focused?.tab === tab ? focused.id : DEFAULT_FOCUS[tab];

  const [range, setRange] = useState<30 | 60 | 90 | "all">(30);
  const [logOpen, setLogOpen] = useState(false);
  // Chart-band toggle: ON by default when blocks exist (owner-reviewed at
  // plan time); the checkbox lives in the chart card's legend slot.
  const [showBlocks, setShowBlocks] = useState(true);

  const { metricsByTab, logRowsByTab, isLoading, isError, logMeasurement } =
    useMergedMetrics(client, onClientUpdated);
  // Shares the SWR cache with the Blocks pane — one read serves both.
  const { blocks } = useClientBlocks(client.id);
  const blockBands = useMemo(() => shapeBlockBandIdentity(blocks), [blocks]);

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
      ) : pane === "training" ? (
        <ExerciseDataView clientId={client.id} />
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
            blockBands={blockBands}
            showBlocks={showBlocks}
            onToggleBlocks={setShowBlocks}
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
