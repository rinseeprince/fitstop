"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { ClientBlockView } from "@/lib/blocks/block-derivations";
import type {
  BlockFacts,
  BlockPlanTrim,
  ReplaceBlockChainInput,
} from "@/types/client-blocks";

// Key construction and invalidation are deliberately co-located (the
// use-calendar-events.ts pattern): never build a /blocks key anywhere else.
// The key builders are endpoint-specific; the invalidator matches the API
// AREA so a reader added later is covered without editing it.

function clientBlocksKey(clientId: string) {
  return `/api/clients/${clientId}/blocks`;
}

function blockFactsKey(clientId: string) {
  return `/api/clients/${clientId}/blocks/facts`;
}

function blocksAreaKeyPrefix(clientId: string) {
  return `/api/clients/${clientId}/blocks`;
}

type BlocksResponse = {
  success: boolean;
  data: {
    blocks: ClientBlockView[];
    clientToday: string;
    /** The earliest day a PROGRAM may start on this client's calendar: their
     *  today, or tomorrow once they have logged a workout today — the deletion
     *  floor (`resolveEventDeletionFloor`), read server-side because it depends
     *  on the client's training log. The apply dialog's date picker floors on
     *  it; the nutrition drawer's floors on the client's today (targets ask no
     *  floor) and takes only the blocks from this payload. A block itself is
     *  not constrained by it. */
    planStartFloor: string;
  };
};

type BlockFactsResponse = {
  success: boolean;
  data: { facts: BlockFacts[] };
};

type DeleteBlockResponse = {
  success: boolean;
  data: {
    blocks: ClientBlockView[];
    clientToday: string;
    planStartFloor: string;
  };
};

const SWR_CONFIG = {
  revalidateOnFocus: false,
  errorRetryCount: 3,
  errorRetryInterval: 1000,
} as const;

/** The client's block chain, decorated (weeks/state/weekOfTotal) server-side
 *  in the CLIENT's timezone — never re-derive state in the browser.
 *  `clientToday` is the client-tz day the decoration used; every client-side
 *  date derivation (pace fraction, delete-shift preview) uses it, never the
 *  coach's device day. */
export function useClientBlocks(clientId: string) {
  // No client, no read: the apply dialog holds this until a client is picked
  // on the library path. A key built from an empty id would fetch a URL naming
  // no client.
  const { data, error, isLoading } = useSWR<BlocksResponse>(
    clientId ? clientBlocksKey(clientId) : null,
    swrFetcher,
    SWR_CONFIG
  );
  return {
    // Optional all the way down: a cache entry can be cleared to undefined, and
    // a failed or partial payload must read as "nothing yet", never throw in a
    // render.
    blocks: data?.data?.blocks ?? [],
    clientToday: data?.data?.clientToday ?? null,
    planStartFloor: data?.data?.planStartFloor ?? null,
    isLoading,
    isError: Boolean(error),
  };
}

/** Per-block server facts (training programs + nutrition targets). */
export function useBlockFacts(clientId: string) {
  const { data, error, isLoading } = useSWR<BlockFactsResponse>(
    blockFactsKey(clientId),
    swrFetcher,
    SWR_CONFIG
  );
  return {
    facts: data?.data?.facts ?? [],
    isLoading,
    isError: Boolean(error),
  };
}

/**
 * Invalidates every cached read under the blocks area (chain + facts).
 *
 * NOT sufficient on its own for the writes that reach the calendar — a save
 * that trims plans and every delete rewrite `training_events` and the
 * nutrition versions' windows, which the computed nutrition month view is
 * priced from, so those call sites also invoke `useInvalidateTrainingData`
 * and `useInvalidateNutritionCalendar` (CONVENTIONS §7). Only a chain PUT that
 * trims nothing, and the PATCH, are client_phases-only.
 */
export function useInvalidateClientBlocks() {
  const { mutate } = useSWRConfig();
  return useCallback(
    (clientId: string) =>
      mutate(
        (key) =>
          typeof key === "string" &&
          key.startsWith(blocksAreaKeyPrefix(clientId))
      ),
    [mutate]
  );
}

/**
 * Write a mutation's OWN response into the chain cache, synchronously and with
 * no revalidation.
 *
 * This exists to close a frame, not to save a request. Every write here returns
 * the full decorated chain, and a caller that instead fires a revalidation and
 * closes its form has to pick which stale frame the coach sees: close first and
 * the list has not arrived (the empty state flashes); await first and the list
 * arrives while the form is still open (a reset form flashes under the new row).
 * Reordering only moves the gap. Seeding removes it — the cache write and the
 * caller's `setState` land in ONE React batch, so there is no frame between.
 *
 * Callers still fire the invalidator afterwards, for the FACTS key this cannot
 * seed.
 */
