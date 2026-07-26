"use client";

import { useCallback } from "react";
import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { ClientNote } from "@/types/coach-overview";

type NotesResponse = { success: boolean; data: ClientNote[] };

/**
 * Coach notes about a client. The server returns them pinned-first then
 * newest-first, so the order is never re-derived here.
 *
 * `setPinned` deliberately revalidates the whole list rather than patching the
 * one row: pinning a note unpins whichever note held the pin, and that second
 * row's change is invisible in the PATCH response.
 */
export function useClientNotes(clientId: string) {
  const key = clientId ? `/api/clients/${clientId}/notes` : null;
  const { data, error, isLoading, mutate } = useSWR<NotesResponse>(key, swrFetcher, {
    revalidateOnFocus: false,
    errorRetryCount: 3,
    errorRetryInterval: 1000,
  });

  const addNote = useCallback(
    async (body: string) => {
      const res = await fetch(`/api/clients/${clientId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const payload = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !payload.success) {
        throw new Error(payload.error || "Failed to save note");
      }
      await mutate();
    },
    [clientId, mutate]
  );

  const setPinned = useCallback(
    async (noteId: string, isPinned: boolean) => {
      const res = await fetch(`/api/clients/${clientId}/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPinned }),
      });
      const payload = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !payload.success) {
        throw new Error(payload.error || "Failed to update note");
      }
      await mutate();
    },
    [clientId, mutate]
  );

  return {
    notes: data?.data ?? [],
    isLoading,
    isError: !!error,
    mutate,
    addNote,
    setPinned,
  };
}
