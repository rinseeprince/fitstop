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
import { useJourneyReturnBlock } from "@/hooks/use-journey-round-trip";
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
  const searchParams = useSearchParams();
  const router = useRouter();

  // The apply surface has ONE owner, the address (CONVENTIONS §7 → "No frame
  // disagrees"). The tray is a place, `?apply=1`, and the client editor is a
  // place, `?editor=<savedPlanId>`; both are read unconditionally, and every
  // transition is one router call. "Apply program" PUSHES the tray, so Back
  // closes it; a pick REPLACES the tray's entry with the editor's, so Back out
  // of the editor lands on the calendar with no tray; the editor's arrow
  // replaces back to the list; the X pops the tray's entry, or replaces the
  // param away on a pasted address; an apply pops the editor's entry, or
  // completes it as the Journey return when a round trip is alive.
  const trayOpen = searchParams.get("apply") === "1";
  const editorPlanId = searchParams.get("editor");
  // The Journey round trip's return target, captured on arrival (7.3): the
  // block the apply dialog's Block field preselects, and where an apply lands.
  // Cleared by the X and by a hand open, so an abandoned trip cannot bounce a
  // later, unrelated apply back to Journey.
  const { returnBlockId, clearReturnBlock } = useJourneyReturnBlock("apply");

  const openTray = () => {
    clearReturnBlock();
    const params = new URLSearchParams(searchParams.toString());
    params.set("apply", "1");
    router.push(`?${params.toString()}`, { scroll: false });
  };
  const closeTrayEntry = useCoachBack(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("apply");
    router.replace(`?${params.toString()}`, { scroll: false });
  });
  const closeTray = () => {
    clearReturnBlock();
    closeTrayEntry();
  };
  const openEditor = (savedPlanId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("apply");
    params.set("editor", savedPlanId);
    router.replace(`?${params.toString()}`, { scroll: false });
  };
  const exitEditorToList = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("editor");
    params.set("apply", "1");
    router.replace(`?${params.toString()}`, { scroll: false });
  };
  const closeEditor = useCoachBack(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("editor");
    router.replace(`?${params.toString()}`, { scroll: false });
  });

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
                onOpenGenerator={openTray}
              />
            </ErrorBoundary>
          </div>
        )}

        <TrainingPlanBuilderOverlay
          trayOpen={trayOpen}
          editorPlanId={editorPlanId}
          onCloseTray={closeTray}
          onPick={openEditor}
          onExitEditor={exitEditorToList}
          clientName={client.name}
          preselectedBlockId={returnBlockId}
          onApplied={() => {
            // The editor's entry is completed, never left behind Back: with a
            // trip it BECOMES the Journey entry (the tab change unmounts this
            // surface), without one it is popped onto the calendar.
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
