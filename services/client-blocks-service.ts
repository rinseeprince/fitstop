import { supabaseAdmin } from "./supabase-admin";
import { addDaysToDateString } from "@/lib/date-helpers";
import {
  computeBlockChainFromEnds,
  computeDeleteShift,
  inclusiveDays,
  DAYS_PER_BLOCK_WEEK,
} from "@/lib/blocks/block-chain";
import { BLOCK_WEEKS_MAX } from "@/lib/constants";
import type { TablesInsert } from "@/types/database";
import type {
  BlockDateChange,
  ClientBlock,
  ReplaceBlockChainInput,
} from "@/types/client-blocks";

/**
 * Journey blocks (client_phases — the table keeps the phases name, the
 * coach-facing noun is "block"; see the table comment, migration 145).
 *
 * Shape B: routes verify the coach owns the client; every query here filters
 * on the passed clientId. `clientToday` is the CLIENT's calendar day, resolved
 * once at the route via getClientTodayString and threaded in — the service
 * never derives time itself (the migration-144 clientToday-threading
 * precedent).
 *
 * Ends in, starts out: the caller sends the chain anchor plus each editable
 * block's END date; every start is derived by the walk
 * (lib/blocks/block-chain.ts), so date pairs never cross the wire and
 * overlaps and gaps stay unexpressible. Elapsed blocks (ends_on < clientToday)
 * keep their DATES as read-only history — their name/focus/target stay
 * editable (3.6-C) — and the symmetric window floor keeps every edit from
 * re-labelling lived days (only DELETE re-attributes them, and only by ending
 * a block at today).
 */

/** 422: the block (or its elapsed prefix) is read-only history. */
export class ElapsedBlockImmutableError extends Error {}
/** 422: an edit would re-label lived days (symmetric window floor). */
export class BlockWindowError extends Error {}
/** 422: the payload is structurally wrong for the stored chain. */
export class BlockPayloadError extends Error {}
/** 404: the DELETE target does not exist for this client. */
export class UnknownBlockIdError extends Error {}

type BlockRow = {
  id: string;
  name: string;
  focus: string | null;
  target_weight: number | null;
  starts_on: string;
  ends_on: string;
};

const BLOCK_COLUMNS = "id, name, focus, target_weight, starts_on, ends_on";

function mapBlockRow(row: BlockRow): ClientBlock {
  return {
    id: row.id,
    name: row.name,
    focus: row.focus,
    targetWeightKg: row.target_weight,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
  };
}

/** The client's chain in date order. */
export const listBlocks = async (clientId: string): Promise<ClientBlock[]> => {
  const { data, error } = await supabaseAdmin
    .from("client_phases")
    .select(BLOCK_COLUMNS)
    .eq("client_id", clientId)
    .order("starts_on", { ascending: true });

  if (error) {
    console.error("Failed to fetch blocks:", error);
    throw new Error(`Failed to fetch blocks: ${error.message}`);
  }
  return (data ?? []).map(mapBlockRow);
};

const isCurrent = (block: ClientBlock, today: string): boolean =>
  block.startsOn <= today && today <= block.endsOn;

/**
 * Replace the whole chain: elapsed rows pinned verbatim, the editable suffix
 * recomputed from its end dates (starts derived). Removal is NOT expressible
 * here — an existing non-elapsed id missing from the payload is a 422,
 * because DELETE owns the shift-and-report contract.
 */
