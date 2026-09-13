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
import { useCoachBack } from "@/hooks/use-coach-back";
import type { Client } from "@/types/check-in";

type TrainingPlanBuilderProps = {
  client: Client;
  // Cross-tab navigation runs through the client page's handler: it is the one
  // builder of a tab URL (the carried single-owner params, the stripped
  // ?subtab=) and it pushes a history entry for the tab change. The history
  // table's exercise drill-down needs it now that Exercise Data lives on the
  // Journey tab (Session 7.1).
  onTabChange?: (
    tab: ClientTab,
    extraParams?: Record<string, string | null>,
    options?: { replace?: boolean }
  ) => void;
};

export function TrainingPlanBuilder({
  client,
  onTabChange,
}: TrainingPlanBuilderProps) {
  // The apply tray, plus the Journey round trip that can open it (7.3). The
  // hook consumes ?apply=1 & the return target ON ARRIVAL and strips them, and
  // drops the target on any close without an apply — so an abandoned trip
  // cannot bounce a later, unrelated apply back to Journey. The block it names
  // is also the one the apply dialog's Block field preselects, so it is handed
  // down the overlay rather than re-read off a URL that no longer carries it.
  const {
    open: drawerOpen,
    setOpen: setDrawerOpen,
    hide: hideDrawer,
    show: showDrawer,
    returnBlockId,
  } = useJourneyRoundTrip("apply");
  const searchParams = useSearchParams();
  const router = useRouter();

  // The client editor is a PLACE: `?editor=<savedPlanId>` is this tab's second
  // single-owner param, read unconditionally. Picking a template in the tray
  // hides the tray and pushes it, so browser Back closes the editor onto the
  // calendar; the editor's own arrow shows the tray again and pops the entry,
  // so it lands on the list; a pasted address falls back to a replace.
  const editorPlanId = searchParams.get("editor");
  const openEditor = (savedPlanId: string) => {
    hideDrawer();
    const params = new URLSearchParams(searchParams.toString());
    params.set("editor", savedPlanId);
    router.push(`?${params.toString()}`, { scroll: false });
  };
  const closeEditor = useCoachBack(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("editor");
    router.replace(`?${params.toString()}`, { scroll: false });
  });
  const exitEditorToList = () => {
    showDrawer();
    closeEditor();
  };

  // ?training= is OURS alone (Session 7.2) — read unconditionally, so a deep
  // link into a pane resolves on the first render. The legacy shared ?subtab=
  // is the fallback and keeps its tab-match guard: Nutrition wrote it too.
  // resolvePaneParam owns both halves; see its doc for why they differ.
  const rawSubtab = resolvePaneParam(searchParams, "training");
  const subtab: "data" | "plans" = rawSubtab === "plans" ? "plans" : "data";
  // A pane is a PLACE: it pushes, so Back returns to the pane the coach left.
  const setSubtab = (tab: "data" | "plans") => {
    router.push(
      `?${paneParamSearch(searchParams.toString(), "training", tab)}`,
      { scroll: false }
    );
  };

  return (
    <ErrorBoundary>
      <TrainingBuilderProvider clientId={client.id}>
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
          editorPlanId={editorPlanId}
          onPick={openEditor}
          onExitEditor={exitEditorToList}
          clientName={client.name}
          preselectedBlockId={returnBlockId}
          onApplied={() => {
            // returnBlockId is read from THIS render's closure, so the tray's
            // close (which clears it) cannot race the trip. The editor's entry
            // is completed, never left behind Back: with a trip it BECOMES the
            // Journey entry, without one it is popped onto the calendar.
            setDrawerOpen(false);
            if (returnBlockId) {
              onTabChange?.("metrics", journeyReturnParams(returnBlockId), {
                replace: true,
              });
            } else {
              closeEditor();
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
