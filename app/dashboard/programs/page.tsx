"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dumbbell, LayoutGrid, Loader2, Plus } from "lucide-react";
import { AppLayout } from "@/components/app-layout";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useSavedPlans } from "@/hooks/use-saved-plans";
import { ProgramCard } from "@/components/clients/training/program-builder/program-card";
import { DAYS_PER_WEEK } from "@/components/clients/training/program-builder/program-builder-types";

// The Programs library page (absorbs the old /dashboard/training-library).
// Browse + create + delete only — a program is edited on its own builder page
// and assigned to a client from that client's training planner (Phase 5), so
// there is no apply-to-client affordance anywhere on this surface.
export default function ProgramsPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { plans, isLoading, mutate } = useSavedPlans();
  const [isCreating, setIsCreating] = useState(false);

  const savedPlans = plans.filter((p) => p.status === "saved");

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      // A new program starts as one week of 7 rest days (empty === rest). The
      // create schema can't express weeks/set specs — the builder writes the
      // real structure through /overwrite on Save program.
      const res = await fetch("/api/training/saved-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Untitled program",
          splitType: "custom",
          sessions: Array.from({ length: DAYS_PER_WEEK }, () => ({
            name: "Rest",
            isRest: true,
            exercises: [],
          })),
        }),
      });
      const data = (await res.json()) as { planId?: string; error?: string };
      if (!res.ok || !data.planId) {
        throw new Error(data.error ?? "Failed to create program");
      }
      router.push(`/dashboard/programs/${data.planId}`);
    } catch {
      toast({
        title: "Error",
        description: "Failed to create program",
        variant: "destructive",
      });
      setIsCreating(false);
    }
  };

  const handleDelete = async (planId: string) => {
    try {
      const res = await fetch(`/api/training/saved-plans/${planId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");
      toast({ title: "Program deleted" });
      await mutate();
    } catch {
      toast({
        title: "Error",
        description: "Failed to delete program",
        variant: "destructive",
      });
    }
  };

  return (
    <AppLayout
      pageHeader={
        <PageHeader
          title="Programs"
          description="Reusable multi-week training programs"
        />
      }
      headerActions={
        <Button
          onClick={() => void handleCreate()}
          disabled={isCreating}
          className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
        >
          {isCreating ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-1.5 h-4 w-4" strokeWidth={1.5} />
          )}
          New program
        </Button>
      }
    >
      <Tabs defaultValue="plans">
        <TabsList>
          <TabsTrigger value="plans">
            <LayoutGrid className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} /> Programs
          </TabsTrigger>
          <TabsTrigger value="sessions">
            <Dumbbell className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} /> Sessions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="plans" className="mt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-[#93b0b4]" />
            </div>
          ) : savedPlans.length === 0 ? (
            <div className="py-12 text-center text-[#5a7d82]">
              <LayoutGrid className="mx-auto mb-2 h-8 w-8 opacity-50" strokeWidth={1.5} />
              <p className="text-sm">No programs yet</p>
              <p className="mt-1 text-xs text-[#93b0b4]">
                Create a program and build it week by week
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {savedPlans.map((plan) => (
                <ProgramCard
                  key={plan.id}
                  plan={plan}
                  onOpen={() => router.push(`/dashboard/programs/${plan.id}`)}
                  onDelete={() => void handleDelete(plan.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="sessions" className="mt-4">
          {/* Standalone saved sessions surface lands in Phase 3. */}
          <div className="py-12 text-center text-[#5a7d82]">
            <Dumbbell className="mx-auto mb-2 h-8 w-8 opacity-50" strokeWidth={1.5} />
            <p className="text-sm">Standalone sessions coming soon</p>
          </div>
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}
