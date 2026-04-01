"use client";

import { useState } from "react";
import useSWR from "swr";
import { Plus, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateRoadmapDialog } from "./create-roadmap-dialog";
import { PhaseCard } from "./phase-card";
import { AddPhaseDialog } from "./add-phase-dialog";
import { RoadmapSummaryStrip } from "./roadmap-summary-strip";
import { Skeleton } from "@/components/ui/skeleton";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { Client } from "@/types/check-in";
import type { Roadmap, Phase } from "@/types/roadmap";

type RoadmapWithPhases = Roadmap & { phases: Phase[] };

type RoadmapResponse = {
  success: boolean;
  data: RoadmapWithPhases;
};

type RoadmapTabContentProps = {
  client: Client;
};

export const RoadmapTabContent = ({ client }: RoadmapTabContentProps) => {
  const [createOpen, setCreateOpen] = useState(false);
  const [addPhaseOpen, setAddPhaseOpen] = useState(false);

  const { data, error, isLoading, mutate } = useSWR<RoadmapResponse>(
    `/api/clients/${client.id}/roadmap`,
    swrFetcher,
    { revalidateOnFocus: false }
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-[72px] w-full rounded-[6px] bg-[rgba(13,148,136,0.04)]" />
        <Skeleton className="h-[52px] w-full rounded-[6px] bg-[rgba(13,148,136,0.04)]" />
        <Skeleton className="h-[52px] w-full rounded-[6px] bg-[rgba(13,148,136,0.04)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-[6px] p-6">
        <div className="flex flex-col items-center justify-center py-12 space-y-3">
          <p className="font-medium text-[#0c1a1e]">Failed to load roadmap</p>
          <p className="text-sm text-[#93b0b4]">
            An error occurred while loading the roadmap.
          </p>
        </div>
      </div>
    );
  }

  // No roadmap exists
  if (!data?.data) {
    return (
      <>
        <div className="bg-white rounded-[6px] p-6">
          <div className="flex flex-col items-center justify-center py-12 space-y-3">
            <Target className="h-8 w-8 text-[#93b0b4]" />
            <p className="font-medium text-[#0c1a1e]">No roadmap yet</p>
            <p className="text-sm text-[#93b0b4]">
              Create a roadmap to plan this client&apos;s training phases and
              goals.
            </p>
            <Button onClick={() => setCreateOpen(true)}>Build Roadmap</Button>
          </div>
        </div>
        <CreateRoadmapDialog
          clientId={client.id}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSuccess={() => mutate()}
        />
      </>
    );
  }

  const roadmap = data.data;
  const phases = roadmap.phases ?? [];
  const hasActivePhase = phases.some((p) => p.status === "active");
  const weightUnit = client.weightUnit || "lbs";

  // Prefer roadmap snapshot (frozen at creation), fall back to client table for pre-migration roadmaps
  const goalWeightDisplay = roadmap.goalWeight ?? client.goalWeight ?? null;

  return (
    <>
      {/* Summary strip */}
      <RoadmapSummaryStrip
        roadmapName={roadmap.name}
        roadmapStatus={roadmap.status}
        startedAt={roadmap.startedAt}
        targetEndDate={roadmap.targetEndDate}
        phases={phases}
        startWeight={client.startingWeight ?? null}
        currentWeight={client.currentWeight ?? null}
        goalWeight={goalWeightDisplay}
        weightUnit={weightUnit}
      />

      {/* Phases */}
      {phases.length === 0 ? (
        <div className="bg-white rounded-[6px] p-6">
          <div className="flex flex-col items-center justify-center py-8 space-y-3">
            <Target className="h-6 w-6 text-[#93b0b4]" />
            <p className="text-sm text-[#93b0b4]">
              No phases added yet. Add your first phase to get started.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddPhaseOpen(true)}
              className="bg-white border-[rgba(13,148,136,0.08)] text-[#5a7d82] hover:text-[#0d9488] hover:border-[#0d9488]"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Phase
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mt-4">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.06em] font-semibold text-[#93b0b4]">
                Phases
              </span>
              <span className="text-[10px] font-semibold bg-[rgba(13,148,136,0.05)] text-[#0d9488] px-1.5 py-0.5 rounded-[6px]">
                {phases.length}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddPhaseOpen(true)}
              className="bg-white border-[rgba(13,148,136,0.08)] text-[#5a7d82] hover:text-[#0d9488] hover:border-[#0d9488]"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Phase
            </Button>
          </div>
          <div className="space-y-2">
            {phases.map((phase, index) => (
              <PhaseCard
                key={phase.id}
                phase={phase}
                clientId={client.id}
                hasActivePhase={hasActivePhase}
                weightUnit={weightUnit}
                onUpdate={() => mutate()}
                defaultExpanded={phase.status === "active"}
                index={index}
              />
            ))}
          </div>
        </>
      )}

      <AddPhaseDialog
        clientId={client.id}
        weightUnit={weightUnit}
        open={addPhaseOpen}
        onOpenChange={setAddPhaseOpen}
        onSuccess={() => mutate()}
      />
    </>
  );
};
