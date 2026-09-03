import { supabaseAdmin } from "./supabase-admin";
import { recalculateClientEnergy } from "./client-energy-service";
import { fetchAllByChunkedIds, fetchAllPages } from "@/lib/paged-fetch";
import {
  MEASUREMENT_KEYS,
  isMeasurementKey,
  type MeasurementKey,
  type MeasurementSource,
  type MeasurementValues,
} from "@/lib/measurements/keys";
import {
  dayValues,
  type DayValue,
  type MeasurementReading,
} from "@/lib/measurements/day-values";
import type { Database } from "@/types/database";

/**
 * The measurement log (docs/MEASUREMENT-LOG-PLAN.md §2): every body measurement
 * is one row in `client_measurements`, and this is the ONE module that writes
 * it and the one place its rules are spelled.
 *
 *  - Append-only. The app role holds SELECT and INSERT; nothing here updates
 *    or deletes. A wrong value is CORRECTED — a new row on the same day
 *    carrying the original's stamp (`appendCorrection`) — and a reading that
 *    should never have existed is REMOVED: a void mark set through the RPC
 *    pair of migration 160 (`services/measurement-edits-service.ts`), the one
 *    UPDATE the table ever sees, and cleared the same way when restored.
 *  - The value for a day is the latest row by `recorded_at`
 *    (`lib/measurements/day-values.ts`, rule 2).
 *  - A writer appends only on change (rule 3): a value equal to the day's
 *    standing value for the same source and stamp is not written again, which
 *    is what ends the phantom duplicates the entries dual-write produced.
 *  - No cache. "Now" is `client_current_measurements`, the baseline is
 *    `client_baseline_measurements` (the reading as of `clients.start_date`),
 *    both views over the live rows. The energy pair recomputes when an
 *    appended row is the client's newest weight or body fat — the same event
 *    the cache update used to be.
 *
 * Every calculation reads `client_measurements_live`, never the table, so the
 * void filter lives in one place and a removed row leaves every figure and
 * every client surface at once. The table is read here alone, for the coach's
 * measurement list (`getMeasurementReadings`) and the row an edit acts on
 * (`getMeasurementReading`) — the two readers that must see a removed row.
 *
 * Canonical units in, canonical units out (CONVENTIONS §20).
 */

type CurrentRow = Database["public"]["Views"]["client_current_measurements"]["Row"];
type BaselineRow = Database["public"]["Views"]["client_baseline_measurements"]["Row"];

const READING_COLUMNS =
  "id, metric_key, value, recorded_on, recorded_at, measured_at, source, source_id, note";

/**
 * The PostgREST embed that fills a `Client`'s four reading fields from the two
 * views in the same round trip as the row — `clients` → the views resolve
 * through `client_measurements.client_id`'s FK (relationship inference through
 * a view over a view was probed on DEV before this shipped).
 */
export const CLIENT_MEASUREMENT_EMBEDS =
  "client_current_measurements(metric_key, value, recorded_on, source, measurement_id), " +
  "client_baseline_measurements(metric_key, value, recorded_on, source, measurement_id)";

/** A reading standing for the client right now, or at their start. */
export type StandingReading = {
  id: string;
  metricKey: MeasurementKey;
  value: number;
  /** YYYY-MM-DD, the client's calendar day. */
  date: string;
  source: MeasurementSource;
};

/**
 * Thrown when a profile save asks to withdraw a reading. The profile is not a
 * reading writer: a wrong reading is corrected or removed on the Journey's
 * measurement log, where the coach sees WHICH row they are acting on, so the
 * sheet answers with a sentence rather than a save that silently kept the
 * value.
 */
export class ReadingRemovalUnavailableError extends Error {
  constructor(what: string) {
    super(
      `A recorded ${what} can't be removed here — change it, or remove the reading from the Journey's measurement log.`
    );
    this.name = "ReadingRemovalUnavailableError";
  }
}

type AppendMeasurementsInput = {
  clientId: string;
  source: MeasurementSource;
  /** The check-in id for source `check_in`; null otherwise. */
  sourceId?: string | null;
  /** YYYY-MM-DD, the day the reading belongs to on the client's calendar. */
  recordedOn: string;
  /** ISO instant the reading was TAKEN. Omit when only the day is known. */
  measuredAt?: string | null;
  values: MeasurementValues;
  note?: string | null;
  /** `coaches.id` for a coach entry — the audit actor id. */
  createdBy?: string | null;
};

