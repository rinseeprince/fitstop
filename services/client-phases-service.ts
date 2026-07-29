import { randomUUID } from "crypto";
import { supabaseAdmin } from "./supabase-admin";
import {
  chainPhases,
  isPhaseElapsed,
  weeksBetween,
  type ChainedPhase,
} from "@/lib/goals/phase-chain";
import type { ReplacePhasesInput } from "@/lib/validations/client-phases";

/**
 * Goal blocks (`client_phases`, migration 137).
 *
 * Shape B: the route proves the coach owns the client; every query here filters
 * on the passed `clientId`. Dates are always the CLIENT's calendar — callers pass
 * `clientToday` from `getClientTodayString`, never a server or coach date.
 *
 * Two rules run through everything below:
 *   - Durations in, dates out (invariant 6). Callers send lengths in weeks; this
 *     service computes the chain. There is no overlap validation because overlaps
 *     cannot be expressed.
 *   - Elapsed blocks are read-only (invariant 9), mirroring the amendment
 *     surface's locked-slot rule.
 */

/** One weekday row of a block's generated grid. Five keys, not six — see below. */
export type PhaseDailyTarget = {
  day_of_week: string;
  calories: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
};

export type ClientPhase = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  ratePerWeekKg: number;
  /**
   * The block's 7-row weekday grid, or null when it has not been generated for
   * these exact dates and this exact rate. Non-null is a promise that the grid
   * matches the window above; any date or rate edit clears it (see
   * `carryDailyTargets`), so a stale grid can never be read as current.
   *
   * `is_training_day` is deliberately absent: that is a per-DATE fact derived
   * from live training events, and a weekday-keyed field cannot carry it.
   */
  dailyTargets: PhaseDailyTarget[] | null;
};

/** A block's dates changed, or the coach tried to touch an elapsed one. */
export class PhaseWriteError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "PhaseWriteError";
  }
}

const PHASE_COLUMNS =
  "id, name, starts_on, ends_on, rate_per_week_kg, daily_targets";

type PhaseRow = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  rate_per_week_kg: number;
  daily_targets: unknown;
};

function mapPhaseRow(row: PhaseRow): ClientPhase {
  return {
    id: row.id,
    name: row.name,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    ratePerWeekKg: Number(row.rate_per_week_kg),
    // JSONB arrives untyped. The shape is guaranteed by the only writer (task
    // 2.6) plus the table's cardinality CHECK; nothing user-supplied reaches it.
    dailyTargets: (row.daily_targets as PhaseDailyTarget[] | null) ?? null,
  };
}

/** A client's blocks in chain order. Ordered by `starts_on` — the one ordering source. */
export async function getClientPhases(clientId: string): Promise<ClientPhase[]> {
  const { data, error } = await supabaseAdmin
    .from("client_phases")
    .select(PHASE_COLUMNS)
    .eq("client_id", clientId)
    .order("starts_on", { ascending: true });

  if (error) {
    console.error("Failed to fetch client phases:", error);
    throw new Error(`Failed to fetch blocks: ${error.message}`);
  }
  return (data ?? []).map((row) => mapPhaseRow(row as PhaseRow));
}

/**
 * A generated grid is only valid for the window and rate it was computed against,
 * so it survives a rename and nothing else. Clearing it on any numeric edit is
 * what makes "non-null grid" trustworthy for the per-date resolver.
 */
function carryDailyTargets(
  existing: ClientPhase | undefined,
  next: ChainedPhase
): PhaseDailyTarget[] | null {
  if (!existing || !existing.dailyTargets) return null;
  const unchanged =
    existing.startsOn === next.startsOn &&
    existing.endsOn === next.endsOn &&
    existing.ratePerWeekKg === next.ratePerWeekKg;
  return unchanged ? existing.dailyTargets : null;
}

/**
 * Replace the client's block list.
 *
 * Elapsed blocks are neither rewritten nor deleted: they are validated to be
 * present and unmoved, then left alone entirely (they are not even included in
 * the write, so their `updated_at` does not move). Everything from the first
 * live block onward is replaced.
 *
 * Two round trips, both batched — one DELETE over the removed ids, one upsert
 * over the whole live list. Nothing loops a query per block.
 */
