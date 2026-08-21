"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { NutritionBuilderProvider, useNutritionBuilderContext } from "@/contexts/nutrition-builder-context";
import { NutritionBuilderRightPanel } from "./nutrition-builder-right-panel";
import { NutritionSettingsDrawer } from "./nutrition-settings-drawer";
import { NutritionHistoryTable } from "../nutrition-history-table";
import { NutritionCalendarView } from "../calendar/nutrition-calendar-view";
import { DeleteNutritionPlanDialog } from "../calendar/delete-nutrition-plan-dialog";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { SegmentedControl } from "@/components/programs/shared/segmented-control";
import { useToast } from "@/hooks/use-toast";
import { useInvalidateNutritionCalendar } from "@/hooks/use-nutrition-calendar-events";
import {
  journeyReturnParams,
  paneParamSearch,
  resolvePaneParam,
  type ClientTab,
} from "@/lib/client-tabs";
import { useJourneyRoundTrip } from "@/hooks/use-journey-round-trip";
import type { Client } from "@/types/check-in";

type NutritionPlanBuilderProps = {
  client: Client;
  onUpdate?: () => void;
  /** The Journey round trip's way back (7.4). Cross-tab navigation must run
   *  through the client page's handler — activeTab is state seeded from ?tab=
   *  at mount only. */
  onTabChange?: (tab: ClientTab, extraParams?: Record<string, string>) => void;
};

export function NutritionPlanBuilder({
  client,
  onUpdate,
  onTabChange,
}: NutritionPlanBuilderProps) {
  // The plan drawer, plus the Journey round trip that can open it (7.4). The
  // hook consumes ?edit=1 & the return target ON ARRIVAL and strips them, and
  // drops the target on any close without a save — so an abandoned trip cannot
  // bounce a later, unrelated save back to Journey.
  const {
    open: drawerOpen,
    setOpen: setDrawerOpen,
    returnBlockId,
  } = useJourneyRoundTrip("edit");
  const searchParams = useSearchParams();
  const router = useRouter();

  // ?nutrition= is OURS alone (Session 7.2) — read unconditionally, so a deep
  // link into a pane resolves on the first render. The legacy shared ?subtab=
  // is the fallback and keeps its tab-match guard: Training wrote it too.
  // resolvePaneParam owns both halves; see its doc for why they differ.
  const subtab =
    resolvePaneParam(searchParams, "nutrition") === "plans" ? "plans" : "data";
  const setSubtab = (tab: "data" | "plans") => {
    router.replace(
      `?${paneParamSearch(searchParams.toString(), "nutrition", tab)}`,
      { scroll: false }
    );
  };

  return (
    <ErrorBoundary>
      <NutritionBuilderProvider client={client} onUpdate={onUpdate}>
        {/* Top content bar */}
        <TopContentBar subtab={subtab} setSubtab={setSubtab} />

        {subtab === "data" ? (
          <div className="space-y-4">
            <NutritionHistoryTable clientId={client.id} />
          </div>
        ) : (
          <div className="space-y-4">
            <ErrorBoundary>
              <NutritionBuilderRightPanel
                onOpenSettings={() => setDrawerOpen(true)}
              />
            </ErrorBoundary>
            <ErrorBoundary>
              <NutritionCalendarMount />
            </ErrorBoundary>
          </div>
        )}

        <NutritionSettingsDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          onSaved={() => {
            // returnBlockId is read from THIS render's closure, so the
            // drawer's own auto-close (which clears it) cannot race the trip.
            if (returnBlockId) {
              onTabChange?.("metrics", journeyReturnParams(returnBlockId));
            }
          }}
        />
      </NutritionBuilderProvider>
    </ErrorBoundary>
  );
}

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

/**
 * Mounts the nutrition calendar (the primary day-by-day surface) by pulling
 * clientId/timezone/burn-toggle from the builder context — the same
 * context-consumer pattern as TopContentBar. Always rendered: with no plan
 * there are no events, so it shows the empty month grid under the hero CTA
 * (the training tab's no-plan pattern), with the Delete-plan trigger hidden.
 */
function NutritionCalendarMount() {
  const builder = useNutritionBuilderContext();
  const { toast } = useToast();
  const invalidateNutritionCalendar = useInvalidateNutritionCalendar();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const clientId = builder.client.id;

  // Mirrors the training panel's owner pattern: the trigger renders in the
  // calendar toolbar's divider, the confirm dialog + delete flow live here.
  const handleDeletePlan = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/nutrition`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to delete nutrition plan");
      }
      toast({ title: "Nutrition plan deleted" });
      setDeleteOpen(false);
      await invalidateNutritionCalendar(clientId);
      builder.refetchNutrition();
    } catch (error) {
      toast({
        title: "Delete failed",
        description:
          error instanceof Error ? error.message : "Failed to delete nutrition plan",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <NutritionCalendarView
        clientId={clientId}
        clientTimezone={builder.client.timezone}
        includeActivityBurn={builder.includeActivityBurn}
        surplusAsCarbs={builder.surplusAsCarbs}
        onUpdate={() => builder.refetchNutrition()}
        onDeletePlan={builder.hasPlan ? () => setDeleteOpen(true) : undefined}
      />
      <DeleteNutritionPlanDialog
        open={deleteOpen}
        isDeleting={isDeleting}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => void handleDeletePlan()}
      />
    </>
  );
}
