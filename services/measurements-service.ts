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
 *    or deletes, and a correction is a new row on the same day.
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
 * Every read goes through `client_measurements_live`, never the table, so the
 * void filter of the correct/remove commit lands in one place.
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
 * Thrown when a caller asks to withdraw a reading. Removal arrives with the
 * correct/remove commit (a void, never a delete); until then the only honest
 * answer is a refusal the coach can read, not a save that silently kept the
 * value.
 */
export class ReadingRemovalUnavailableError extends Error {
  constructor(what: string) {
    super(`A recorded ${what} can't be removed yet — enter the corrected value instead.`);
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

  // One statement for every key — never a row per round trip.
  const { data: insertedRows, error: insertError } = await supabaseAdmin
    .from("client_measurements")
    .insert(toInsert)
    .select(READING_COLUMNS);
  if (insertError || !insertedRows) {
    console.error("Failed to record measurements:", insertError);
    throw new Error(`Failed to record measurements: ${insertError?.message ?? "no rows"}`);
  }

  const inserted: MeasurementKey[] = [];
  const insertedIds = new Set<string>();
  for (const reading of toReadings(insertedRows)) {
    rows[reading.metricKey] = reading;
    inserted.push(reading.metricKey);
    insertedIds.add(reading.id);
  }

  // The energy pair follows the client's NEWEST weight and body fat, of any
  // source and by the client's calendar — a backdated row that is not the
  // newest recomputes nothing, which is the rule the cache guard used to hold.
  let energy: AppendMeasurementsResult["energy"] = "not_newest";
  if (inserted.includes("weight") || inserted.includes("bodyFat")) {
    const { data: current, error: currentError } = await supabaseAdmin
      .from("client_current_measurements")
      .select("metric_key, measurement_id")
      .eq("client_id", input.clientId)
      .in("metric_key", ["weight", "bodyFat"]);
    if (currentError) {
      console.error("Failed to read the client's current measurements:", currentError);
      throw new Error(`Failed to read current measurements: ${currentError.message}`);
    }
    const isNewest = (current ?? []).some(
      (row) => row.measurement_id != null && insertedIds.has(row.measurement_id)
    );
    if (isNewest) {
      await recalculateClientEnergy(input.clientId);
      energy = "recomputed";
    }
  }

  return { rows, inserted, unchanged, energy };
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