type AppendMeasurementsResult = {
  /** One entry per written key: the row now standing for that reading. */
  rows: Partial<Record<MeasurementKey, MeasurementReading>>;
  inserted: MeasurementKey[];
  /** Keys whose value equalled the day's standing value for this source and stamp. */
  unchanged: MeasurementKey[];
  energy: "recomputed" | "not_newest" | "nothing_inserted";
};

/** The columns READING_COLUMNS selects, as the live view types them (every
 *  column nullable — a view's types carry no NOT NULL) and as the table does. */
type LiveReadingRow = Pick<
  Database["public"]["Views"]["client_measurements_live"]["Row"],
  "id" | "metric_key" | "value" | "recorded_on" | "recorded_at" | "measured_at" | "source" | "source_id" | "note"
>;

function toReading(row: LiveReadingRow): MeasurementReading | null {
  if (
    row.id == null ||
    row.metric_key == null ||
    !isMeasurementKey(row.metric_key) ||
    row.value == null ||
    row.recorded_on == null ||
    row.recorded_at == null ||
    row.source == null
  ) {
    return null;
  }
  return {
    id: row.id,
    metricKey: row.metric_key,
    value: Number(row.value),
    date: row.recorded_on,
    recordedAt: row.recorded_at,
    measuredAt: row.measured_at,
    source: row.source as MeasurementSource,
    sourceId: row.source_id,
    note: row.note,
  };
}

function toReadings(rows: readonly LiveReadingRow[] | null | undefined): MeasurementReading[] {
  return (rows ?? []).flatMap((row) => {
    const reading = toReading(row);
    return reading ? [reading] : [];
  });
}

function toStanding(row: CurrentRow | BaselineRow): StandingReading | null {
  if (
    row.measurement_id == null ||
    row.metric_key == null ||
    row.value == null ||
    row.recorded_on == null ||
    row.source == null ||
    !isMeasurementKey(row.metric_key)
  ) {
    return null;
  }
  return {
    id: row.measurement_id,
    metricKey: row.metric_key,
    value: Number(row.value),
    date: row.recorded_on,
    source: row.source as MeasurementSource,
  };
}

function presentKeys(values: MeasurementValues): MeasurementKey[] {
  return MEASUREMENT_KEYS.filter((key) => {
    const value = values[key];
    return typeof value === "number" && Number.isFinite(value);
  });
}

/**
 * Append readings for one client, one source, one day. Rules 1–3, and the
 * energy recompute when a written row is the client's newest weight or body
 * fat. Throws on a failed write: a reading the client typed must never be
 * lost silently, so the caller decides how loudly to fail.
 */
export async function appendMeasurements(
  input: AppendMeasurementsInput
): Promise<AppendMeasurementsResult> {
  const keys = presentKeys(input.values);
  const empty: AppendMeasurementsResult = {
    rows: {},
    inserted: [],
    unchanged: [],
    energy: "nothing_inserted",
  };
  if (keys.length === 0) return empty;

  // Rule 3: the day's standing value for the same source and stamp. A stamp
  // in the key is deliberate — a check-in resubmitted on a day whose earlier
  // check-in was deleted must still get its own rows, or it reports nothing.
  const sourceId = input.sourceId ?? null;
  let standingQuery = supabaseAdmin
    .from("client_measurements_live")
    .select(READING_COLUMNS)
    .eq("client_id", input.clientId)
    .eq("recorded_on", input.recordedOn)
    .eq("source", input.source)
    .in("metric_key", keys)
    .order("recorded_at", { ascending: false })
    .order("id", { ascending: false });
  standingQuery = sourceId
    ? standingQuery.eq("source_id", sourceId)
    : standingQuery.is("source_id", null);

  const { data: standingRows, error: standingError } = await standingQuery;
  if (standingError) {
    console.error("Failed to read the day's measurements:", standingError);
    throw new Error(`Failed to read measurements: ${standingError.message}`);
  }

  const standing = new Map<MeasurementKey, MeasurementReading>();
  for (const reading of toReadings(standingRows)) {
    if (!standing.has(reading.metricKey)) standing.set(reading.metricKey, reading);
  }

  const rows: AppendMeasurementsResult["rows"] = {};
  const unchanged: MeasurementKey[] = [];
  const toInsert: Database["public"]["Tables"]["client_measurements"]["Insert"][] = [];
  for (const key of keys) {
    const value = input.values[key] as number;
    const current = standing.get(key);
    if (current && current.value === value) {
      unchanged.push(key);
      rows[key] = current;
      continue;
    }
    toInsert.push({
      client_id: input.clientId,
      metric_key: key,
      value,
      recorded_on: input.recordedOn,
      measured_at: input.measuredAt ?? null,
      source: input.source,
      source_id: sourceId,
      note: input.note ?? null,
      created_by: input.createdBy ?? null,
    });
  }

  if (toInsert.length === 0) return { ...empty, rows, unchanged };

  const insertedReadings = await insertReadings(toInsert);
  const inserted: MeasurementKey[] = [];
  for (const reading of insertedReadings) {
    rows[reading.metricKey] = reading;
    inserted.push(reading.metricKey);
  }

  const energy = await recomputeEnergyIfNewest(input.clientId, insertedReadings);
  return { rows, inserted, unchanged, energy };
}

