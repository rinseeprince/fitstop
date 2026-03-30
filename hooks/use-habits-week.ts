import useSWR from "swr";
import type { WeeklyHabitsResponse } from "@/types/history";

const fetcher = async (url: string): Promise<WeeklyHabitsResponse> => {
  const response = await fetch(url);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to fetch");
  }
  const json = await response.json();
  return json.data;
};

export function useHabitsWeek(clientId: string | null, weekStart: string | null) {
  const url =
    clientId && weekStart
      ? `/api/clients/${clientId}/habits/weekly?weekStart=${weekStart}`
      : null;

  const { data, error, isLoading, mutate } = useSWR<WeeklyHabitsResponse>(
    url,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  return {
    data: data ?? null,
    error,
    isLoading,
    mutate,
  };
}
