"use client";

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetClose,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Plus, ListChecks, X } from "lucide-react";
import { HabitListItem } from "./habit-list-item";
import { AddHabitInlineForm } from "./add-habit-inline-form";
import type { DailyHabit, DailyHabitInput } from "@/types/daily-habit";
import type { HabitStats } from "@/services/daily-habits-stats";
import { LibrarySearchInput } from "@/components/programs/shared/library-search-input";

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
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredHabits = searchQuery
    ? habits.filter((h) =>
        h.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : habits;

  const handleMoveUp = async (habitId: string) => {
    const idx = filteredHabits.findIndex((h) => h.id === habitId);
    if (idx <= 0) return;
    const newOrder = [...filteredHabits];
    [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]];
    await onReorderHabits(newOrder.map((h) => h.id));
  };

  const handleMoveDown = async (habitId: string) => {
    const idx = filteredHabits.findIndex((h) => h.id === habitId);
    if (idx === -1 || idx >= filteredHabits.length - 1) return;
    const newOrder = [...filteredHabits];
    [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];
    await onReorderHabits(newOrder.map((h) => h.id));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        overlayClassName="bg-[rgba(15,32,39,0.35)] backdrop-blur-[2px]"
        className="w-[420px] bg-[#f4f7f6] p-0 gap-0 flex flex-col inset-y-0 right-0 h-full [&>[data-slot=sheet-close]]:hidden animate-drawer-slide-in data-[state=closed]:slide-out-to-right data-[state=closed]:duration-300"
      >
        {/* Visually hidden title for accessibility */}
        <SheetHeader className="sr-only">
          <SheetTitle>Manage Habits</SheetTitle>
        </SheetHeader>

        {/* Dark header */}
        <div className="bg-[#0f2027] px-6 pt-5 pb-5 flex-shrink-0">
          <div className="flex items-start gap-3">
            <div className="w-[28px] h-[28px] rounded-[6px] bg-[rgba(13,148,136,0.15)] flex items-center justify-center flex-shrink-0">
              <ListChecks className="w-[15px] h-[15px] text-[#0d9488]" strokeWidth={1.5} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-[16px] font-bold text-white leading-tight">
                Manage Habits
              </h2>
              <p className="text-[12px] text-[rgba(255,255,255,0.4)] mt-1 leading-[1.4]">
                Add, edit, and reorder your client&apos;s daily habits.
              </p>
            </div>
            <SheetClose className="w-[32px] h-[32px] rounded-[6px] bg-[rgba(255,255,255,0.06)] flex items-center justify-center flex-shrink-0 hover:bg-[rgba(255,255,255,0.1)] transition-colors">
              <X className="w-4 h-4 text-[rgba(255,255,255,0.5)]" strokeWidth={1.5} />
              <span className="sr-only">Close</span>
            </SheetClose>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 pt-5 pb-20 space-y-3">
          {/* Search */}
          <LibrarySearchInput
            size="panel"
            fill="page"
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search habits"
          />

          {/* Add button / inline form */}
          {showAddForm ? (
            <AddHabitInlineForm
              onSubmit={async (data) => {
                await onCreateHabit(data);
                setShowAddForm(false);
              }}
              onCancel={() => setShowAddForm(false)}
            />
          ) : (
            <Button
              onClick={() => setShowAddForm(true)}
              className="w-full bg-[#0d9488] hover:bg-[#0f766e] text-white text-[12px] font-medium"
              size="sm"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" strokeWidth={2} />
              Add Habit
            </Button>
          )}

          {/* Habit list */}
          {filteredHabits.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-[13px] text-[#93b0b4]">
                {searchQuery ? "No habits match your search" : "No habits yet. Add one above."}
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
      </SheetContent>
    </Sheet>
  );
}

