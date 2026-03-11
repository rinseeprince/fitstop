"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { HabitsGrid } from "./habits-grid";
import { HabitEmptyState } from "./habit-empty-state";
import { HabitsManageDrawer } from "./habits-manage-drawer";
import { useClientHabits } from "@/hooks/use-client-habits";
import type { Client } from "@/types/check-in";

type HabitsTabContentProps = {
  client: Client;
  onUpdate?: () => void;
};

export const HabitsTabContent = ({ client, onUpdate }: HabitsTabContentProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedHabitId, setSelectedHabitId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const {
    habits,
    isLoading,
    error,
    createHabit,
    updateHabit,
    deleteHabit,
    reactivateHabit,
    reorderHabits,
  } = useClientHabits(client.id, true);

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

  if (habits.length === 0) {
    return (
      <>
        <Card>
          <CardContent className="pt-6">
            <HabitEmptyState onAddHabit={() => setDrawerOpen(true)} />
          </CardContent>
        </Card>
        <HabitsManageDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
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
        />
      </>
    );
  }

  return (
    <>
      <HabitsGrid
        habits={filteredHabits}
        clientId={client.id}
        selectedHabitId={selectedHabitId}
        onOpenManageDrawer={() => setDrawerOpen(true)}
      />
      <HabitsManageDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
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
      />
    </>
  );
};
