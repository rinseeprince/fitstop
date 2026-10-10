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
import { toast } from "sonner";
import { useInvalidateNutritionCalendar } from "@/hooks/use-nutrition-calendar-events";
import { useClearClientOverview } from "@/hooks/use-client-overview";
import { useClearAttentionFeed } from "@/hooks/use-attention-feed";
import { useClearClientGoalHistory } from "@/hooks/use-client-goals";
import { useClearNutritionGoal } from "@/hooks/use-nutrition-goal";
import { paneParamSearch, resolvePaneParam } from "@/lib/client-tabs";
import { useNutritionDrawerTrip } from "@/hooks/use-nutrition-drawer-trip";
import type { Client } from "@/types/check-in";

type NutritionPlanBuilderProps = {
  client: Client;
  onUpdate?: () => void;
};

export function NutritionPlanBuilder({ client, onUpdate }: NutritionPlanBuilderProps) {
  // The plan drawer, and the arrival that can open it (the Overview's "Set
  // nutrition from 19 Oct" and "Regenerate"): the hook consumes ?edit=1 and
  // the day ON ARRIVAL and strips them. The day is handed to the provider below
  // rather than re-read off a URL that no longer carries it.
  const { open: drawerOpen, setOpen: setDrawerOpen, startsOn: tripStartsOn } =
    useNutritionDrawerTrip();
  const searchParams = useSearchParams();
  const router = useRouter();

  // ?nutrition= is OURS alone (Session 7.2) — read unconditionally, so a deep
  // link into a pane resolves on the first render. The legacy shared ?subtab=
  // is the fallback and keeps its tab-match guard: Training wrote it too.
  // resolvePaneParam owns both halves; see its doc for why they differ.
  const subtab =
    resolvePaneParam(searchParams, "nutrition") === "plans" ? "plans" : "data";
  // A pane is a PLACE: it pushes, so Back returns to the pane the coach left.
  const setSubtab = (tab: "data" | "plans") => {
    router.push(
      `?${paneParamSearch(searchParams.toString(), "nutrition", tab)}`,
      { scroll: false }
    );
  };

  return (
    <ErrorBoundary>
      <NutritionBuilderProvider
        client={client}
        onUpdate={onUpdate}
        tripStartsOn={tripStartsOn}
        drawerOpen={drawerOpen}
      >
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

        <NutritionSettingsDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
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
  const invalidateNutritionCalendar = useInvalidateNutritionCalendar();
  const clearGoalHistory = useClearClientGoalHistory();
  const clearClientOverview = useClearClientOverview();
  const clearAttentionFeed = useClearAttentionFeed();
  const clearNutritionGoal = useClearNutritionGoal();
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
      toast.success("Nutrition plan deleted");
      setDeleteOpen(false);
      await invalidateNutritionCalendar(clientId);
      // The goals table reads the plan VERSIONS, so it is wrong the moment this
      // lands (CONVENTIONS §7 — the area that reads what you wrote).
      void clearGoalHistory(clientId);
      void clearClientOverview(clientId);
      void clearAttentionFeed();
      // The versions this ended are what the out-of-date rule judges.
      void clearNutritionGoal(clientId);
      builder.refetchNutrition();
    } catch (error) {
      toast.error("Delete failed", {
        description: error instanceof Error ? error.message : "Failed to delete nutrition plan",
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