export const replaceBlockChain = async (
  clientId: string,
  clientToday: string,
  input: ReplaceBlockChainInput
): Promise<ClientBlock[]> => {
  const stored = await listBlocks(clientId);
  const storedById = new Map(stored.map((block) => [block.id, block]));
  const elapsed = stored.filter((block) => block.endsOn < clientToday);

  // The elapsed prefix's DATES are immutable: the payload must lead with it —
  // same ids, same order, dates from STORAGE, never from the walk. Its
  // name/focus/target are editable (Session 3.6-C, owner-approved relaxation
  // of the original verbatim pin): the pin protects lived-day ATTRIBUTION,
  // not typos in a finished block's label.
  const elapsedEdits: { echo: (typeof input.blocks)[number]; storedBlock: ClientBlock }[] = [];
  elapsed.forEach((storedBlock, i) => {
    const echo = input.blocks[i];
    if (!echo || echo.id !== storedBlock.id) {
      throw new ElapsedBlockImmutableError(
        "Past blocks are read-only and must lead the chain unchanged."
      );
    }
    if (echo.endsOn !== undefined && echo.endsOn !== storedBlock.endsOn) {
      throw new ElapsedBlockImmutableError("Past blocks' dates can't change.");
    }
    if (
      echo.name !== storedBlock.name ||
      (echo.focus ?? null) !== storedBlock.focus ||
      (echo.targetWeightKg ?? null) !== storedBlock.targetWeightKg
    ) {
      elapsedEdits.push({ echo, storedBlock });
    }
  });

  if (elapsed.length > 0 && input.startsOn !== stored[0].startsOn) {
    throw new BlockPayloadError(
      "The journey start can't move while past blocks exist."
    );
  }

  const suffix = input.blocks.slice(elapsed.length);
  for (const entry of suffix) {
    if (entry.id !== undefined) {
      const storedBlock = storedById.get(entry.id);
      if (!storedBlock) {
        throw new BlockPayloadError("Unknown block id in payload.");
      }
      if (storedBlock.endsOn < clientToday) {
        throw new ElapsedBlockImmutableError(
          "Past blocks are read-only and must lead the chain unchanged."
        );
      }
    }
    if (entry.endsOn === undefined) {
      throw new BlockPayloadError(
        "An end date is required for current and future blocks."
      );
    }
  }

  const payloadIds = new Set(
    input.blocks.flatMap((entry) => (entry.id ? [entry.id] : []))
  );
  for (const block of stored) {
    if (block.endsOn >= clientToday && !payloadIds.has(block.id)) {
      throw new BlockPayloadError(
        "Removing a block goes through its delete action, which reports the date changes."
      );
    }
  }

  const anchor =
    elapsed.length > 0
      ? addDaysToDateString(elapsed[elapsed.length - 1].endsOn, 1)
      : input.startsOn;
  const windows = computeBlockChainFromEnds(
    anchor,
    suffix.map((entry) => entry.endsOn as string)
  );

  // Structural window checks the walk deliberately leaves to us: an end
  // before its DERIVED start (which zod can't know) inverts the window, and
  // everything after it; the length cap mirrors the old weeks ceiling.
  const maxBlockDays = BLOCK_WEEKS_MAX * DAYS_PER_BLOCK_WEEK;
  windows.forEach((window, i) => {
    if (window.endsOn < window.startsOn) {
      throw new BlockWindowError(
        `"${suffix[i].name}" would end before it starts (${window.startsOn}).`
      );
    }
    if (inclusiveDays(window.startsOn, window.endsOn) > maxBlockDays) {
      throw new BlockPayloadError(
        `A block can't run longer than ${BLOCK_WEEKS_MAX} weeks.`
      );
    }
  });

  // Symmetric window floor: an edit never re-labels lived days. A stored
  // current block must still contain today (may neither end before today nor
  // start after it); a stored future block may become current but never
  // wholly past. New id-less rows may land anywhere — history backfill.
  suffix.forEach((entry, i) => {
    if (!entry.id) return;
    const storedBlock = storedById.get(entry.id) as ClientBlock;
    const window = windows[i];
    if (isCurrent(storedBlock, clientToday)) {
      if (window.startsOn > clientToday || window.endsOn < clientToday) {
        throw new BlockWindowError(
          "The block in progress must still cover today. To end it now, delete it — the next block starts today."
        );
      }
    } else if (window.endsOn < clientToday) {
      throw new BlockWindowError(
        "A scheduled block can't be moved entirely into the past."
      );
    }
  });

  const now = new Date().toISOString();
  const updates: TablesInsert<"client_phases">[] = [];
  const inserts: TablesInsert<"client_phases">[] = [];
  // Changed elapsed rows: payload fields over STORED dates. Unchanged echoes
  // are deliberately not rewritten.
  for (const { echo, storedBlock } of elapsedEdits) {
    updates.push({
      id: storedBlock.id,
      client_id: clientId,
      name: echo.name,
      focus: echo.focus ?? null,
      target_weight: echo.targetWeightKg ?? null,
      starts_on: storedBlock.startsOn,
      ends_on: storedBlock.endsOn,
      updated_at: now,
    });
  }
  suffix.forEach((entry, i) => {
    const row: TablesInsert<"client_phases"> = {
      client_id: clientId,
      name: entry.name,
      focus: entry.focus ?? null,
      target_weight: entry.targetWeightKg ?? null,
      starts_on: windows[i].startsOn,
      ends_on: windows[i].endsOn,
      updated_at: now,
    };
    if (entry.id) {
      updates.push({ ...row, id: entry.id });
    } else {
      inserts.push(row);
    }
  });

  // SECURITY: an upsert cannot carry a tenant filter, and a foreign id in this
  // array would not match zero rows — the DO UPDATE arm would rewrite the
  // foreign row, client_id included, stealing it into this tenant. Every id
  // here has been validated against this client's stored rows (the
  // storedById checks above). Never let an id reach this array straight from
  // a payload. created_at is deliberately absent so the UPDATE arm keeps the
  // row's birth date (PostgREST builds DO UPDATE SET from payload keys).
  if (updates.length > 0) {
    const { error } = await supabaseAdmin
      .from("client_phases")
      .upsert(updates, { onConflict: "id" });
    if (error) {
      console.error("Failed to update blocks:", error);
      throw new Error(`Failed to save blocks: ${error.message}`);
    }
  }
  if (inserts.length > 0) {
    const { error } = await supabaseAdmin.from("client_phases").insert(inserts);
    if (error) {
      console.error("Failed to insert blocks:", error);
      throw new Error(`Failed to save blocks: ${error.message}`);
    }
  }

  return listBlocks(clientId);
};