type ReadingInsert = Database["public"]["Tables"]["client_measurements"]["Insert"];

/** The one INSERT statement: every row in one round trip, never one per key. */
async function insertReadings(rows: ReadingInsert[]): Promise<MeasurementReading[]> {
  const { data, error } = await supabaseAdmin
    .from("client_measurements")
    .insert(rows)
    .select(READING_COLUMNS);
  if (error || !data) {
    console.error("Failed to record measurements:", error);
    throw new Error(`Failed to record measurements: ${error?.message ?? "no rows"}`);
  }
  return toReadings(data);
}

/**
 * The energy pair follows the client's NEWEST weight and body fat, of any
 * source and by the client's calendar — a backdated row that is not the
 * newest recomputes nothing, which is the rule the cache guard used to hold.
 * Removing or restoring a reading fires the same recompute on the RPC's word
 * (`services/measurement-edits-service.ts`). Girths feed no formula and never
 * consult the current view.
 */
async function recomputeEnergyIfNewest(
  clientId: string,
  written: readonly MeasurementReading[]
): Promise<"recomputed" | "not_newest"> {
  const energyIds = new Set(
    written
      .filter((reading) => reading.metricKey === "weight" || reading.metricKey === "bodyFat")
      .map((reading) => reading.id)
  );
  if (energyIds.size === 0) return "not_newest";

  const { data: current, error } = await supabaseAdmin
    .from("client_current_measurements")
    .select("metric_key, measurement_id")
    .eq("client_id", clientId)
    .in("metric_key", ["weight", "bodyFat"]);
  if (error) {
    console.error("Failed to read the client's current measurements:", error);
    throw new Error(`Failed to read current measurements: ${error.message}`);
  }
  const isNewest = (current ?? []).some(
    (row) => row.measurement_id != null && energyIds.has(row.measurement_id)
  );
  if (!isNewest) return "not_newest";

  await recalculateClientEnergy(clientId);
  return "recomputed";
}

type AppendCorrectionInput = {
  clientId: string;
  /** The reading being corrected: its metric, day, stamp and moment are copied. */
  original: Pick<MeasurementReading, "metricKey" | "date" | "sourceId" | "measuredAt">;
  /** Canonical, already checked against the metric's bounds. */
  value: number;
  /** `coaches.id` — the corrector, the audit actor. */
  actor: string;
};

type AppendCorrectionResult = {
  /** The row now standing for the reading — the correction, or what already stood. */
  reading: MeasurementReading;
  inserted: boolean;
  energy: "recomputed" | "not_newest";
};

/**
 * A correction: a new `coach_entry` row carrying the original's metric, day
 * and stamp, so rule 2 makes it the day's value and the check-in fold reads it
 * as the check-in's reading; the original stays in the history.
 *
 * Its rule 3 compares against the reading's STANDING value — the latest live
 * row of any source in the same day and stamp scope — not the same-source key
 * `appendMeasurements` keys on. A correction exists to replace the standing
 * value: a coach entry from earlier in the day equal to the new value must
 * not make the correction of a later client log a no-op, and a correction
 * equal to what already stands has nothing to do.
 *
 * `measured_at` is copied: the reading was TAKEN at that moment, only its
 * number was wrong — and D10's future "latest measured_at wins, null first"
 * would otherwise sort the correction under the original.
 */
