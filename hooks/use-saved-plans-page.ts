"use client";

import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { SavedPlanListItem } from "@/types/training";

type SavedPlansPageResponse = {
  success: boolean;
  plans: SavedPlanListItem[];
  total: number;
};

type Params = {
  page: number;
  pageSize: number;
  search?: string;
  segment?: string; // 'all' | 'custom' | 'ai'
  sort?: string; // 'updated' | 'name' | 'longest'
};

// Server-paginated Programs list (offset). Returns LEAN rows + the server total,
// so the list never fetches the full nested tree. keepPreviousData avoids a
// flash of the loader on page / sort / search changes.
export function useSavedPlansPage(params: Params) {
  const sp = new URLSearchParams();
  sp.set("status", "all");
  sp.set("limit", String(params.pageSize));
  sp.set("offset", String(params.page * params.pageSize));
  const q = params.search?.trim();
  if (q) sp.set("search", q);
  if (params.segment && params.segment !== "all") sp.set("source", params.segment);
  if (params.sort && params.sort !== "updated") sp.set("sort", params.sort);

  const { data, error, isLoading, isValidating, mutate } =
    useSWR<SavedPlansPageResponse>(
      `/api/training/saved-plans?${sp.toString()}`,
      swrFetcher,
      { revalidateOnFocus: false, keepPreviousData: true },
    );

  return {
    plans: data?.plans ?? [],
    total: data?.total ?? 0,
    isLoading,
    isValidating,
    error,
    mutate,
  };
}
