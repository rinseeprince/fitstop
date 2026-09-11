import { supabaseAdmin } from "./supabase-admin";
import { captureApiError } from "@/lib/error-handler";
import { inclusiveDays, DAYS_PER_BLOCK_WEEK } from "@/lib/blocks/block-chain";
import { BLOCK_EXTENSION_REFUSED, BLOCK_WEEKS_MAX } from "@/lib/constants";
import type { TablesInsert } from "@/types/database";
import type { ClientBlock, ReplaceBlockChainInput } from "@/types/client-blocks";
import { fetchAllByChunkedIds } from "@/lib/paged-fetch";
import type { ClientBlockWindow } from "@/lib/prescription-triggers";

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
 * Every block owns its own window (migration 164): the caller sends BOTH
 * dates for each current or future block, gaps are allowed and overlaps are
 * refused here and by the database. Elapsed blocks (ends_on < clientToday)
 * keep their DATES as read-only history — their name and focus stay
 * editable (3.6-C) — the symmetric window floor keeps every edit from
 * re-labelling lived days, and a stored block's end moves EARLIER or not at
 * all: more time is a new block after it, never a later end on this one.
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
  starts_on: string;
  ends_on: string;
  archived_at: string | null;
};

const BLOCK_COLUMNS =
  "id, name, focus, starts_on, ends_on, archived_at";

function mapBlockRow(row: BlockRow): ClientBlock {
  return {
    id: row.id,
    name: row.name,
    focus: row.focus,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    archivedAt: row.archived_at,
  };
}

/**
 * Every non-archived block's name and window for a set of clients, in one
 * chunked read — the attention feed's, so a prescription-ending alert can name
 * the block its stop falls in. Context only: nothing here bounds anything, and
 * the feed's message is the plain form for a client with no block covering the
 * day. `archived_at IS NULL` is written rather than inherited, as the covering
 * read below says.
 */
