"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { readNutritionDrawerTrip, stripNutritionDrawerTrip } from "@/lib/client-tabs";

/**
 * The Nutrition plan drawer: a locally-owned open/close surface that another
 * tab can deep-link OPEN — the Overview's "Set nutrition from 19 Oct" and
 * "Regenerate" (`nutritionDrawerParams`).
 *
 * Two properties carry the whole design, and both are bugs if dropped:
 *
 * 1. **Consume in an effect, once.** The strip is a router write, so it cannot
 *    run during render; the `consumed` ref keeps the effect from re-running
 *    against the params it already handled before the stripped URL commits.
 *
 * 2. **Strip them.** The whole query rides across every tab change, and Radix
 *    unmounts an inactive TabsContent, so each visit is a fresh mount: a
 *    lingering open-param re-opens the drawer on every hand-return to the tab.
 *
 * `startsOn` is the day the arrival asked the drawer to start on: captured in
 * the same update that opens the surface, so the drawer never opens on another
 * day first, and dropped on any close.
 */
export function useNutritionDrawerTrip(): {
  open: boolean;
  setOpen: (open: boolean) => void;
  startsOn: string | null;
} {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [open, setOpenState] = useState(false);
  const [startsOn, setStartsOn] = useState<string | null>(null);
  // Guards the window between consuming and the stripped URL committing, in
  // which this effect can re-run against the params it already handled.
  const consumed = useRef(false);

  useEffect(() => {
    if (consumed.current) return;
    const trip = readNutritionDrawerTrip(searchParams);
    if (!trip.open) return;
    consumed.current = true;
    setOpenState(true);
    setStartsOn(trip.startsOn);
    router.replace(`?${stripNutritionDrawerTrip(searchParams.toString())}`, {
      scroll: false,
    });
  }, [searchParams, router]);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    // A close drops the arrival's day, and a hand open starts from none.
    setStartsOn(null);
  }, []);

  return { open, setOpen, startsOn };
}
