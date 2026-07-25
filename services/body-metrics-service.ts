// Uses supabaseAdmin: service-to-service calls require bypassing RLS,
// and denormalized cache writes to clients table are system-level operations.
import { supabaseAdmin } from "./supabase-admin";
import type {
  BodyMetricsEvent,
  BodyMetricsEventRow,
  BodyMetricsSource,
} from "@/types/body-metrics";

export interface BodyMetricsQueryOpts {
  requireFields?: (
    | "weight"
    | "body_fat_percentage"
    | "bmr"
    | "tdee"
  )[];
  limit?: number;
  from?: string;
  to?: string;
  ascending?: boolean;
}

function mapBodyMetricsRow(row: BodyMetricsEventRow): BodyMetricsEvent {
  return {
    id: row.id,
    clientId: row.client_id,
    weight: row.weight ?? undefined,
    weightUnit: row.weight_unit ?? undefined,
    bodyFatPercentage: row.body_fat_percentage ?? undefined,
    bmr: row.bmr ?? undefined,
    tdee: row.tdee ?? undefined,
    source: row.source as BodyMetricsSource,
    sourceId: row.source_id ?? undefined,
    recordedAt: row.recorded_at,
    createdAt: row.created_at,
  };
}

export const recordBodyMetrics = async (params: {
  clientId: string;
  weight?: number;
  weightUnit?: string;
  bodyFatPercentage?: number;
  bmr?: number;
  tdee?: number;
  source: BodyMetricsSource;
  sourceId?: string;
  /** recorded_at for the event; defaults to now. Lets a backdated coach entry
   *  land at its true position in the event timeline. */
  recordedAt?: string;
  /** when false, skip the clients denormalized-cache update — the caller has
   *  determined the entry is backdated and must not regress current values. */
  updateClientCache?: boolean;
}): Promise<BodyMetricsEvent> => {
  const now = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("body_metrics")
    .insert({
      client_id: params.clientId,
      weight: params.weight ?? null,
      weight_unit: params.weightUnit ?? null,
      body_fat_percentage: params.bodyFatPercentage ?? null,
      bmr: params.bmr ?? null,
      tdee: params.tdee ?? null,
      source: params.source,
      source_id: params.sourceId ?? null,
      recorded_at: params.recordedAt ?? now,
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to record body metrics:", error);
    throw new Error(`Failed to record body metrics: ${error.message}`);
  }

  // Update denormalized cache on clients table for provided fields
  const cacheUpdate: Record<string, unknown> = {};
  if (params.weight !== undefined) cacheUpdate.current_weight = params.weight;
  if (params.bodyFatPercentage !== undefined)
    cacheUpdate.current_body_fat_percentage = params.bodyFatPercentage;
  if (params.bmr !== undefined) cacheUpdate.bmr = params.bmr;
  if (params.tdee !== undefined) cacheUpdate.tdee = params.tdee;

  if (params.updateClientCache !== false && Object.keys(cacheUpdate).length > 0) {
    cacheUpdate.updated_at = now;
    const { error: cacheError } = await supabaseAdmin
      .from("clients")
      .update(cacheUpdate)
      .eq("id", params.clientId);

    if (cacheError) {
      console.error("Failed to update client cache:", cacheError);
    }
  }

  return mapBodyMetricsRow(data);
};

export const getBodyMetricsHistory = async (
  clientId: string,
  opts?: BodyMetricsQueryOpts
): Promise<BodyMetricsEvent[]> => {
  let query = supabaseAdmin
    .from("body_metrics")
    .select("*")
    .eq("client_id", clientId);

  if (opts?.requireFields) {
    for (const field of opts.requireFields) {
      query = query.not(field, "is", null);
    }
  }

  if (opts?.from) {
    query = query.gte("recorded_at", opts.from);
  }
  if (opts?.to) {
    query = query.lte("recorded_at", opts.to);
  }

  // created_at tiebreak: same-date coach entries share a recorded_at (T12:00Z),
  // so "latest" must not be nondeterministic between a stale and corrected value.
  query = query
    .order("recorded_at", { ascending: opts?.ascending ?? false })
    .order("created_at", { ascending: opts?.ascending ?? false });

  if (opts?.limit) {
    query = query.limit(opts.limit);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Failed to fetch body metrics history:", error);
    throw new Error(`Failed to fetch body metrics history: ${error.message}`);
  }

  return (data || []).map((row: BodyMetricsEventRow) =>
    mapBodyMetricsRow(row)
  );
};

export const getLatestBodyMetrics = async (
  clientId: string,
  opts?: BodyMetricsQueryOpts
): Promise<BodyMetricsEvent | null> => {
  const results = await getBodyMetricsHistory(clientId, {
    ...opts,
    limit: 1,
  });
  return results[0] ?? null;
};
