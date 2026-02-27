"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Plus } from "lucide-react";
import { HabitListItem } from "./habit-list-item";
import { AddHabitDialog } from "./add-habit-dialog";
import { HabitEmptyState } from "./habit-empty-state";
import type { DailyHabit, DailyHabitInput } from "@/types/daily-habit";
import type { HabitStats } from "@/services/daily-habits-stats";

interface HabitWithStats extends DailyHabit {
  stats?: HabitStats;
}

type HabitsSidebarProps = {
  habits: HabitWithStats[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedHabitId: string | null;
  onSelectHabit: (id: string) => void;
  onCreateHabit: (data: DailyHabitInput) => Promise<DailyHabit | undefined>;
  onUpdateHabit: (habitId: string, data: Partial<DailyHabitInput>) => Promise<DailyHabit | undefined>;
  onDeleteHabit: (habitId: string) => Promise<void>;
  onReorderHabits: (habitIds: string[]) => Promise<void>;
};

export const HabitsSidebar = ({
  habits,
  searchQuery,
  onSearchChange,
  selectedHabitId,
  onSelectHabit,
  onCreateHabit,
  onUpdateHabit,
  onDeleteHabit,
  onReorderHabits,
}: HabitsSidebarProps) => {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null);

  const handleMoveUp = async (habitId: string) => {
    const currentIndex = habits.findIndex((h) => h.id === habitId);
    if (currentIndex <= 0) return;

    const newOrder = [...habits];
    [newOrder[currentIndex - 1], newOrder[currentIndex]] = [
      newOrder[currentIndex],
      newOrder[currentIndex - 1],
    ];

    await onReorderHabits(newOrder.map((h) => h.id));
  };

  const handleMoveDown = async (habitId: string) => {
    const currentIndex = habits.findIndex((h) => h.id === habitId);
    if (currentIndex === -1 || currentIndex >= habits.length - 1) return;

    const newOrder = [...habits];
    [newOrder[currentIndex], newOrder[currentIndex + 1]] = [
      newOrder[currentIndex + 1],
      newOrder[currentIndex],
    ];

    await onReorderHabits(newOrder.map((h) => h.id));
  };

  return (
    <div className="w-[320px] flex flex-col rounded-lg bg-card shadow-sm border">
      {/* Only show header with search and add button when habits exist */}
      {habits.length > 0 && (
        <div className="p-4 border-b space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search habits..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
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
        </div>
      )}

      {/* Habits List */}
      <ScrollArea className="flex-1 max-h-[500px]">
        <div className="p-2">
          {habits.length === 0 ? (
            <HabitEmptyState onAddHabit={() => setIsAddDialogOpen(true)} />
          ) : (
            <div className="space-y-1">
              {habits.map((habit, index) => (
                <HabitListItem
                  key={habit.id}
                  habit={habit}
                  isSelected={habit.id === selectedHabitId}
                  isEditing={habit.id === editingHabitId}
                  canMoveUp={index > 0}
                  canMoveDown={index < habits.length - 1}
                  onClick={() => onSelectHabit(habit.id)}
                  onEdit={() => setEditingHabitId(habit.id)}
                  onCancelEdit={() => setEditingHabitId(null)}
                  onSaveEdit={async (data) => {
                    await onUpdateHabit(habit.id, data);
                    setEditingHabitId(null);
                  }}
                  onDelete={() => onDeleteHabit(habit.id)}
                  onMoveUp={() => handleMoveUp(habit.id)}
                  onMoveDown={() => handleMoveDown(habit.id)}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Add Habit Dialog */}
      <AddHabitDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        onSubmit={async (data) => {
          await onCreateHabit(data);
          setIsAddDialogOpen(false);
        }}
      />
    </div>
  );
};