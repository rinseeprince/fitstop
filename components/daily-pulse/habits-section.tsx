"use client";

import { useState } from "react";
import { getTodayDateString } from "@/lib/date-helpers";
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
}

// Helper to create an optimistic log entry
const createOptimisticLog = (
  habit: DailyHabit,
  completed: boolean,
  value?: number,
  existingLog?: HabitLogWithDetails
): HabitLogWithDetails => {
  if (existingLog) {
    return {
      ...existingLog,
      completed,
      value,
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    id: `temp-${habit.id}`,
    dailyHabitId: habit.id,
    clientId: habit.clientId,
    date: getTodayDateString(),
    completed,
    value,
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
  value?: number
): Promise<DailyHabitLog> => {
  const response = await fetch("/api/client/habits/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dailyHabitId: habitId,
      date: getTodayDateString(),
      completed,
      value,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to save habit");
  }

  const result = await response.json();
  return result.data;
};

export function HabitsSection({ habits, habitLogs, onHabitLogsUpdate }: HabitsSectionProps) {
  const { toast } = useToast();
  const [savingHabits, setSavingHabits] = useState<Set<string>>(new Set());

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

  const handleBooleanToggle = async (habit: DailyHabit, checked: boolean) => {
    const habitId = habit.id;
    const existingLog = logMap.get(habitId);
    
    setSavingHabits(prev => new Set(prev).add(habitId));

    // Optimistic update
    const optimisticLog = createOptimisticLog(habit, checked, undefined, existingLog);
    updateLogs(habitId, optimisticLog);

    try {
      const savedLog = await saveHabitToAPI(habitId, checked);
      const finalLog: HabitLogWithDetails = {
        ...savedLog,
        habitName: habit.name,
        isBoolean: true,
      };
      updateLogs(habitId, finalLog);
    } catch (error) {
      handleSaveError(habitId, existingLog);
    } finally {
      setSavingHabits(prev => {
        const next = new Set(prev);
        next.delete(habitId);
        return next;
      });
    }
  };

  const handleNumericBlur = async (habit: DailyHabit, value: number | undefined) => {
    const habitId = habit.id;
    const existingLog = logMap.get(habitId);
    
    // Don't save if value hasn't changed
    if (existingLog?.value === value) return;

    setSavingHabits(prev => new Set(prev).add(habitId));

    const completed = value !== undefined && habit.targetValue ? value >= habit.targetValue : false;

    // Optimistic update
    const optimisticLog = createOptimisticLog(habit, completed, value, existingLog);
    updateLogs(habitId, optimisticLog);

    try {
      const savedLog = await saveHabitToAPI(habitId, completed, value);
      const finalLog: HabitLogWithDetails = {
        ...savedLog,
        habitName: habit.name,
        targetValue: habit.targetValue,
        targetUnit: habit.targetUnit,
        isBoolean: false,
      };
      updateLogs(habitId, finalLog);
    } catch (error) {
      handleSaveError(habitId, existingLog);
    } finally {
      setSavingHabits(prev => {
        const next = new Set(prev);
        next.delete(habitId);
        return next;
      });
    }
  };

  const handleNumericChange = (habit: DailyHabit, value: number | undefined) => {
    const log = logMap.get(habit.id);
    const updatedLog = createOptimisticLog(habit, false, value, log);
    updateLogs(habit.id, updatedLog);
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm text-muted-foreground">Daily Habits</h3>
      
      {habits.map(habit => (
        <HabitRow
          key={habit.id}
          habit={habit}
          log={logMap.get(habit.id)}
          isSaving={savingHabits.has(habit.id)}
          onBooleanToggle={(checked) => handleBooleanToggle(habit, checked)}
          onNumericChange={(value) => handleNumericChange(habit, value)}
          onNumericBlur={(value) => handleNumericBlur(habit, value)}
        />
      ))}
    </div>
  );
}