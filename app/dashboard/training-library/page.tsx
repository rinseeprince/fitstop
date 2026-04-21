"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Dumbbell, LayoutGrid, Loader2, Trash2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useSavedPlans } from "@/hooks/use-saved-plans";
import { PlanPreviewDrawer } from "@/components/clients/training/library/plan-preview-drawer";
import { ApplyToClientDialog } from "@/components/training-library/apply-to-client-dialog";
import type { SavedPlan } from "@/types/training";

export default function TrainingLibraryPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { plans, isLoading, mutate } = useSavedPlans();
  const [previewPlanId, setPreviewPlanId] = useState<string | null>(null);
  const [applyPlan, setApplyPlan] = useState<SavedPlan | null>(null);

  const savedPlans = plans.filter((p) => p.status === "saved");

  const handleDelete = async (planId: string) => {
    try {
      const res = await fetch(`/api/training/saved-plans/${planId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      toast({ title: "Plan deleted" });
      await mutate();
    } catch {
      toast({ title: "Error", description: "Failed to delete plan", variant: "destructive" });
    }
  };

  return (
    <div className="max-w-5xl mx-auto py-6 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Training Library</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Saved plans and sessions for quick deployment
          </p>
        </div>
      </div>

      <Tabs defaultValue="plans">
        <TabsList>
          <TabsTrigger value="plans">
            <LayoutGrid className="h-3.5 w-3.5 mr-1.5" /> Plans
          </TabsTrigger>
          <TabsTrigger value="sessions">
            <Dumbbell className="h-3.5 w-3.5 mr-1.5" /> Sessions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="plans" className="mt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : savedPlans.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <LayoutGrid className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No saved plans yet</p>
              <p className="text-xs mt-1">
                Generate a training plan and save it to your library
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {savedPlans.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  onClick={() => setPreviewPlanId(plan.id)}
                  onDelete={() => void handleDelete(plan.id)}
                  onApply={() => setApplyPlan(plan)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="sessions" className="mt-4">
          <div className="text-center py-12 text-muted-foreground">
            <Dumbbell className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Standalone sessions coming soon</p>
          </div>
        </TabsContent>
      </Tabs>

      {previewPlanId && (
        <PlanPreviewDrawer
          savedPlanId={previewPlanId}
          open={!!previewPlanId}
          onOpenChange={(open) => {
            if (!open) setPreviewPlanId(null);
          }}
          onDiscard={() => {
            setPreviewPlanId(null);
            void mutate();
          }}
          onApplySuccess={() => {
            // Refresh the list so any applied-count / derived info is current,
            // but keep the drawer open — the coach may apply to another client.
            void mutate();
          }}
        />
      )}

      {applyPlan && (
        <ApplyToClientDialog
          open={!!applyPlan}
          onOpenChange={(open) => { if (!open) setApplyPlan(null); }}
          savedPlan={applyPlan}
          onSuccess={(clientId) => {
            router.push(`/clients/${clientId}?tab=training`);
          }}
        />
      )}
    </div>
  );
}

function PlanCard({
  plan,
  onClick,
  onDelete,
  onApply,
}: {
  plan: SavedPlan;
  onClick: () => void;
  onDelete: () => void;
  onApply: () => void;
}) {
  const sessionCount = plan.sessions?.length ?? 0;
  const trainingCount = plan.sessions?.filter((s) => !s.isRest).length ?? 0;

  return (
    <div
      className="bg-card rounded-lg border p-4 hover:shadow-md transition-shadow cursor-pointer group"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-sm font-semibold text-foreground line-clamp-1">
          {plan.name}
        </h3>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 -mr-1 -mt-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => { e.stopPropagation(); onApply(); }}
          >
            <Calendar className="h-3 w-3 text-teal-600" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            <Trash2 className="h-3 w-3 text-destructive" />
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {plan.splitType && (
          <Badge variant="outline" className="text-[10px]">
            {plan.splitType.replace(/_/g, " ")}
          </Badge>
        )}
        <Badge variant="secondary" className="text-[10px]">
          {trainingCount} sessions
        </Badge>
        {plan.cycleLength && (
          <Badge variant="secondary" className="text-[10px]">
            {plan.cycleLength}-day cycle
          </Badge>
        )}
        {plan.source && (
          <Badge variant="outline" className="text-[10px]">
            {plan.source}
          </Badge>
        )}
      </div>
      {plan.description && (
        <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
          {plan.description}
        </p>
      )}
      <div className="text-[10px] text-muted-foreground mt-2">
        {sessionCount} total ({trainingCount} training + {sessionCount - trainingCount} rest)
      </div>
    </div>
  );
}
