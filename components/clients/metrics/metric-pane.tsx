"use client";

import { useMemo, type ComponentProps } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricHero } from "./metric-hero";
import { MetricProgressionSection } from "./metric-progression-section";
import { MeasurementLogSection } from "./measurement-log-section";
import { useClientBlocks } from "./hooks/use-client-blocks";
import {
  usePhysiqueMetrics,
  useWellnessMetrics,
  type MetricPaneData,
} from "./hooks/use-merged-metrics";
import { shapeBlockBandIdentity } from "./blocks/block-chart-bands";
import type { LogRow } from "./metrics-view-types";
import type { Client } from "@/types/check-in";

type ProgressionRange = ComponentProps<typeof MetricProgressionSection>["range"];

/**
 * What the Journey hands a metric pane: the selected metric, the chart's view
 * and the log's row actions — never data. Each pane reads its own (see
 * use-merged-metrics.ts), so the Journey loads a pane's data only while the
 * pane is on screen.
 */
type MetricPaneProps = {
  clientId: string;
  /** Resolved by the host from the address, against the pane's own metrics. */
  focusedMetricId: string;
  onSelectMetric: (id: string) => void;
  range: ProgressionRange;
  onRangeChange: (range: ProgressionRange) => void;
  showBlocks: boolean;
  onToggleBlocks: (show: boolean) => void;
  onLogFirst: () => void;
  onEditReading: (row: LogRow) => void;
  onRemoveReading: (row: LogRow) => void;
  onRestoreReading: (row: LogRow) => void;
  pendingRowId: string | null;
};

/** The Physique pane: the measurement series and the goal. */
export function PhysiquePane({ client, ...props }: MetricPaneProps & { client: Client }) {
  const data = usePhysiqueMetrics(client);
  return <MetricPaneBody data={data} {...props} />;
}

/** The Wellness pane: the check-ins' weekly averages and the coach's entries. */
export function WellnessPane(props: MetricPaneProps) {
  const data = useWellnessMetrics(props.clientId);
  return <MetricPaneBody data={data} {...props} />;
}

/** Hero, chart and measurement log — the same for both panes. */
function MetricPaneBody({
  data,
  clientId,
  focusedMetricId,
  onSelectMetric,
  range,
  onRangeChange,
  showBlocks,
  onToggleBlocks,
  onLogFirst,
  onEditReading,
  onRemoveReading,
  onRestoreReading,
  pendingRowId,
}: MetricPaneProps & { data: MetricPaneData }) {
  // The chart's block bands: the Blocks pane's own read, shared through SWR.
  const { blocks } = useClientBlocks(clientId);
  const blockBands = useMemo(() => shapeBlockBandIdentity(blocks), [blocks]);

  const { metrics, logRows, isLoading, isError } = data;
  const focusedMetric = metrics.find((m) => m.id === focusedMetricId) ?? null;

  if (isError) {
    return (
      <p className="py-12 text-center text-[13px] text-[#93b0b4]">
        Failed to load metrics.
      </p>
    );
  }

  if (isLoading) {
    return (
      <div>
        <div className="mb-4">
          <MetricHero metric={null} metrics={[]} onSelectMetric={() => {}} />
        </div>
        <div className="mb-4 grid grid-cols-3 gap-[10px]">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[88px] rounded-[6px]" />
          ))}
        </div>
        <Skeleton className="h-[380px] w-full rounded-[6px]" />
      </div>
    );
  }

  if (!focusedMetric) return null;

  return (
    <>
      <div className="mb-4">
        <MetricHero metric={focusedMetric} metrics={metrics} onSelectMetric={onSelectMetric} />
      </div>
      <MetricProgressionSection
        metric={focusedMetric}
        range={range}
        onRangeChange={onRangeChange}
        onLogFirst={onLogFirst}
        blockBands={blockBands}
        showBlocks={showBlocks}
        onToggleBlocks={onToggleBlocks}
      />
      {/* The key remounts the log on every switch — metric ids are unique
          across both panes — so its page returns to 1 with no effect. */}
      <MeasurementLogSection
        key={focusedMetric.id}
        metric={focusedMetric}
        rows={logRows}
        onEditReading={onEditReading}
        onRemoveReading={onRemoveReading}
        onRestoreReading={onRestoreReading}
        pendingRowId={pendingRowId}
      />
    </>
  );
}