export async function appendCorrection(
  input: AppendCorrectionInput
): Promise<AppendCorrectionResult> {
  const { original } = input;
  let standingQuery = supabaseAdmin
    .from("client_measurements_live")
    .select(READING_COLUMNS)
    .eq("client_id", input.clientId)
    .eq("metric_key", original.metricKey)
    .eq("recorded_on", original.date)
    .order("recorded_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  standingQuery = original.sourceId
    ? standingQuery.eq("source_id", original.sourceId)
    : standingQuery.is("source_id", null);

  const { data, error } = await standingQuery;
  if (error) {
    console.error("Failed to read the reading's standing value:", error);
    throw new Error(`Failed to read measurements: ${error.message}`);
  }
  const standing = toReadings(data)[0] ?? null;
  if (standing && standing.value === input.value) {
    return { reading: standing, inserted: false, energy: "not_newest" };
  }

  const [reading] = await insertReadings([
    {
      client_id: input.clientId,
      metric_key: original.metricKey,
      value: input.value,
      recorded_on: original.date,
      measured_at: original.measuredAt,
      source: "coach_entry",
      source_id: original.sourceId,
      note: null,
      created_by: input.actor,
    },
  ]);
  if (!reading) throw new Error("Failed to record the correction: no row");

  const energy = await recomputeEnergyIfNewest(input.clientId, [reading]);
  return { reading, inserted: true, energy };
}

type MeasurementSeriesOptions = {
  metricKeys?: readonly MeasurementKey[];
  /** YYYY-MM-DD, inclusive. */
  from?: string;
  /** YYYY-MM-DD, inclusive. */
  to?: string;
};

/**
 * Day-values by rule 2, per metric, ascending by day. Every requested metric is
 * present, with an empty series when the client has never had that reading.
 * Paged: it feeds aggregates and must be complete past PostgREST's row cap.
 */
export async function getMeasurementSeries(
  clientId: string,
  options: MeasurementSeriesOptions = {}
): Promise<Map<MeasurementKey, DayValue[]>> {
  const keys = options.metricKeys ?? MEASUREMENT_KEYS;
  const rows = await fetchAllPages<LiveReadingRow>(
    (from, to) => {
      let query = supabaseAdmin
        .from("client_measurements_live")
        .select(READING_COLUMNS)
        .eq("client_id", clientId)
        .in("metric_key", [...keys])
        .order("recorded_on", { ascending: true })
        .order("recorded_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      if (options.from) query = query.gte("recorded_on", options.from);
      if (options.to) query = query.lte("recorded_on", options.to);
      return query;
    },
    { errorLabel: "measurements" }
  );

  const series = dayValues(toReadings(rows));
  for (const key of keys) if (!series.has(key)) series.set(key, []);
  return series;
}

/**
 * What each check-in reported: the latest live row per (stamp, metric),
 * whatever its source — a later correction carries the check-in's stamp and
 * replaces the original in the report. Empty input costs no query.
 */
export async function getMeasurementsForCheckIns(
  checkInIds: readonly string[]
): Promise<Map<string, MeasurementValues>> {
  const out = new Map<string, MeasurementValues>();
  if (checkInIds.length === 0) return out;

  type StampedRow = Pick<LiveReadingRow, "id" | "metric_key" | "value" | "source_id" | "recorded_at">;
  const rows = await fetchAllByChunkedIds<StampedRow, string>(
    [...checkInIds],
    (chunk, from, to) =>
      supabaseAdmin
        .from("client_measurements_live")
        .select("id, metric_key, value, source_id, recorded_at")
        .in("source_id", chunk)
        .order("recorded_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    { errorLabel: "check-in measurements" }
  );

  for (const row of rows) {
    if (row.source_id == null || row.metric_key == null || row.value == null) continue;
    if (!isMeasurementKey(row.metric_key)) continue;
    let values = out.get(row.source_id);
    if (!values) {
      values = {};
      out.set(row.source_id, values);
    }
    // Rows arrive newest first, so the first one seen per key is the standing one.
    if (values[row.metric_key] === undefined) values[row.metric_key] = Number(row.value);
  }
  return out;
}

/** "Where are they now": the newest live reading per metric, of any source. */
export async function getCurrentMeasurements(
  clientId: string
): Promise<Partial<Record<MeasurementKey, StandingReading>>> {
  const { data, error } = await supabaseAdmin
    .from("client_current_measurements")
    .select("*")
    .eq("client_id", clientId);
  if (error) {
    console.error("Failed to read current measurements:", error);
    throw new Error(`Failed to read current measurements: ${error.message}`);
  }
  const out: Partial<Record<MeasurementKey, StandingReading>> = {};
  for (const row of data ?? []) {
    const reading = toStanding(row);
    if (reading) out[reading.metricKey] = reading;
  }
  return out;
}

/**
 * The baseline: the reading as of the client's start date, per metric —
 * derived by `client_baseline_measurements` and read here, never re-derived
 * in code (`lib/measurements/baseline-ownership.test.ts`). Empty for a client
 * with no start date.
 */
export async function getBaseline(
  clientId: string
): Promise<Partial<Record<MeasurementKey, StandingReading>>> {
  const { data, error } = await supabaseAdmin
    .from("client_baseline_measurements")
    .select("*")
    .eq("client_id", clientId);
  if (error) {
    console.error("Failed to read the baseline:", error);
    throw new Error(`Failed to read the baseline: ${error.message}`);
  }
  const out: Partial<Record<MeasurementKey, StandingReading>> = {};
  for (const row of data ?? []) {
    const reading = toStanding(row);
    if (reading) out[reading.metricKey] = reading;
  }
  return out;
}

/** A row as the coach's list shows it: a reading with its removal, if any. */
export type MeasurementLogReading = MeasurementReading & {
  voided: { at: string; byName: string | null; reason: string | null } | null;
};

// The removal columns beside the reading, with the remover's name through the
// migration-160 foreign key (named, so the embed cannot pick another path).
const LOG_COLUMNS = `${READING_COLUMNS}, voided_at, void_reason, voided_by_coach:coaches!client_measurements_voided_by_fkey(name)`;

type LogReadingRow = Pick<
  Database["public"]["Tables"]["client_measurements"]["Row"],
  | "id"
  | "metric_key"
  | "value"
  | "recorded_on"
  | "recorded_at"
  | "measured_at"
  | "source"
  | "source_id"
  | "note"
  | "voided_at"
  | "void_reason"
> & { voided_by_coach: { name: string | null } | null };

function toLogReading(row: LogReadingRow): MeasurementLogReading | null {
  const reading = toReading(row);
  if (!reading) return null;
  return {
    ...reading,
    voided: row.voided_at
      ? {
          at: row.voided_at,
          byName: row.voided_by_coach?.name ?? null,
          reason: row.void_reason,
        }
      : null,
  };
}

/**
 * Every reading of a client, newest first, removed ones included: the coach's
 * measurement list, the one reader of the TABLE rather than the live view
 * (rule 7's exception). A removed row is shown muted with who removed it and
 * when, so it can be restored. Paged: it lists the whole log.
 */
export async function getMeasurementReadings(
  clientId: string
): Promise<MeasurementLogReading[]> {
  const rows = await fetchAllPages<LogReadingRow>(
    (from, to) =>
      supabaseAdmin
        .from("client_measurements")
        .select(LOG_COLUMNS)
        .eq("client_id", clientId)
        .order("recorded_on", { ascending: false })
        .order("recorded_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)
        .overrideTypes<LogReadingRow[], { merge: false }>(),
    { errorLabel: "measurement log" }
  );
  return rows.flatMap((row) => {
    const reading = toLogReading(row);
    return reading ? [reading] : [];
  });
}

/**
 * One reading by id, scoped by client — a foreign id is not found, never
 * "someone else's". Reads the table: a removed row is found, and says so,
 * because the edits need to know which state they are refusing.
 */
export async function getMeasurementReading(
  clientId: string,
  measurementId: string
): Promise<MeasurementLogReading | null> {
  const { data, error } = await supabaseAdmin
    .from("client_measurements")
    .select(LOG_COLUMNS)
    .eq("client_id", clientId)
    .eq("id", measurementId)
    .maybeSingle<LogReadingRow>();
  if (error) {
    console.error("Failed to read the measurement:", error);
    throw new Error(`Failed to read the measurement: ${error.message}`);
  }
  return data ? toLogReading(data) : null;
}
