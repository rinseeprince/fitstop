/**
 * Telemetry for the perf baseline harness (scripts/perf-baseline.ts), over
 * the database-call counter's patch (lib/perf/db-calls.ts): every
 * `.from(table)…` chain and `.rpc(…)` the harness's service calls make is
 * recorded with its table, row count, payload bytes and wall-clock. Service
 * code is unchanged.
 *
 *   patchSupabaseAdmin(supabaseAdmin);
 *   const { result, queries } = await withTelemetry(() => getClientExerciseList(id));
 */
import { collectDbCalls } from "@/lib/perf/db-calls";

export { patchSupabaseAdmin } from "@/lib/perf/db-calls";

export type QueryRecord = {
  table: string;
  rowCount: number;
  bytes: number;
  durationMs: number;
};

export async function withTelemetry<T>(
  fn: () => Promise<T>
): Promise<{ result: T; queries: QueryRecord[]; totalMs: number; payloadBytes: number }> {
  const t0 = performance.now();
  const { result, calls } = await collectDbCalls(fn);
  const totalMs = performance.now() - t0;
  const payloadBytes = JSON.stringify(result ?? null).length;
  // A function call reads "rpc:<name>" and a table its name, as this file always labelled them.
  const queries = calls.map((call) => ({
    table: call.kind === "rpc" ? `rpc:${call.label}` : call.label.split(" ")[0],
    rowCount: call.rows,
    bytes: call.bytes,
    durationMs: call.durationMs,
  }));
  return { result, queries, totalMs, payloadBytes };
}
