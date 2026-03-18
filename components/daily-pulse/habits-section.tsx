"use client";

import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { HabitRow } from "./habit-row";
import type { DailyHabit, DailyHabitLog } from "@/types/daily-habit";

type HabitLogWithDetails = DailyHabitLog & {
  habitName: string;
  targetValue?: number;
  targetUnit?: string;
  isBoolean: boolean;
};

interface HabitsSectionProps {
  habits: DailyHabit[];
  habitLogs: HabitLogWithDetails[];
  onHabitLogsUpdate: (logs: HabitLogWithDetails[]) => void;
  selectedDate: string;
}

// Helper to create an optimistic log entry
const createOptimisticLog = (
  habit: DailyHabit,
  completed: boolean,
  selectedDate: string,
  existingLog?: HabitLogWithDetails
): HabitLogWithDetails => {
  if (existingLog) {
    return {
      ...existingLog,
      completed,
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    id: `temp-${habit.id}`,
    dailyHabitId: habit.id,
    clientId: habit.clientId,
    date: selectedDate,
    completed,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    habitName: habit.name,
    targetValue: habit.targetValue,
    targetUnit: habit.targetUnit,
    isBoolean: habit.isBoolean,
  };
};

// Helper to save habit to API
const saveHabitToAPI = async (
  habitId: string,
  completed: boolean,
  selectedDate: string
): Promise<DailyHabitLog> => {
  const response = await fetch("/api/client/habits/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dailyHabitId: habitId,
      date: selectedDate,
      completed,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to save habit");
  }

  const result = await response.json();
  return result.data;
};

export function HabitsSection({ habits, habitLogs, onHabitLogsUpdate, selectedDate }: HabitsSectionProps) {
  const { toast } = useToast();
  const [savingHabits, setSavingHabits] = useState<Set<string>>(new Set());

  // Filter habits to only show those created on or before the selected date
  const visibleHabits = habits.filter(habit => {
    // Compare dates only (ignore time)
    const habitCreatedDate = new Date(habit.createdAt).toISOString().split('T')[0];
    return habitCreatedDate <= selectedDate;
  });

  // Create a map for quick log lookup
  const logMap = new Map(habitLogs.map(log => [log.dailyHabitId, log]));

  if (habits.length === 0) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm text-muted-foreground">Daily Habits</h3>
        <p className="text-sm text-muted-foreground">No daily habits set up yet</p>
      </div>
    );
  }

  if (visibleHabits.length === 0) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm text-muted-foreground">Daily Habits</h3>
        <p className="text-sm text-muted-foreground">No habits were active on this date</p>
      </div>
    );
  }

  const updateLogs = (habitId: string, newLog: HabitLogWithDetails | null) => {
    const updatedLogs = habitLogs.filter(log => log.dailyHabitId !== habitId);
    if (newLog) updatedLogs.push(newLog);
    onHabitLogsUpdate(updatedLogs);
  };

  const handleSaveError = (habitId: string, existingLog?: HabitLogWithDetails) => {
    // Revert to original state
    updateLogs(habitId, existingLog || null);
    toast({
      title: "Error",
      description: "Failed to save habit",
      variant: "destructive",
    });
  };

  const handleToggle = async (habit: DailyHabit, checked: boolean) => {
    const habitId = habit.id;
    const existingLog = logMap.get(habitId);
    
    setSavingHabits(prev => new Set(prev).add(habitId));

    // Optimistic update
    const optimisticLog = createOptimisticLog(habit, checked, selectedDate, existingLog);
    updateLogs(habitId, optimisticLog);

    try {
      const savedLog = await saveHabitToAPI(habitId, checked, selectedDate);
      const finalLog: HabitLogWithDetails = {
        ...savedLog,
        habitName: habit.name,
        targetValue: habit.targetValue,
        targetUnit: habit.targetUnit,
        isBoolean: habit.isBoolean,
      };
      updateLogs(habitId, finalLog);
    } catch (_error) {
      handleSaveError(habitId, existingLog);
    } finally {
      setSavingHabits(prev => {
        const next = new Set(prev);
        next.delete(habitId);
        return next;
      });
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm text-muted-foreground">Daily Habits</h3>
      
      {visibleHabits.map(habit => (
        <HabitRow
          key={habit.id}
          habit={habit}
          log={logMap.get(habit.id)}
          isSaving={savingHabits.has(habit.id)}
          onToggle={(checked) => handleToggle(habit, checked)}
        />
      ))}
    </div>
  );
}