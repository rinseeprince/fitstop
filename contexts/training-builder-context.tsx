"use client";

import { createContext, useContext, useState, useMemo, type ReactNode } from "react";
import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import { useTrainingPlan } from "@/hooks/use-training-plan";
import type { Phase } from "@/types/roadmap";

// Read-only: supplies the client's active training plan to the Training tab.
// Authoring state lives in `ProgramDraftProvider` — do not add authoring here.
type TrainingBuilderContextType = ReturnType<typeof useTrainingPlan> & {
  editMode: boolean;
  setEditMode: (v: boolean) => void;
  activePhase: Phase | null;
  phases: Phase[];
};

const TrainingBuilderContext = createContext<TrainingBuilderContextType | null>(null);

type TrainingBuilderProviderProps = {
  children: ReactNode;
  clientId: string;
  onUpdate?: () => void;
};

export function TrainingBuilderProvider({
  children,
  clientId,
  onUpdate,
}: TrainingBuilderProviderProps) {
  const builder = useTrainingPlan({ clientId, onUpdate });
  const [editMode, setEditMode] = useState(false);

  // Fetch phases (same pattern as nutrition builder)
  const { data: phasesData } = useSWR<{ success: true; data: Phase[] }>(
    clientId ? `/api/clients/${clientId}/roadmap/phases` : null,
    swrFetcher,
    { revalidateOnFocus: false }
  );

  const phases = useMemo(() => phasesData?.data ?? [], [phasesData]);

  const activePhase = useMemo(
    () => phases.find((p) => p.status === "active") ?? null,
    [phases]
  );

  return (
    <TrainingBuilderContext.Provider value={{ ...builder, editMode, setEditMode, activePhase, phases }}>
      {children}
    </TrainingBuilderContext.Provider>
  );
}

export function useTrainingBuilderContext() {
  const context = useContext(TrainingBuilderContext);
  if (!context) {
    throw new Error("useTrainingBuilderContext must be used within TrainingBuilderProvider");
  }
  return context;
}
