"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useTrainingPlan } from "@/hooks/use-training-plan";

// Read-only: supplies the client's active training plan to the Training tab.
// Authoring state lives in `ProgramDraftProvider` — do not add authoring here.
type TrainingBuilderContextType = ReturnType<typeof useTrainingPlan> & {
  editMode: boolean;
  setEditMode: (v: boolean) => void;
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

  return (
    <TrainingBuilderContext.Provider value={{ ...builder, editMode, setEditMode }}>
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
