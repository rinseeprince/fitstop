"use client";

import { useSearchParams } from "next/navigation";
import { readJourneyTrip, type JourneyTripSurface } from "@/lib/client-tabs";
import { useClientBlocks } from "./use-client-blocks";

/**
 * The first day of the block a coach came FROM, or null when they did not.
 *
 * The round-trip contract already carries the block id in the URL (`place one`
 * / `set targets` — see `journeyTripParams`), and the chain is in SWR's cache
 * because the coach was looking at it a moment ago. So a setup surface can seed
 * its date picker with the days the coach has already chosen, instead of making
 * them type a date they just looked at.
 *
 * A SEED, never a binding: the picker stays theirs to change, and nothing here
 * writes. Null whenever there is no round trip, no client, or the chain has not
 * loaded — every caller falls back to whatever it defaulted to before.
 *
 * Reads the trip through `readJourneyTrip`, the contract's single owner, rather
 * than picking the param off the URL itself.
 */
export function useRoundTripBlockStart(
  clientId: string | undefined,
  surface: JourneyTripSurface
): string | null {
  const searchParams = useSearchParams();
  // `useSearchParams()` is null outside a router (a hook under unit test, a
  // component rendered off-tree). No params means no round trip, which is the
  // same answer as a coach who arrived any other way.
  const { returnBlockId } = readJourneyTrip(
    new URLSearchParams(searchParams?.toString() ?? ""),
    surface
  );
  const { blocks } = useClientBlocks(clientId ?? "");
  if (!clientId || !returnBlockId) return null;
  return blocks.find((block) => block.id === returnBlockId)?.startsOn ?? null;
}
