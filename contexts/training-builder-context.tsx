"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useTrainingBuilder } from "@/hooks/use-training-builder";

type TrainingBuilderContextType = ReturnType<typeof useTrainingBuilder>;

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
  const builder = useTrainingBuilder({ clientId, onUpdate });

  return (
    <TrainingBuilderContext.Provider value={builder}>
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
