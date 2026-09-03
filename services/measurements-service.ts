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
 * is one row in `client_measurements`, and this is the ONE module that inserts
 * into it and the one place its rules are spelled.
 *
 *  - The app role holds SELECT and INSERT; nothing here updates or deletes.
 *    Every UPDATE the table sees is one of three SECURITY DEFINER functions
 *    (`services/measurement-edits-service.ts`): a wrong value is EDITED in
 *    place — `update_measurement`, migration 161, keeps the row's id, day,
 *    source and stamp — and a reading that should never have existed is
 *    REMOVED by a void mark (`void_measurement`, migration 160) and restored
 *    by clearing it.
 *  - The value for a day is the reading written last — the latest live row by
 *    `recorded_at`, a tie broken by id (`lib/measurements/day-values.ts`,
 *    rule 2, D23). An edit changes a value and nothing else: `updated_at`
 *    records it and orders nothing.
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
  "id, metric_key, value, recorded_on, recorded_at, updated_at, measured_at, source, source_id, note";

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
  | "id"
  | "metric_key"
  | "value"
  | "recorded_on"
  | "recorded_at"
  | "updated_at"
  | "measured_at"
  | "source"
  | "source_id"
  | "note"
>;

function toReading(row: LiveReadingRow): MeasurementReading | null {
  if (
    row.id == null ||
    row.metric_key == null ||
    !isMeasurementKey(row.metric_key) ||
    row.value == null ||
    row.recorded_on == null ||
    row.recorded_at == null ||
    row.updated_at == null ||
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
    updatedAt: row.updated_at,
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
 * Editing, removing or restoring a reading fires the same recompute on the RPC's word
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
 * What each check-in reported: its own live row per metric — the row carrying
 * its stamp, edited in place when a coach changes it, so the report follows.
 * The latest by `recorded_at` per (stamp, metric): a stamped row written as a
 * correction before migration 161 still resolves. Empty input costs no query.
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
  | "updated_at"
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

/** The two readings a goal is set on and judged against. */
const GOAL_KEYS: readonly MeasurementKey[] = ["weight", "bodyFat"];

function standingOf(reading: MeasurementReading): StandingReading {
  return {
    id: reading.id,
    metricKey: reading.metricKey,
    value: reading.value,
    date: reading.date,
    source: reading.source,
  };
}

/**
 * The readings a check-in's review judges its goals against (commit 8b): per
 * metric, the check-in's own live stamped row when it has one, else the newest
 * live reading dated on or before `day` — rule 2 at a date, the as-of rule the
 * baseline view applies at the start date. The stamped row wins over a
 * same-day reading logged later, because the review reports what THIS
 * check-in said (rule 5); the Journey's day-value is a different question.
 * Weight and body fat only, the two a goal can be set on.
 *
 * Three reads in one round trip — the stamped rows, then the newest row on or
 * before the day per metric. One ordered read cannot answer both: with two
 * metrics in one list, a limit cuts the other metric's newest row whenever one
 * metric has been logged more often.
 *
 * The review is this function's only caller
 * (`lib/goals/goal-progress-ownership.test.ts`): the Overview and the Journey
 * read "now" through `client_current_measurements`.
 */
export async function getReadingsAsOf(
  clientId: string,
  day: string,
  checkInId: string
): Promise<Partial<Record<MeasurementKey, StandingReading>>> {
  const stampedQuery = supabaseAdmin
    .from("client_measurements_live")
    .select(READING_COLUMNS)
    .eq("client_id", clientId)
    .eq("source_id", checkInId)
    .in("metric_key", [...GOAL_KEYS])
    .order("recorded_at", { ascending: false })
    .order("id", { ascending: false });
  const beforeQueries = GOAL_KEYS.map((key) =>
    supabaseAdmin
      .from("client_measurements_live")
      .select(READING_COLUMNS)
      .eq("client_id", clientId)
      .eq("metric_key", key)
      .lte("recorded_on", day)
      .order("recorded_on", { ascending: false })
      .order("recorded_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
  );
  const [stamped, ...before] = await Promise.all([stampedQuery, ...beforeQueries]);

  const failed = [stamped, ...before].find((result) => result.error);
  if (failed?.error) {
    console.error("Failed to read the readings as of a day:", failed.error);
    throw new Error(`Failed to read measurements as of a day: ${failed.error.message}`);
  }

  const out: Partial<Record<MeasurementKey, StandingReading>> = {};
  // Stamped rows arrive newest first, so the first per key is the check-in's.
  for (const reading of toReadings(stamped.data)) {
    if (!out[reading.metricKey]) out[reading.metricKey] = standingOf(reading);
  }
  GOAL_KEYS.forEach((key, i) => {
    if (out[key]) return;
    const [reading] = toReadings(before[i].data);
    if (reading) out[key] = standingOf(reading);
  });
  return out;
}
