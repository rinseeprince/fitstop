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
import { useToast } from "@/hooks/use-toast";
import { useInvalidateNutritionCalendar } from "@/hooks/use-nutrition-calendar-events";
import { cn } from "@/lib/utils";
import type { Client } from "@/types/check-in";

type NutritionPlanBuilderProps = {
  client: Client;
  onUpdate?: () => void;
};

export function NutritionPlanBuilder({ client, onUpdate }: NutritionPlanBuilderProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();

  // Honor `subtab` only when the URL's `tab` is actually ours: on a tab switch
  // the visible tab flips (local state on the client page) before
  // router.replace lands, so a stale `subtab=plans` written by the TRAINING
  // tab would otherwise flash the Plans calendar here before Data renders.
  const subtab =
    searchParams.get("tab") === "nutrition" && searchParams.get("subtab") === "plans"
      ? "plans"
      : "data";
  const setSubtab = (tab: "data" | "plans") => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("subtab", tab);
    router.replace(`?${params.toString()}`, { scroll: false });
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
    <div className="flex items-center gap-4 mb-5">
      {/* Segmented control */}
      <div className="bg-[rgba(13,148,136,0.05)] rounded-[6px] p-[2px] inline-flex">
        {(["data", "plans"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setSubtab(tab)}
            className={cn(
              "px-4 py-1.5 text-[12.5px] font-medium rounded-[4px] transition-all",
              subtab === tab
                ? "bg-white text-[#0c1a1e] shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
                : "text-[#5a7d82] hover:text-[#0c1a1e]"
            )}
          >
            {tab === "data" ? "Data" : "Plans"}
          </button>
        ))}
      </div>
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
