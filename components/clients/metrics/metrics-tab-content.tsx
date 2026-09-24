"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MetricsTopBar } from "./metrics-top-bar";
import { PhysiquePane, WellnessPane } from "./metric-pane";
import { LogMeasurementDialog } from "./log-measurement-dialog";
import { EditReadingDialog } from "./edit-reading-dialog";
import { RemoveReadingDialog } from "./remove-reading-dialog";
import { useLogMeasurement } from "./hooks/use-log-measurement";
import { useReadingActions } from "./hooks/use-reading-actions";
import {
  BODY_METRIC_DEFINITIONS,
  WELLNESS_METRIC_DEFINITIONS,
} from "./hooks/use-metrics-data";
import { useDialogSubject } from "@/hooks/use-dialog-subject";
import { useUnits } from "@/contexts/units-context";
import { toast } from "sonner";
import { BlocksSubtab } from "./blocks/blocks-subtab";
import { GoalsPane } from "./goals/goals-pane";
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
  type LogRow,
  type MetricTab,
} from "./metrics-view-types";
import type { ClientTab } from "@/lib/client-tabs";
import type { Client } from "@/types/check-in";

type MetricsTabContentProps = {
  client: Client;
  onClientUpdated?: () => void;
  /** The Blocks pane's round trip out of an unset Training/Nutrition fact
   *  (7.3/7.4) — the same seam the Overview already uses. */
  onTabChange?: (tab: ClientTab, extraParams?: Record<string, string>) => void;
};

/**
 * The Journey tab: the pane bar, the pane on screen, and the dialogs the panes
 * share. It reads NOTHING itself — each pane reads its own data, so only the
 * pane on screen loads (Physique: the measurements, the goal and the blocks;
 * Goals: the goals table, the measurements and the goal; Wellness: the
 * wellness series and the blocks; Training: its exercise reads; Blocks: the
 * blocks and their plans). Log measurement sits on the Physique pane alone,
 * its metric list the seven physique metrics of the catalog.
 */