export const getBlockWindowsForClients = async (
  clientIds: string[]
): Promise<ClientBlockWindow[]> => {
  const rows = await fetchAllByChunkedIds<
    { id: string; client_id: string; name: string; starts_on: string; ends_on: string },
    string
  >(
    clientIds,
    (chunk, from, to) =>
      supabaseAdmin
        .from("client_phases")
        .select("id, client_id, name, starts_on, ends_on")
        .in("client_id", chunk)
        .is("archived_at", null)
        .order("client_id", { ascending: true })
        .order("starts_on", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    { errorLabel: "journey blocks" }
  );
  return rows.map((row) => ({
    clientId: row.client_id,
    name: row.name,
    start: row.starts_on,
    end: row.ends_on,
  }));
};

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

/**
 * What a block says about a plan placed on `date`, or null when no block does:
 *
 * - `covering` — the block CONTAINING `date`, whose last day IS the window. A
 *   program placed inside a two-week block stops after two weeks even when the
 *   next block runs twelve, and nutrition stops at the same day — that next
 *   block is its own prescription, with its own placement and its own plan
 *   save, each of which resolves this again from inside it.
 * - `next` — no block covers `date`; the first block AFTER it, whose start is a
 *   CAP on the caller's own fallback, never a length. A plan placed in a gap
 *   keeps its authored length and stops the day before the block, so it can
 *   never run into a block the coach has not set up (its card would claim it,
 *   and setting the block up later would leave the plan's tail past the block).
 *
 * The ONE block-bound question, asked by both generators: the training placement
 * and the nutrition placement end. One read answers both arms: blocks never
 * overlap, so the earliest-starting block that ends on or after `date` either
 * contains it or is the next one.
 *
 * `archived_at IS NULL` is redundant given only an ELAPSED block can be archived
 * (setBlockArchived), but it is written rather than inherited, so this read does
 * not silently depend on a rule enforced in another function.
 *
 * Degrades to null on a read error (logged, Sentried) rather than throwing: both
 * callers fall back to what they did before blocks bounded anything — the
 * program's authored length, and the program-then-fixed-window chain. A
 * generation that quietly covers less is self-healing on the next one; a coach's
 * write failing outright after it has already committed is not.
 */
type BlockBound =
  | { kind: "covering"; endsOn: string }
  | { kind: "next"; startsOn: string };

export const getBlockBoundForDate = async (
  clientId: string,
  date: string
): Promise<BlockBound | null> => {
  const { data, error } = await supabaseAdmin
    .from("client_phases")
    .select("starts_on, ends_on")
    .eq("client_id", clientId)
    .is("archived_at", null)
    .gte("ends_on", date)
    .order("starts_on", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Failed to read the block bound for a date:", error);
    captureApiError(error, { action: "block-bound-for-date", clientId });
    return null;
  }
  if (!data) return null;
  return data.starts_on <= date
    ? { kind: "covering", endsOn: data.ends_on }
    : { kind: "next", startsOn: data.starts_on };
};

const isCurrent = (block: ClientBlock, today: string): boolean =>
  block.startsOn <= today && today <= block.endsOn;

/**
 * Replace the client's whole set of blocks. Every block carries its OWN window
 * (migration 164): a coach picks both dates, GAPS are allowed and mean nothing
 * is planned, and OVERLAPS are refused here and by a database constraint. A
 * stored block's end moves earlier or not at all — more time is a new block
 * after it (below).
 *
 * Removal is NOT expressible here — an existing non-elapsed id missing from the
 * payload is a 422, because DELETE owns removal.
 *
 * The payload carries every stored row (elapsed lead it, the rest must be
 * present), so checking the payload's windows against each other IS checking
 * them against the client's whole calendar; no second read is needed.
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
  // same ids, same order, dates from STORAGE. Its name and focus are
  // editable (Session 3.6-C): the pin protects lived-day ATTRIBUTION, not
  // typos in a finished block's label.
  const elapsedEdits: { echo: (typeof input.blocks)[number]; storedBlock: ClientBlock }[] = [];
  elapsed.forEach((storedBlock, i) => {
    const echo = input.blocks[i];
    if (!echo || echo.id !== storedBlock.id) {
      throw new ElapsedBlockImmutableError(
        "Past blocks are read-only and must lead the chain unchanged."
      );
    }
    if (
      (echo.startsOn !== undefined && echo.startsOn !== storedBlock.startsOn) ||
      (echo.endsOn !== undefined && echo.endsOn !== storedBlock.endsOn)
    ) {
      throw new ElapsedBlockImmutableError("Past blocks' dates can't change.");
    }
    if (
      echo.name !== storedBlock.name ||
      (echo.focus ?? null) !== storedBlock.focus
    ) {
      elapsedEdits.push({ echo, storedBlock });
    }
  });

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
    if (entry.startsOn === undefined || entry.endsOn === undefined) {
      throw new BlockPayloadError(
        "Current and future blocks need a start date and an end date."
      );
    }
  }

  const payloadIds = new Set(
    input.blocks.flatMap((entry) => (entry.id ? [entry.id] : []))
  );
  for (const block of stored) {
    if (block.endsOn >= clientToday && !payloadIds.has(block.id)) {
      throw new BlockPayloadError(
        "Removing a block goes through its delete action."
      );
    }
  }

  const windows = suffix.map((entry) => ({
    startsOn: entry.startsOn as string,
    endsOn: entry.endsOn as string,
  }));

  // Per-window shape. Both dates come from the coach now, so an inverted or
  // over-long window is a payload error rather than a consequence of the walk.
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

  // No two blocks may claim a day. GAPS between them are fine and deliberate —
  // a client between programs has nothing planned, and both generators read
  // that as "no bound", falling back to the program and then to a fixed window.
  // An OVERLAP is never fine: "the block covering this date" decides the
  // training placement window and the nutrition horizon, and with two answers
  // it resolves arbitrarily. The database refuses it too (migration 164); this
  // check exists so the coach gets a sentence naming the blocks instead of a
  // constraint violation.
  const allWindows = [
    ...elapsed.map((block) => ({ name: block.name, startsOn: block.startsOn, endsOn: block.endsOn })),
    ...windows.map((window, i) => ({ name: suffix[i].name, ...window })),
  ].sort((a, b) => a.startsOn.localeCompare(b.startsOn));

  for (let i = 1; i < allWindows.length; i += 1) {
    const previous = allWindows[i - 1];
    const current = allWindows[i];
    if (current.startsOn <= previous.endsOn) {
      throw new BlockWindowError(
        `"${current.name}" overlaps "${previous.name}". Blocks can sit apart, but they can't share a day.`
      );
    }
  }

  // An edit never re-labels lived days. A stored current block must still
  // contain today; a stored future block may become current but never wholly
  // past; and a NEW block may not open in the past at all — a past-dated block
  // generates nothing (both placement and the nutrition save refuse a past
  // date), so it would be a label over days it could never have prescribed.
  suffix.forEach((entry, i) => {
    const window = windows[i];
    if (!entry.id) {
      if (window.startsOn < clientToday) {
        throw new BlockWindowError("A new block can't start in the past.");
      }
      return;
    }
    const storedBlock = storedById.get(entry.id) as ClientBlock;
    if (isCurrent(storedBlock, clientToday)) {
      if (window.startsOn > clientToday || window.endsOn < clientToday) {
        throw new BlockWindowError(
          "The block in progress must still cover today. To end it now, delete it."
        );
      }
    } else if (window.endsOn < clientToday) {
      throw new BlockWindowError(
        "A scheduled block can't be moved entirely into the past."
      );
    }
    // A stored block's end moves EARLIER or not at all (owner decision
    // 2026-09-10). More time is a NEW block after it — a dated, named record
    // of the decision, with its own program and targets — so a later end is
    // refused for current and future blocks alike, dates-only included. The
    // form caps its Ends field at the stored end; this is the belt behind it.
    // An earlier end is the shorten, which stays.
    if (window.endsOn > storedBlock.endsOn) {
      throw new BlockWindowError(BLOCK_EXTENSION_REFUSED);
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
 * Delete one block: the row goes and NOTHING else moves.
 *
 * Blocks own their own windows (migration 164), so there is no chain to
 * re-anchor — deleting one leaves a gap, which is a real state meaning nothing
 * is planned for those days. That is the whole operation: no shift, no
 * truncation, no consequence sentence to preview.
 *
 * Elapsed blocks refuse (belt — the UI never offers it): a finished block is
 * the record of days the client lived, and archiving is how it leaves the list.
 *
 * The block's training and nutrition events are deliberately left alone. A
 * block edit writes nothing on its own; clearing the events is a separate,
 * explicit act.
 */
export const deleteBlock = async (
  clientId: string,
  clientToday: string,
  blockId: string
): Promise<{ blocks: ClientBlock[] }> => {
  const stored = await listBlocks(clientId);
  const target = stored.find((block) => block.id === blockId);
  if (!target) {
    throw new UnknownBlockIdError("Block not found");
  }
  if (target.endsOn < clientToday) {
    throw new ElapsedBlockImmutableError("Past blocks are read-only.");
  }

  const { error } = await supabaseAdmin
    .from("client_phases")
    .delete()
    .eq("client_id", clientId)
    .eq("id", blockId);
  if (error) {
    console.error("Failed to delete block:", error);
    throw new Error(`Failed to delete block: ${error.message}`);
  }

  return { blocks: await listBlocks(clientId) };
};

/**
 * Archive (or restore) one ELAPSED block — curation of the presented journey
 * (Session 3.7; client-facing since Session 4): the block leaves the coach's
 * main Journey list AND the client journey payload (GET /api/client/journey
 * filters it server-side), surviving in the Archive view and the chart bands,
 * which render every block forever. No date derivation consults archived_at,
 * the chain contracts keep seeing every block, and un-archiving is always
 * legal (an archived block was elapsed when archived, and elapsed is
 * permanent). A current or future block refuses — hiding live or upcoming
 * context is a footgun, not decluttering.
 */
export const setBlockArchived = async (
  clientId: string,
  clientToday: string,
  blockId: string,
  archived: boolean
): Promise<ClientBlock[]> => {
  const { data, error } = await supabaseAdmin
    .from("client_phases")
    .select(BLOCK_COLUMNS)
    .eq("client_id", clientId)
    .eq("id", blockId)
    .maybeSingle();

  if (error) {
    console.error("Failed to read block for archive:", error);
    throw new Error(`Failed to archive block: ${error.message}`);
  }
  if (!data) {
    throw new UnknownBlockIdError("Block not found");
  }
  const block = mapBlockRow(data as BlockRow);
  if (archived && block.endsOn >= clientToday) {
    throw new BlockWindowError("Only completed blocks can be archived.");
  }

  const { error: updateError } = await supabaseAdmin
    .from("client_phases")
    .update({
      archived_at: archived ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("client_id", clientId)
    .eq("id", blockId);

  if (updateError) {
    console.error("Failed to archive block:", updateError);
    throw new Error(`Failed to archive block: ${updateError.message}`);
  }

  return listBlocks(clientId);
};
