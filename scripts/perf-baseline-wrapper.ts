/**
 * Telemetry wrapper for the perf baseline harness.
 *
 * Patches `supabaseAdmin.from` and `supabaseAdmin.rpc` in place so every
 * `.from(table).select(...).eq(...).then(...)` chain records its table,
 * row count, payload bytes, and wall-clock into the active
 * AsyncLocalStorage context. Service code is unchanged.
 *
 *   patchSupabaseAdmin(supabaseAdmin);
 *   const { result, queries } = await withTelemetry(() => getClientExerciseList(id));
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type QueryRecord = {
  table: string;
  rowCount: number;
  bytes: number;
  durationMs: number;
};

const ctx = new AsyncLocalStorage<{ queries: QueryRecord[] }>();

export async function withTelemetry<T>(
  fn: () => Promise<T>
): Promise<{ result: T; queries: QueryRecord[]; totalMs: number; payloadBytes: number }> {
  const queries: QueryRecord[] = [];
  const t0 = performance.now();
  const result = await ctx.run({ queries }, fn);
  const totalMs = performance.now() - t0;
  const payloadBytes = JSON.stringify(result ?? null).length;
  return { result, queries, totalMs, payloadBytes };
}

/**
 * Mutates the singleton in place so existing service-module imports of
 * `supabaseAdmin` pick up the wrapped methods. Safe because no service
 * destructures `from` / `rpc` (verified via grep — only storage-service
 * uses `.storage` which we don't touch).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function patchSupabaseAdmin(admin: any): void {
  if (admin.__perfPatched) return;
  const realFrom = admin.from.bind(admin);
  const realRpc = admin.rpc.bind(admin);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin.from = (table: string): any => wrapBuilder(realFrom(table), table);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin.rpc = (fn: string, args?: any): any => wrapBuilder(realRpc(fn, args), `rpc:${fn}`);
  admin.__perfPatched = true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapBuilder(builder: any, label: string): any {
  return new Proxy(builder, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get(target: any, prop: string | symbol, receiver: any) {
      const val = Reflect.get(target, prop, receiver);

      if (prop === "then") {
        // Final await: instrument the resolution
        const start = performance.now();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (onFulfilled: any, onRejected: any) =>
          val.call(
            target,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (res: any) => {
              const durationMs = performance.now() - start;
              let rowCount = 0;
              let bytes = 0;
              const data = res?.data;
              if (Array.isArray(data)) {
                rowCount = data.length;
                bytes = JSON.stringify(data).length;
              } else if (data && typeof data === "object") {
                rowCount = 1;
                bytes = JSON.stringify(data).length;
              }
              const store = ctx.getStore();
              if (store) {
                store.queries.push({ table: label, rowCount, bytes, durationMs });
              }
              return onFulfilled?.(res);
            },
            onRejected
          );
      }

      if (typeof val === "function") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (...args: any[]) => {
          const next = val.apply(target, args);
          if (next && typeof next === "object" && typeof next.then === "function") {
            return wrapBuilder(next, label);
          }
          return next;
        };
      }

      return val;
    },
  });
}
