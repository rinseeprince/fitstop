"use client";

import { useState } from "react";
import useSWR from "swr";
import { Plus, Target, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { CreateRoadmapDialog } from "./create-roadmap-dialog";
import { PhaseCard } from "./phase-card";
import { AddPhaseDialog } from "./add-phase-dialog";
import { RoadmapSummaryStrip } from "./roadmap-summary-strip";
import { PastRoadmapsSection } from "./past-roadmaps-section";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  COUNT_CHIP_CLASS,
  SECTION_LABEL_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { swrFetcher } from "@/lib/swr-fetcher";
import { useToast } from "@/hooks/use-toast";
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
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [addPhaseOpen, setAddPhaseOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [isEnding, setIsEnding] = useState(false);

  const { data, error, isLoading, mutate } = useSWR<RoadmapResponse>(
    `/api/clients/${client.id}/roadmap`,
    swrFetcher,
    { revalidateOnFocus: false }
  );

  // End-and-replace: archive the active roadmap (which atomically closes its
  // active+planned phases server-side), then open the create dialog.
  const handleEndRoadmap = async () => {
    setIsEnding(true);
    try {
      const res = await fetch(`/api/clients/${client.id}/roadmap/archive`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to end roadmap");
      }
      toast({ title: "Roadmap ended" });
      setEndOpen(false);
      await mutate();
      setCreateOpen(true);
    } catch (err) {
      toast({
        title: "Error",
        description:
          err instanceof Error ? err.message : "Failed to end roadmap",
        variant: "destructive",
      });
    } finally {
      setIsEnding(false);
    }
  };

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
        <PastRoadmapsSection
          clientId={client.id}
          weightUnit={client.weightUnit || "lbs"}
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

  const endRoadmapButton = (
    <AlertDialog open={endOpen} onOpenChange={setEndOpen}>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          className={cn(SECTION_LABEL_CLASS, "hover:text-[#c06060] transition-colors whitespace-nowrap")}
        >
          End roadmap
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>End this roadmap?</AlertDialogTitle>
          <AlertDialogDescription>
            This archives &ldquo;{roadmap.name}&rdquo; and ends its current
            phase. You can build a new roadmap next.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isEnding}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void handleEndRoadmap();
            }}
            disabled={isEnding}
          >
            {isEnding ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "End roadmap"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return (
    <>
      {/* With no phases there's no action row below, so keep End roadmap top-right */}
      {phases.length === 0 && (
        <div className="flex items-center justify-end">{endRoadmapButton}</div>
      )}

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
          {/* Section divider header (matches the WELLNESS LOG / TRAINING LOG style):
              label · count · line · minimal text actions, End roadmap rightmost.
              mb-3 = the divider spec's 12px to the content below. */}
          <div className="flex min-h-[24.5px] items-center gap-3 mt-4 mb-3">
            <span className={cn(SECTION_LABEL_CLASS, "whitespace-nowrap")}>
              Phases
            </span>
            <span className={COUNT_CHIP_CLASS}>
              {phases.length}
            </span>
            <div className="flex-1 h-px bg-[rgba(13,148,136,0.08)]" />
            <div className="flex items-center gap-3 whitespace-nowrap">
              <button
                type="button"
                onClick={() => setAddPhaseOpen(true)}
                className={cn(SECTION_LABEL_CLASS, "hover:text-[#0d9488] transition-colors")}
              >
                Add phase
              </button>
              {endRoadmapButton}
            </div>
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

      {/* Mounted here too so it can open right after ending the roadmap */}
      <CreateRoadmapDialog
        clientId={client.id}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={() => mutate()}
      />

      <PastRoadmapsSection clientId={client.id} weightUnit={weightUnit} />
    </>
  );
};