export function useSeedClientBlocks() {
  const { mutate } = useSWRConfig();
  return useCallback(
    (clientId: string, data: BlocksResponse["data"]) =>
      mutate(clientBlocksKey(clientId), { success: true, data }, {
        revalidate: false,
      }),
    [mutate]
  );
}

/**
 * Drop the cached per-block facts, then let them refetch.
 *
 * CLEARED, not merely revalidated. SWR keeps serving a stale entry while it
 * refetches, and this one is rendered as a DEFINITE answer — a block that now
 * holds a program reads "No program placed" until the read returns. Clearing
 * puts the card into the pending state it already has, so it says "Loading…"
 * rather than something false.
 *
 * Called from every screen whose write changes what `/blocks/facts` computes —
 * placing a program, saving or deleting a nutrition plan — none of which write
 * `client_phases` at all. The facts are DERIVED from the training and nutrition
 * tables, so the area that owes the invalidator is the one that READS what you
 * wrote, not the one you wrote (CONVENTIONS §7).
 */
export function useClearBlockFacts() {
  const { mutate } = useSWRConfig();
  return useCallback(
    (clientId: string) =>
      mutate(blockFactsKey(clientId), undefined, { revalidate: true }),
    [mutate]
  );
}

async function parseOrThrow<T extends { success?: boolean }>(
  res: Response,
  fallback: string
): Promise<T> {
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok || !body.success) {
    throw new Error(body.error || fallback);
  }
  return body;
}

/** What a chain PUT came back with: the saved chain, or — when the save
 *  would trim plans already on the calendar and carried no `confirmTrims` —
 *  the trims, for the one question. */
type BlockChainSave =
  | { saved: BlocksResponse["data"] }
  | { trims: BlockPlanTrim[] };

/** PUT the whole chain. Callers invalidate the blocks area on a save. */
export async function putBlockChain(
  clientId: string,
  payload: ReplaceBlockChainInput
): Promise<BlockChainSave> {
  const res = await fetch(clientBlocksKey(clientId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.status === 409) {
    const refusal = (await res.json()) as { data?: { trims?: BlockPlanTrim[] } };
    if (refusal.data?.trims) return { trims: refusal.data.trims };
  }
  const body = await parseOrThrow<BlocksResponse>(res, "Failed to save blocks");
  return { saved: body.data };
}

/** DELETE one block and its plans. Callers invalidate the blocks area, both
 *  calendar areas, the facts, the Overview and the feed on success. */
export async function deleteBlockRequest(
  clientId: string,
  blockId: string
): Promise<DeleteBlockResponse["data"]> {
  const res = await fetch(`${clientBlocksKey(clientId)}/${blockId}`, {
    method: "DELETE",
  });
  const body = await parseOrThrow<DeleteBlockResponse>(
    res,
    "Failed to delete block"
  );
  return body.data;
}

/**
 * DELETE one plan from a block card's timeline — a running one ends
 * yesterday, a queued one is removed — on its own track's route: the
 * training per-plan DELETE, or the nutrition per-version DELETE. Deleting a
 * plan never touches another, and nothing regrows. Callers invalidate the
 * training and nutrition areas, the facts, the Overview and the feed on
 * success (CONVENTIONS §7).
 */
export async function deletePlanRequest(
  clientId: string,
  track: "training" | "nutrition",
  planId: string
): Promise<void> {
  const res = await fetch(`/api/clients/${clientId}/${track}/${planId}`, {
    method: "DELETE",
  });
  await parseOrThrow<{ success?: boolean }>(
    res,
    track === "training" ? "Failed to delete the plan" : "Failed to delete the targets"
  );
}

/** PATCH archive (true) / restore (false) an elapsed block — a coach view
 *  preference. Callers invalidate the blocks area on success. */
export async function patchBlockArchived(
  clientId: string,
  blockId: string,
  archived: boolean
): Promise<BlocksResponse["data"]> {
  const res = await fetch(`${clientBlocksKey(clientId)}/${blockId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archived }),
  });
  const body = await parseOrThrow<BlocksResponse>(
    res,
    "Failed to archive block"
  );
  return body.data;
}

