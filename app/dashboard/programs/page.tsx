"use client";

import { useRouter } from "next/navigation";
import { LayoutGrid, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSavedPlans } from "@/hooks/use-saved-plans";
import { ProgramCard } from "@/components/clients/training/program-builder/program-card";

// The Programs library page (absorbs the old /dashboard/training-library).
// Browse + delete only — creation lives in the section topbar ("New
// program"), a program is edited on its own builder page, and assignment to
// a client happens from that client's training planner (Phase 5), so there
// is no apply-to-client affordance anywhere on this surface.
export default function ProgramsPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { plans, isLoading, mutate } = useSavedPlans();

  const savedPlans = plans.filter((p) => p.status === "saved");

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-[#93b0b4]" />
      </div>
    );
  }

  if (savedPlans.length === 0) {
    return (
      <div className="py-12 text-center text-[#5a7d82]">
        <LayoutGrid className="mx-auto mb-2 h-8 w-8 opacity-50" strokeWidth={1.5} />
        <p className="text-sm">No programs yet</p>
        <p className="mt-1 text-xs text-[#93b0b4]">
          Create a program and build it week by week
        </p>
      </div>
    );
  }

  return (
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
  );
}
