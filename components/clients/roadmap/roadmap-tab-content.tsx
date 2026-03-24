"use client";

import { useState } from "react";
import useSWR from "swr";
import { Loader2, Plus, Target, Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CreateRoadmapDialog } from "./create-roadmap-dialog";
import { PhaseCard } from "./phase-card";
import { AddPhaseDialog } from "./add-phase-dialog";
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

  const is404 =
    error && "status" in error && (error as { status: number }).status === 404;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center py-12 space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading roadmap...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error && !is404) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center py-12 space-y-3">
            <p className="font-medium">Failed to load roadmap</p>
            <p className="text-sm text-muted-foreground">
              An error occurred while loading the roadmap.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // No roadmap exists
  if (is404 || !data?.data) {
    return (
      <>
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
              <Target className="w-12 h-12 text-muted-foreground" />
              <p className="font-medium">No roadmap yet</p>
              <p className="text-sm text-muted-foreground">
                Create a roadmap to plan this client&apos;s training phases and
                goals.
              </p>
              <Button onClick={() => setCreateOpen(true)}>Build Roadmap</Button>
            </div>
          </CardContent>
        </Card>
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

  return (
    <>
      {/* Roadmap Header */}
      <Card>
        <CardHeader>
          <CardTitle>{roadmap.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {roadmap.longTermGoal && (
            <p className="text-sm text-muted-foreground">
              {roadmap.longTermGoal}
            </p>
          )}
          {(roadmap.startedAt || roadmap.targetEndDate) && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>
                {roadmap.startedAt && roadmap.startedAt}
                {roadmap.startedAt && roadmap.targetEndDate && " → "}
                {roadmap.targetEndDate && roadmap.targetEndDate}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Phases */}
      {phases.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center py-8 space-y-3">
              <p className="text-sm text-muted-foreground">
                No phases added yet. Add your first phase to get started.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAddPhaseOpen(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Phase
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground">
              Phases ({phases.length})
            </h3>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddPhaseOpen(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Phase
            </Button>
          </div>
          <div className="space-y-3">
            {phases.map((phase) => (
              <PhaseCard
                key={phase.id}
                phase={phase}
                clientId={client.id}
                hasActivePhase={hasActivePhase}
                onUpdate={() => mutate()}
              />
            ))}
          </div>
        </>
      )}

      <AddPhaseDialog
        clientId={client.id}
        open={addPhaseOpen}
        onOpenChange={setAddPhaseOpen}
        onSuccess={() => mutate()}
      />
    </>
  );
};
