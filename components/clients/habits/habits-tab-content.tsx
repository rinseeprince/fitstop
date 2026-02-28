"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { HabitsSidebar } from "./habits-sidebar";
import { HabitsGrid } from "./habits-grid";
import { useClientHabits } from "@/hooks/use-client-habits";
import type { Client } from "@/types/check-in";

type HabitsTabContentProps = {
  client: Client;
  onUpdate?: () => void;
};

export const HabitsTabContent = ({ client, onUpdate }: HabitsTabContentProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedHabitId, setSelectedHabitId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const {
    habits,
    isLoading,
    error,
    createHabit,
    updateHabit,
    deleteHabit,
    reactivateHabit,
    reorderHabits,
  } = useClientHabits(client.id, showInactive);

  // Filter habits based on search query
  const filteredHabits = searchQuery
    ? habits.filter((h) =>
        h.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : habits;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center py-12 space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading habits...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center py-12 space-y-3">
            <p className="font-medium">Failed to load habits</p>
            <p className="text-sm text-muted-foreground">
              {error.message || "An error occurred while loading habits"}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex gap-6">
      <HabitsSidebar
        habits={filteredHabits}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedHabitId={selectedHabitId}
        onSelectHabit={setSelectedHabitId}
        onCreateHabit={createHabit}
        onUpdateHabit={updateHabit}
        onDeleteHabit={deleteHabit}
        onReactivateHabit={reactivateHabit}
        onReorderHabits={reorderHabits}
        showInactive={showInactive}
        onToggleShowInactive={setShowInactive}
      />
      
      <HabitsGrid
        habits={filteredHabits}
        clientId={client.id}
        selectedHabitId={selectedHabitId}
      />
    </div>
  );
};