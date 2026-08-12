"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { ClientBlockView } from "@/lib/blocks/block-derivations";
import type {
  BlockDateChange,
  BlockFacts,
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
  data: { blocks: ClientBlockView[]; clientToday: string };
};

type BlockFactsResponse = {
  success: boolean;
  data: { facts: BlockFacts[] };
};

type DeleteBlockResponse = {
  success: boolean;
  data: {
    mode: "removed" | "truncated";
    changes: BlockDateChange[];
    blocks: ClientBlockView[];
    clientToday: string;
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
  const { data, error, isLoading } = useSWR<BlocksResponse>(
    clientBlocksKey(clientId),
    swrFetcher,
    SWR_CONFIG
  );
  return {
    blocks: data?.data.blocks ?? [],
    clientToday: data?.data.clientToday ?? null,
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
    facts: data?.data.facts ?? [],
    isLoading,
    isError: Boolean(error),
  };
}

/**
 * Invalidates every cached read under the blocks area (chain + facts). Blocks
 * writes touch only client_phases, so no other area's invalidator is owed.
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

/** PUT the whole chain. Callers invalidate the blocks area on success. */
export async function putBlockChain(
  clientId: string,
  payload: ReplaceBlockChainInput
): Promise<ClientBlockView[]> {
  const res = await fetch(clientBlocksKey(clientId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await parseOrThrow<BlocksResponse>(res, "Failed to save blocks");
  return body.data.blocks;
}

/** DELETE one block. Callers invalidate the blocks area on success. */
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

/** PATCH archive (true) / restore (false) an elapsed block — a coach view
 *  preference. Callers invalidate the blocks area on success. */
export async function patchBlockArchived(
  clientId: string,
  blockId: string,
  archived: boolean
): Promise<ClientBlockView[]> {
  const res = await fetch(`${clientBlocksKey(clientId)}/${blockId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archived }),
  });
  const body = await parseOrThrow<BlocksResponse>(
    res,
    "Failed to archive block"
  );
  return body.data.blocks;
}
