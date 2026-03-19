"use client";

import { useState } from "react";
import { Loader2, Settings2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HabitEmptyState } from "./habit-empty-state";
import { HabitsManageDrawer } from "./habits-manage-drawer";
import { useClientHabits } from "@/hooks/use-client-habits";
import type { Client } from "@/types/check-in";

type HabitsTabContentProps = {
  client: Client;
  onUpdate?: () => void;
};

export const HabitsTabContent = ({ client }: HabitsTabContentProps) => {
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
          habits={habits}
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
      <div className="flex items-center justify-end">
        <Button onClick={() => setDrawerOpen(true)} variant="outline" size="sm">
          <Settings2 className="h-4 w-4 mr-2" />
          Manage Habits
        </Button>
      </div>
      <HabitsManageDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        habits={habits}
        onCreateHabit={createHabit}
        onUpdateHabit={updateHabit}
        onDeleteHabit={deleteHabit}
        onReactivateHabit={reactivateHabit}
        onReorderHabits={reorderHabits}
      />
    </>
  );
};
