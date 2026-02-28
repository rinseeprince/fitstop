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
  onReactivateHabit?: (habitId: string) => Promise<DailyHabit | undefined>;
  onReorderHabits: (habitIds: string[]) => Promise<void>;
  showInactive?: boolean;
  onToggleShowInactive?: (value: boolean) => void;
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
  onReactivateHabit,
  onReorderHabits,
  showInactive = false,
  onToggleShowInactive,
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

          {/* Active/All Toggle */}
          {onToggleShowInactive && (
            <div className="bg-gray-100 p-1 rounded-lg inline-flex w-full">
              <button
                onClick={() => onToggleShowInactive(false)}
                className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                  !showInactive
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Active
              </button>
              <button
                onClick={() => onToggleShowInactive(true)}
                className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                  showInactive
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                All
              </button>
            </div>
          )}

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
                  canMoveUp={habit.isActive && index > 0}
                  canMoveDown={habit.isActive && index < habits.filter(h => h.isActive).length - 1}
                  onClick={() => onSelectHabit(habit.id)}
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