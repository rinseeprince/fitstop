"use client";

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Plus } from "lucide-react";
import { HabitListItem } from "./habit-list-item";
import { AddHabitDialog } from "./add-habit-dialog";
import type { DailyHabit, DailyHabitInput } from "@/types/daily-habit";
import type { HabitStats } from "@/services/daily-habits-stats";

interface HabitWithStats extends DailyHabit {
  stats?: HabitStats;
}

type HabitsManageDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  habits: HabitWithStats[];
  onCreateHabit: (data: DailyHabitInput) => Promise<DailyHabit | undefined>;
  onUpdateHabit: (habitId: string, data: Partial<DailyHabitInput>) => Promise<DailyHabit | undefined>;
  onDeleteHabit: (habitId: string) => Promise<void>;
  onReactivateHabit?: (habitId: string) => Promise<DailyHabit | undefined>;
  onReorderHabits: (habitIds: string[]) => Promise<void>;
};

export function HabitsManageDrawer({
  open,
  onOpenChange,
  habits,
  onCreateHabit,
  onUpdateHabit,
  onDeleteHabit,
  onReactivateHabit,
  onReorderHabits,
}: HabitsManageDrawerProps) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredHabits = searchQuery
    ? habits.filter((h) =>
        h.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : habits;

  const handleMoveUp = async (habitId: string) => {
    const currentIndex = filteredHabits.findIndex((h) => h.id === habitId);
    if (currentIndex <= 0) return;

    const newOrder = [...filteredHabits];
    [newOrder[currentIndex - 1], newOrder[currentIndex]] = [
      newOrder[currentIndex],
      newOrder[currentIndex - 1],
    ];

    await onReorderHabits(newOrder.map((h) => h.id));
  };

  const handleMoveDown = async (habitId: string) => {
    const currentIndex = filteredHabits.findIndex((h) => h.id === habitId);
    if (currentIndex === -1 || currentIndex >= filteredHabits.length - 1) return;

    const newOrder = [...filteredHabits];
    [newOrder[currentIndex], newOrder[currentIndex + 1]] = [
      newOrder[currentIndex + 1],
      newOrder[currentIndex],
    ];

    await onReorderHabits(newOrder.map((h) => h.id));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="!inset-y-auto !h-auto !right-4 !top-4 !bottom-4 max-h-[calc(100vh-2rem)] w-[420px] rounded-lg border border-border shadow-md p-5 flex flex-col bg-card"
      >
        <SheetHeader className="pb-4 border-b border-border px-0">
          <SheetTitle className="text-lg font-semibold">
            Manage Habits
          </SheetTitle>
        </SheetHeader>

        <div className="pt-5 flex-1 overflow-y-auto px-0.5 space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search habits..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Add Habit Button */}
          <Button
            onClick={() => setIsAddDialogOpen(true)}
            className="w-full"
            size="sm"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Habit
          </Button>

          {/* Habits List */}
          {filteredHabits.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">
                {searchQuery ? "No habits match your search" : "No habits yet. Add one above to get started."}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredHabits.map((habit, index) => (
                <HabitListItem
                  key={habit.id}
                  habit={habit}
                  isSelected={false}
                  isEditing={habit.id === editingHabitId}
                  canMoveUp={habit.isActive && index > 0}
                  canMoveDown={habit.isActive && index < filteredHabits.length - 1}
                  onClick={() => undefined}
                  onEdit={() => setEditingHabitId(habit.id)}
                  onCancelEdit={() => setEditingHabitId(null)}
                  onSaveEdit={async (data) => {
                    await onUpdateHabit(habit.id, data);
                    setEditingHabitId(null);
                  }}
                  onDelete={() => onDeleteHabit(habit.id)}
                  onReactivate={onReactivateHabit ? () => onReactivateHabit(habit.id) : undefined}
                  onMoveUp={() => handleMoveUp(habit.id)}
                  onMoveDown={() => handleMoveDown(habit.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Add Habit Dialog */}
        <AddHabitDialog
          open={isAddDialogOpen}
          onOpenChange={setIsAddDialogOpen}
          onSubmit={async (data) => {
            await onCreateHabit(data);
            setIsAddDialogOpen(false);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