export const MetricsTabContent = ({
  client,
  onClientUpdated,
  onTabChange,
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
    // The metric is the pane's subject: a pane switch drops it in the same
    // navigation, so the URL never asserts a metric the new pane cannot show.
    params.delete("metric");
    // A pane is a PLACE: it pushes, so Back returns to the pane the coach
    // left. The position is kept — a pane switch is not a page change.
    router.push(`?${params.toString()}`, { scroll: false });
  };
  // The metric-keyed derivations below want a MetricTab; the panes that key
  // nothing (Goals, Training, Blocks) idle on "body". The mapping is a
  // whitelist in metrics-view-types.ts so the next pane is safe without
  // touching this line.
  const tab: MetricTab = toMetricTab(pane);

  // The selected metric is Journey's second single-owner param, ?metric= —
  // the subject the hero, the chart and the log all describe (CONVENTIONS §7:
  // a selected record lives in the URL and nowhere else). Read unconditionally
  // so a deep link resolves on the first render, and validated against the
  // pane's own metrics — the fixed catalog, so no read is waited on — so an
  // unknown value or the other pane's metric derives to the pane default with
  // no state.
  const metricParam = searchParams.get("metric");
  const setMetric = (id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("metric", id);
    // A refinement of the pane, not a place: it replaces, so Back leaves the
    // pane in one step however many metrics were viewed.
    router.replace(`?${params.toString()}`, { scroll: false });
  };
  const paneMetrics = tab === "body" ? BODY_METRIC_DEFINITIONS : WELLNESS_METRIC_DEFINITIONS;
  const focusedMetricId =
    metricParam != null && paneMetrics.some((def) => def.id === metricParam)
      ? metricParam
      : DEFAULT_FOCUS[tab];

  const [range, setRange] = useState<30 | 60 | 90 | "all">(30);
  const [logOpen, setLogOpen] = useState(false);
  // Chart-band toggle: ON by default when blocks exist (owner-reviewed at
  // plan time); the checkbox lives in the chart card's legend slot.
  const [showBlocks, setShowBlocks] = useState(true);

  // The dialog lists the physique metrics, from the catalog: opening it loads
  // nothing.
  const { preference } = useUnits();
  const logMetrics = useMemo(
    () =>
      BODY_METRIC_DEFINITIONS.map((def) => ({
        id: def.id,
        name: def.name,
        unit: def.getUnit(preference),
      })),
    [preference]
  );
  // The pane on screen is refreshed in place by the save; a store no pane on
  // screen shows is cleared (use-log-measurement.ts). The dialog opens on
  // Physique, but it is local state: a browser Back while it is open leaves it
  // open over another pane, so the save reads the pane from the address.
  const logMeasurement = useLogMeasurement(client.id, pane, onClientUpdated);

  // The log's three row actions: Edit and Remove open a dialog, Restore is one
  // click (the removed row already says what it is). The dialogs toast their
  // own outcome; the click's toast lives here.
  const readingActions = useReadingActions(client.id, onClientUpdated);
  // Each dialog's reading outlives its close: Radix re-renders a closing card
  // from live state (CONVENTIONS §7 → "No frame disagrees").
  const editing = useDialogSubject<LogRow>();
  const removing = useDialogSubject<LogRow>();
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const restoreReading = async (row: LogRow) => {
    setRestoringId(row.id);
    try {
      await readingActions.restore(row);
      toast.success("Reading restored");
    } catch (error) {
      toast.error("Restore failed", {
        description: error instanceof Error ? error.message : "Something went wrong",
      });
    } finally {
      setRestoringId(null);
    }
  };

  const metricPaneProps = {
    clientId: client.id,
    focusedMetricId,
    onSelectMetric: setMetric,
    range,
    onRangeChange: setRange,
    showBlocks,
    onToggleBlocks: setShowBlocks,
    onLogFirst: () => setLogOpen(true),
    onEditReading: editing.show,
    onRemoveReading: removing.show,
    onRestoreReading: (row: LogRow) => void restoreReading(row),
    pendingRowId: restoringId,
  };

  return (
    <div>
      <MetricsTopBar
        tab={pane}
        onTabChange={setPane}
        onLogClick={pane === "body" ? () => setLogOpen(true) : undefined}
      />

      {pane === "blocks" ? (
        <BlocksSubtab
          clientId={client.id}
          onTabChange={onTabChange}
        />
      ) : pane === "goals" ? (
        <GoalsPane clientId={client.id} />
      ) : pane === "training" ? (
        <ExerciseDataView clientId={client.id} />
      ) : pane === "wellness" ? (
        <WellnessPane {...metricPaneProps} />
      ) : (
        <PhysiquePane client={client} {...metricPaneProps} />
      )}

      {/* Seeded with one of its own metrics on every pane: a browser Back onto
          Wellness with the dialog open lands it on the physique default. */}
      <LogMeasurementDialog
        open={logOpen}
        onOpenChange={setLogOpen}
        metrics={logMetrics}
        initialMetricId={tab === "body" ? focusedMetricId : DEFAULT_FOCUS.body}
        onSubmit={logMeasurement}
      />
      {/* Keyed by the opening: each open mounts the card fresh on its reading,
          and a close leaves the closing card as it was. */}
      <EditReadingDialog
        key={`edit-reading-${editing.openKey}`}
        open={editing.open}
        row={editing.subject}
        onOpenChange={(open) => {
          if (!open) editing.close();
        }}
        onConfirm={readingActions.update}
      />
      <RemoveReadingDialog
        key={`remove-reading-${removing.openKey}`}
        open={removing.open}
        row={removing.subject}
        clientName={client.name}
        onOpenChange={(open) => {
          if (!open) removing.close();
        }}
        onConfirm={readingActions.remove}
      />
    </div>
  );
};