/**
 * Delete one block. A future block's row is removed and what follows shifts
 * back by its full duration; the current block TRUNCATES at yesterday (its
 * lived days stay attributed — no gap) and the next block starts today; on
 * its own first day it is removed instead (zero lived days; truncating would
 * invert the window — the CHECK constraint's one scenario). Elapsed blocks
 * refuse (belt — the UI never offers it).
 */
export const deleteBlock = async (
  clientId: string,
  clientToday: string,
  blockId: string
): Promise<{
  mode: "removed" | "truncated";
  changes: BlockDateChange[];
  blocks: ClientBlock[];
}> => {
  const stored = await listBlocks(clientId);
  const outcome = computeDeleteShift(stored, blockId, clientToday);
  if (!outcome) {
    throw new UnknownBlockIdError("Block not found");
  }
  if (outcome.kind === "elapsed") {
    throw new ElapsedBlockImmutableError("Past blocks are read-only.");
  }

  const now = new Date().toISOString();
  const storedById = new Map(stored.map((block) => [block.id, block]));
  // SECURITY: same rule as the save upsert above — every id here comes from
  // computeDeleteShift over this client's stored chain, never from a payload.
  const rewrites: TablesInsert<"client_phases">[] = outcome.changes.map(
    (change) => {
      const block = storedById.get(change.id) as ClientBlock;
      return {
        id: block.id,
        client_id: clientId,
        name: block.name,
        focus: block.focus,
        target_weight: block.targetWeightKg,
        starts_on: change.next.startsOn,
        ends_on: change.next.endsOn,
        updated_at: now,
      };
    }
  );

  if (outcome.kind === "truncated") {
    // Truncate + shifted suffix are all UPDATEs to existing rows, issued as
    // ONE statement (INSERT … ON CONFLICT (id) DO UPDATE) — atomic, so the
    // invariant-3-critical path has no partial-failure window.
    const { error } = await supabaseAdmin
      .from("client_phases")
      .upsert(rewrites, { onConflict: "id" });
    if (error) {
      console.error("Failed to truncate block:", error);
      throw new Error(`Failed to delete block: ${error.message}`);
    }
  } else {
    // Remove variant: delete-first, so a failure between the two statements
    // leaves a GAP (the sanctioned post-delete shape) rather than an overlap
    // that would render two current blocks. The next save re-walks the suffix
    // contiguously and heals it; retrying the delete completes it too.
    const { error: deleteError } = await supabaseAdmin
      .from("client_phases")
      .delete()
      .eq("client_id", clientId)
      .eq("id", blockId);
    if (deleteError) {
      console.error("Failed to delete block:", deleteError);
      throw new Error(`Failed to delete block: ${deleteError.message}`);
    }
    if (rewrites.length > 0) {
      const { error } = await supabaseAdmin
        .from("client_phases")
        .upsert(rewrites, { onConflict: "id" });
      if (error) {
        console.error("Failed to shift blocks after delete:", error);
        throw new Error(`Failed to delete block: ${error.message}`);
      }
    }
  }

  const blocks = await listBlocks(clientId);
  return { mode: outcome.kind, changes: outcome.changes, blocks };
};
