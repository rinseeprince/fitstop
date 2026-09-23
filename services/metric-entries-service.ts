import { appendMeasurements } from "./measurements-service";
import type { MetricEntry } from "@/types/metric-entries";
import type { MetricEntryKey } from "@/lib/metrics/metric-entry-definitions";

type UpsertMetricEntryInput = {
  metricKey: MetricEntryKey;
  /** Canonical: kilograms, centimetres or percent. The Log-measurement dialog
   *  converts from the viewer's unit before sending (CONVENTIONS §20); nothing
   *  here converts again. */
  value: number;
  /** YYYY-MM-DD; route-validated and bounded to the coach's today */
  entryDate: string;
  note?: string;
  /** Caller-verified; written to the nullable `created_by`. Optional because
   *  not every writer has a coach in hand — a data backfill has none. */
  coachId?: string;
};

/**
 * A coach's Log-measurement entry: the value appends to the measurement log
 * (services/measurements-service.ts — rule 3 skips a value equal to the day's
 * standing coach entry, the energy pair recomputes when the row is the
 * client's newest), answered in the entry shape the Journey's caller reads.
 */
export const upsertMetricEntry = async (
  clientId: string,
  input: UpsertMetricEntryInput
): Promise<MetricEntry> => {
  const { metricKey } = input;
  const result = await appendMeasurements({
    clientId,
    source: "coach_entry",
    recordedOn: input.entryDate,
    values: { [metricKey]: input.value },
    note: input.note ?? null,
    createdBy: input.coachId ?? null,
  });
  const row = result.rows[metricKey];
  if (!row) throw new Error("Failed to save measurement");

  return {
    id: row.id,
    clientId,
    metricKey,
    value: row.value,
    entryDate: row.date,
    note: row.note ?? undefined,
    createdBy: input.coachId,
    createdAt: row.recordedAt,
    updatedAt: row.updatedAt,
  };
};