export async function replaceClientPhases(
  clientId: string,
  input: ReplacePhasesInput,
  clientToday: string
): Promise<ClientPhase[]> {
  const existing = await getClientPhases(clientId);
  const existingById = new Map(existing.map((p) => [p.id, p]));
  const chained = chainPhases(input.startDate, input.phases);

  for (const phase of input.phases) {
    if (phase.id && !existingById.has(phase.id)) {
      throw new PhaseWriteError("That block no longer exists", 404);
    }
  }

  // Elapsed blocks must arrive unchanged and in place. Checking the COMPUTED
  // dates (not the submitted ones) is the point: the client sends lengths, so a
  // shortened earlier block would silently drag an elapsed one backwards.
  const chainedById = new Map(chained.map((c) => [c.id ?? "", c]));
  for (const phase of existing) {
    if (!isPhaseElapsed(phase, clientToday)) continue;
    const submitted = chainedById.get(phase.id);
    if (!submitted) {
      throw new PhaseWriteError(
        `"${phase.name}" has already finished and cannot be removed`,
        422
      );
    }
    if (submitted.startsOn !== phase.startsOn || submitted.endsOn !== phase.endsOn) {
      throw new PhaseWriteError(
        `"${phase.name}" has already finished and its dates cannot change`,
        422
      );
    }
  }

  const keptIds = new Set(chained.map((c) => c.id).filter(Boolean) as string[]);
  const removedIds = existing.filter((p) => !keptIds.has(p.id)).map((p) => p.id);

  if (removedIds.length > 0) {
    const { error } = await supabaseAdmin
      .from("client_phases")
      .delete()
      .eq("client_id", clientId)
      .in("id", removedIds);

    if (error) {
      console.error("Failed to remove blocks:", error);
      throw new Error(`Failed to remove blocks: ${error.message}`);
    }
  }

  // Elapsed rows are excluded from the write entirely; they were validated as
  // unchanged above. Every row carries an explicit id so this is ONE statement:
  // a mixed insert/update upsert needs identical keys across the array.
  const live = chained.filter(
    (c) => !isPhaseElapsed({ startsOn: c.startsOn, endsOn: c.endsOn }, clientToday)
  );

  if (live.length > 0) {
    const now = new Date().toISOString();
    const rows = live.map((c) => ({
      id: c.id ?? randomUUID(),
      client_id: clientId,
      name: c.name,
      starts_on: c.startsOn,
      ends_on: c.endsOn,
      rate_per_week_kg: c.ratePerWeekKg,
      daily_targets: carryDailyTargets(
        c.id ? existingById.get(c.id) : undefined,
        c
      ),
      // updated_at has no trigger on this table (migration 137, matching 132/134).
      // Every UPDATE must stamp it or it stays frozen at insert time.
      updated_at: now,
    }));

    const { error } = await supabaseAdmin
      .from("client_phases")
      .upsert(rows, { onConflict: "id" });

    if (error) {
      console.error("Failed to save blocks:", error);
      throw new Error(`Failed to save blocks: ${error.message}`);
    }
  }

  return getClientPhases(clientId);
}

export type PhaseDeletionResult = {
  deletedName: string;
  /** Blocks whose dates moved as a result, for the confirm dialog's sentence. */
  shifted: Array<{ id: string; name: string; startsOn: string; endsOn: string }>;
  phases: ClientPhase[];
};

/**
 * Remove one block and shift the rest of the chain back into the gap.
 *
 * Deleting regenerates, never wipes (invariant 9): blocks before the deleted one
 * keep their dates, blocks after it move earlier by its length, and the caller
 * gets the resulting moves so the coach can be told what will happen before they
 * confirm.
 */
export async function deleteClientPhase(
  clientId: string,
  phaseId: string,
  clientToday: string
): Promise<PhaseDeletionResult> {
  const existing = await getClientPhases(clientId);
  const target = existing.find((p) => p.id === phaseId);

  if (!target) {
    throw new PhaseWriteError("That block no longer exists", 404);
  }
  if (isPhaseElapsed(target, clientToday)) {
    throw new PhaseWriteError(
      `"${target.name}" has already finished and cannot be removed`,
      422
    );
  }

  const remaining = existing.filter((p) => p.id !== phaseId);
  if (remaining.length === 0) {
    const { error } = await supabaseAdmin
      .from("client_phases")
      .delete()
      .eq("client_id", clientId)
      .eq("id", phaseId);

    if (error) {
      console.error("Failed to remove block:", error);
      throw new Error(`Failed to remove block: ${error.message}`);
    }
    return { deletedName: target.name, shifted: [], phases: [] };
  }

  // Re-chain from the original start with the same lengths. Blocks before the
  // deleted one are unmoved by construction; blocks after it close the gap.
  const startDate = existing[0].startsOn;
  const lengths = remaining.map((p) => ({
    id: p.id,
    name: p.name,
    weeks: weeksBetween(p.startsOn, p.endsOn),
    ratePerWeekKg: p.ratePerWeekKg,
  }));

  const rechained = chainPhases(startDate, lengths);
  const shifted = rechained
    .filter((c) => {
      const before = existing.find((p) => p.id === c.id);
      return before && before.startsOn !== c.startsOn;
    })
    .map((c) => ({
      id: c.id,
      name: c.name,
      startsOn: c.startsOn,
      endsOn: c.endsOn,
    }));

  const phases = await replaceClientPhases(
    clientId,
    { startDate, phases: lengths },
    clientToday
  );

  return { deletedName: target.name, shifted, phases };
}

/**
 * Store each block's generated weekday grid on `client_phases.daily_targets`.
 *
 * One batched upsert, never a statement per block — the round trip count is
 * constant however long the chain is (`MAX_PHASES` = 12).
 *
 * Every row carries its full current column set rather than a partial patch:
 * PostgREST builds ONE insert with a single column list, so a partial upsert
 * would null the columns it omits. The caller passes rows it has just read.
 *
 * A non-null grid is a PROMISE that it matches the block's window and rate —
 * `carryDailyTargets` clears it on any date or rate edit — so this must only ever
 * be called with grids computed against the blocks' current values.
 */
export async function writePhaseDailyTargets(
  clientId: string,
  grids: Array<{ phaseId: string; dailyTargets: PhaseDailyTarget[] }>
): Promise<void> {
  if (grids.length === 0) return;

  const existing = await getClientPhases(clientId);
  const byId = new Map(existing.map((p) => [p.id, p]));
  const now = new Date().toISOString();

  const rows = grids
    .map(({ phaseId, dailyTargets }) => {
      const phase = byId.get(phaseId);
      if (!phase) return null;
      return {
        id: phase.id,
        client_id: clientId,
        name: phase.name,
        starts_on: phase.startsOn,
        ends_on: phase.endsOn,
        rate_per_week_kg: phase.ratePerWeekKg,
        daily_targets: dailyTargets,
        updated_at: now,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return;

  const { error } = await supabaseAdmin
    .from("client_phases")
    .upsert(rows, { onConflict: "id" });

  if (error) {
    console.error("Failed to write phase daily targets:", error);
    throw new Error(`Failed to store block targets: ${error.message}`);
  }
}
