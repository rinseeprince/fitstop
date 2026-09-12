"use client";

import { useRouter } from "next/navigation";
import { hasCoachHistory } from "@/lib/coach-history";

/**
 * What a back arrow does: the browser's Back when a coach page precedes the
 * current entry, else `fallback` — the arrow's parent (the programs library,
 * a review's list). Decided at click time from `lib/coach-history.ts`, so the
 * arrow and browser Back always agree. `components/coach/back-link.tsx` is
 * the same decision for an arrow that is a link.
 */
export function useCoachBack(fallback: () => void): () => void {
  const router = useRouter();
  return () => {
    if (hasCoachHistory()) router.back();
    else fallback();
  };
}
