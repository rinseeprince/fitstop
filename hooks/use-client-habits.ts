import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import { useToast } from "@/hooks/use-toast";
import type { DailyHabit, DailyHabitInput } from "@/types/daily-habit";
import type { HabitStats } from "@/services/daily-habits-stats";

interface HabitWithStats extends DailyHabit {
  stats?: HabitStats;
}

const fetcher = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to fetch");
  }
  const data = await response.json();
  return data.data;
};

export function useClientHabits(clientId: string | null, includeInactive = false) {
  const { toast } = useToast();
  const [habitsWithStats, setHabitsWithStats] = useState<HabitWithStats[]>([]);
  const [isLoadingStats, setIsLoadingStats] = useState(false);

  // Fetch habits
  const {
    data: habits,
    error: habitsError,
    isLoading: habitsLoading,
    mutate: mutateHabits,
  } = useSWR<DailyHabit[]>(
    clientId ? `/api/clients/${clientId}/habits${includeInactive ? '?includeInactive=true' : ''}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  // Fetch stats for all habits
  useEffect(() => {
    if (!habits || habits.length === 0) {
      setHabitsWithStats([]);
      return;
    }

    const fetchAllStats = async () => {
      setIsLoadingStats(true);
      try {
        const statsPromises = habits.map(async (habit) => {
          try {
            const response = await fetch(
              `/api/clients/${clientId}/habits/stats?habitId=${habit.id}&days=30`
            );
            if (response.ok) {
              const data = await response.json();
              return { habitId: habit.id, stats: data.data as HabitStats };
            }
            return { habitId: habit.id, stats: undefined };
          } catch {
            return { habitId: habit.id, stats: undefined };
          }
        });

        const allStats = await Promise.all(statsPromises);
        const statsMap = new Map(allStats.map(s => [s.habitId, s.stats]));

        const habitsWithStatsData: HabitWithStats[] = habits.map(habit => ({
          ...habit,
          stats: statsMap.get(habit.id),
        }));

        setHabitsWithStats(habitsWithStatsData);
      } finally {
        setIsLoadingStats(false);
      }
    };

    fetchAllStats();
  }, [habits, clientId]);

  // Create habit
  const createHabit = useCallback(
    async (data: DailyHabitInput) => {
      if (!clientId) return;

      try {
        const response = await fetch(`/api/clients/${clientId}/habits`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(data),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to create habit");
        }

        const result = await response.json();
        
        // Refetch the habits list
        await mutateHabits();

        toast({
          title: "Habit created",
          description: `"${data.name}" has been added successfully.`,
        });

        return result.data as DailyHabit;
      } catch (error) {
        // Check for duplicate name error
        const errorMessage = error instanceof Error ? error.message : "An error occurred";
        const isDuplicateError = 
          errorMessage.toLowerCase().includes("duplicate key") ||
          errorMessage.toLowerCase().includes("unique constraint") ||
          errorMessage.toLowerCase().includes("already exists");
        
        toast({
          title: "Failed to create habit",
          description: isDuplicateError 
            ? "A habit with this name already exists"
            : errorMessage,
          variant: "destructive",
        });
        throw error;
      }
    },
    [clientId, mutateHabits, toast]
  );

  // Update habit
  const updateHabit = useCallback(
    async (habitId: string, data: Partial<DailyHabitInput>) => {
      if (!clientId) return;

      try {
        const response = await fetch(`/api/clients/${clientId}/habits/${habitId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(data),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to update habit");
        }

        const result = await response.json();
        
        // Refetch the habits list
        await mutateHabits();

        toast({
          title: "Habit updated",
          description: "The habit has been updated successfully.",
        });

        return result.data as DailyHabit;
      } catch (error) {
        toast({
          title: "Failed to update habit",
          description: error instanceof Error ? error.message : "An error occurred",
          variant: "destructive",
        });
        throw error;
      }
    },
    [clientId, mutateHabits, toast]
  );

  // Delete (deactivate) habit
  const deleteHabit = useCallback(
    async (habitId: string) => {
      if (!clientId) return;

      try {
        const response = await fetch(`/api/clients/${clientId}/habits/${habitId}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to delete habit");
        }

        // Refetch the habits list
        await mutateHabits();

        toast({
          title: "Habit deleted",
          description: "The habit has been removed successfully.",
        });
      } catch (error) {
        toast({
          title: "Failed to delete habit",
          description: error instanceof Error ? error.message : "An error occurred",
          variant: "destructive",
        });
        throw error;
      }
    },
    [clientId, mutateHabits, toast]
  );

  // Reactivate habit
  const reactivateHabit = useCallback(
    async (habitId: string) => {
      if (!clientId) return;

      try {
        const response = await fetch(`/api/clients/${clientId}/habits/${habitId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ isActive: true }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to reactivate habit");
        }

        const result = await response.json();
        
        // Refetch the habits list
        await mutateHabits();

        toast({
          title: "Habit reactivated",
          description: "The habit has been reactivated successfully.",
        });

        return result.data as DailyHabit;
      } catch (error) {
        toast({
          title: "Failed to reactivate habit",
          description: error instanceof Error ? error.message : "An error occurred",
          variant: "destructive",
        });
        throw error;
      }
    },
    [clientId, mutateHabits, toast]
  );

  // Reorder habits
  const reorderHabits = useCallback(
    async (habitIds: string[]) => {
      if (!clientId) return;

      try {
        const response = await fetch(`/api/clients/${clientId}/habits/reorder`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ habitIds }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to reorder habits");
        }

        // Refetch the habits list
        await mutateHabits();

        toast({
          title: "Habits reordered",
          description: "The habit order has been updated successfully.",
        });
      } catch (error) {
        toast({
          title: "Failed to reorder habits",
          description: error instanceof Error ? error.message : "An error occurred",
          variant: "destructive",
        });
        throw error;
      }
    },
    [clientId, mutateHabits, toast]
  );

  return {
    habits: habitsWithStats,
    isLoading: habitsLoading || isLoadingStats,
    error: habitsError,
    createHabit,
    updateHabit,
    deleteHabit,
    reactivateHabit,
    reorderHabits,
    refetch: mutateHabits,
  };
}