"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { TrainingBuilderProvider } from "@/contexts/training-builder-context";
import { TrainingBuilderRightPanel } from "./training-builder-right-panel";
import { TrainingPlanBuilderOverlay } from "./training-plan-builder-overlay";
import { TrainingHistoryTable } from "../training-history-table";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { SegmentedControl } from "@/components/programs/shared/segmented-control";
import {
  journeyReturnParams,
  paneParamSearch,
  resolvePaneParam,
  type ClientTab,
} from "@/lib/client-tabs";
import { useJourneyRoundTrip } from "@/hooks/use-journey-round-trip";
import type { Client } from "@/types/check-in";

type TrainingPlanBuilderProps = {
  client: Client;
  onUpdate?: () => void;
  // Cross-tab navigation must run through the client page's handler: activeTab
  // is state seeded from ?tab= at mount only, so a bare router.replace changes
  // the URL without switching the tab. The history table's exercise drill-down
  // needs it now that Exercise Data lives on the Journey tab (Session 7.1).
  onTabChange?: (
    tab: ClientTab,
    extraParams?: Record<string, string | null>
  ) => void;
};

export function TrainingPlanBuilder({
  client,
  onUpdate,
  onTabChange,
}: TrainingPlanBuilderProps) {
  // The apply tray, plus the Journey round trip that can open it (7.3). The
  // hook consumes ?apply=1 & the return target ON ARRIVAL and strips them, and
  // drops the target on any close without an apply — so an abandoned trip
  // cannot bounce a later, unrelated apply back to Journey.
  const {
    open: drawerOpen,
    setOpen: setDrawerOpen,
    returnBlockId,
  } = useJourneyRoundTrip("apply");
  const searchParams = useSearchParams();
  const router = useRouter();

  // ?training= is OURS alone (Session 7.2) — read unconditionally, so a deep
  // link into a pane resolves on the first render. The legacy shared ?subtab=
  // is the fallback and keeps its tab-match guard: Nutrition wrote it too.
  // resolvePaneParam owns both halves; see its doc for why they differ.
  const rawSubtab = resolvePaneParam(searchParams, "training");
  const subtab: "data" | "plans" = rawSubtab === "plans" ? "plans" : "data";
  const setSubtab = (tab: "data" | "plans") => {
    router.replace(
      `?${paneParamSearch(searchParams.toString(), "training", tab)}`,
      { scroll: false }
    );
  };

  return (
    <ErrorBoundary>
      <TrainingBuilderProvider clientId={client.id} onUpdate={onUpdate}>
        <TopContentBar subtab={subtab} setSubtab={setSubtab} />

        {subtab === "data" ? (
          <div className="space-y-4">
            <TrainingHistoryTable
              clientId={client.id}
              onTabChange={onTabChange}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <ErrorBoundary>
              <TrainingBuilderRightPanel
                clientId={client.id}
                clientName={client.name}
                onOpenGenerator={() => setDrawerOpen(true)}
              />
            </ErrorBoundary>
          </div>
        )}

        <TrainingPlanBuilderOverlay
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          clientName={client.name}
          onApplied={() => {
            // returnBlockId is read from THIS render's closure, so the
            // overlay's own close (which clears it) cannot race the trip.
            if (returnBlockId) {
              onTabChange?.("metrics", journeyReturnParams(returnBlockId));
            }
          }}
        />
      </TrainingBuilderProvider>
    </ErrorBoundary>
  );
}

// Slim subtab bar: the shared segmented control. Two panes since Session 7.1 —
// Exercise Data moved to the Journey tab, so analytics live there and
// prescription lives here. The Plans surface owns its own actions — Apply
// program lives on the hero, View/Edit + Delete-future in the calendar toolbar.
function TopContentBar({
  subtab,
  setSubtab,
}: {
  subtab: "data" | "plans";
  setSubtab: (tab: "data" | "plans") => void;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-4">
      <SegmentedControl
        options={[
          { value: "data", label: "Data" },
          { value: "plans", label: "Plans" },
        ]}
        value={subtab}
        onChange={(value) => setSubtab(value as "data" | "plans")}
      />
    </div>
  );
}
