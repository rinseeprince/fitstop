"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useNutritionBuilder } from "@/hooks/use-nutrition-builder";
import type { Client } from "@/types/check-in";

type NutritionBuilderContextType = ReturnType<typeof useNutritionBuilder>;

const NutritionBuilderContext = createContext<NutritionBuilderContextType | null>(null);

type NutritionBuilderProviderProps = {
  children: ReactNode;
  client: Client;
  onUpdate?: () => void;
};

export function NutritionBuilderProvider({
  children,
  client,
  onUpdate,
}: NutritionBuilderProviderProps) {
  const builder = useNutritionBuilder({ client, onUpdate });

  return (
    <NutritionBuilderContext.Provider value={builder}>
      {children}
    </NutritionBuilderContext.Provider>
  );
}

export function useNutritionBuilderContext() {
  const context = useContext(NutritionBuilderContext);
  if (!context) {
    throw new Error("useNutritionBuilderContext must be used within NutritionBuilderProvider");
  }
  return context;
}
