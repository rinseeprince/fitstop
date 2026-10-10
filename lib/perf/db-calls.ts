import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient } from "pg";

/**
 * The database-call counter (CONVENTIONS §14 "Request budgets"). With
 * PERF_COUNT=1, in the Next server, every call through supabaseAdmin (`from`,
 * `rpc`) and every statement through Better Auth's pool prints one line to the
 * server's stdout when it answers:
 *
 *   [db] postgrest clients select 212.4ms 1 row 1.8kB @14:03:22.517
 *   [db] rpc get_exercise_prs 340.0ms 12 rows 3.1kB @14:03:22.731
 *   [db] pg session select 215.2ms 1 row 412B @14:03:21.990
 *
 * and once no call has been in flight for BURST_QUIET_MS, one line for the burst:
 *
 *   [db-burst] 29 calls · serial ≈ 5 · 1.9 s
 *
 * "serial" is the most calls of the burst that ran one after another, none
 * overlapping the next: the fewest round trips its critical path can have
 * held. The stamp after "@" is the call's start on the wall clock, so the
 * lines of the proxy and of a route compare; scripts/perf-count.ts reads them.
 *
 * Off, installing changes nothing: the client and the pool stay as they were.
 * It is off with PERF_COUNT unset, and anywhere outside the Next server:
 * production, the tests, and the scripts, which load .env.local too. The scale
 * harness (scripts/perf-baseline.ts) patches its client itself and reads the
 * calls of one function through collectDbCalls.
 */

const KINDS = ["postgrest", "rpc", "pg"] as const;
type DbCallKind = (typeof KINDS)[number];

/** One answered call: what it named, when it started on the wall clock, how long it took and what came back. */
type DbCall = {
  kind: DbCallKind;
  /** The table and the verb ("clients select"), the function's name, or Better Auth's table and verb. */
  label: string;
  startedAt: number;
  durationMs: number;
  rows: number;
  bytes: number;
};

/** A burst ends once no call has been in flight this long. */
const BURST_QUIET_MS = 300;

/** The statement verbs of a PostgREST query: the first one called names the call. */
const QUERY_VERBS = new Set(["select", "insert", "upsert", "update", "delete"]);

/** Marks a client this module has patched, so a second install is a no-op. */
const PATCHED = Symbol.for("atletafit.perf.db-calls.patched");

/**
 * The printing state, one per process: the proxy and the routes are compiled
 * apart, each with its own copy of this module, and a request's calls are one
 * burst whichever copy made them.
 */
type Printer = { on: boolean; inFlight: number; burst: DbCall[]; timer: ReturnType<typeof setTimeout> | null };
const PRINTER = Symbol.for("atletafit.perf.db-calls.printer");

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isPrinter = (value: unknown): value is Printer =>
  isRecord(value) && typeof value.on === "boolean" && typeof value.inFlight === "number" && Array.isArray(value.burst);

function printer(): Printer {
  const existing: unknown = Reflect.get(globalThis, PRINTER);
  if (isPrinter(existing)) return existing;
  const fresh: Printer = { on: false, inFlight: 0, burst: [], timer: null };
  Reflect.set(globalThis, PRINTER, fresh);
  return fresh;
}

/** The calls of the function collectDbCalls is running, when it is. */
const collecting = new AsyncLocalStorage<DbCall[]>();

/** Whether this process prints its calls: PERF_COUNT=1, in the Next server, which compiles NEXT_RUNTIME in. */
function counting(): boolean {
  return process.env.PERF_COUNT === "1" && process.env.NEXT_RUNTIME === "nodejs";
}

const now = () => performance.timeOrigin + performance.now();

/** Rows and bytes of what a call answered; a value that can't be measured counts as none. */
function measure(data: unknown): { rows: number; bytes: number } {
  if (data === null || data === undefined) return { rows: 0, bytes: 0 };
  try {
    return { rows: Array.isArray(data) ? data.length : 1, bytes: Buffer.byteLength(JSON.stringify(data)) };
  } catch (error) {
    console.debug("[db] an answer the counter could not measure", error);
    return { rows: Array.isArray(data) ? data.length : 1, bytes: 0 };
  }
}

/** Marks a call sent; returns what to run once it answers, with the rows it answered. Never throws into the call. */
function callStarted(kind: DbCallKind, label: string): (data: unknown) => void {
  const startedAt = now();
  const state = printer();
  if (state.on) {
    state.inFlight += 1;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
  }
  let answered = false;
  return (data) => {
    if (answered) return;
    answered = true;
    const call: DbCall = { kind, label, startedAt, durationMs: now() - startedAt, ...measure(data) };
    collecting.getStore()?.push(call);
    if (!state.on) return;
    state.inFlight = Math.max(0, state.inFlight - 1);
    state.burst.push(call);
    console.info(formatDbCall(call));
    if (state.inFlight === 0) {
      state.timer = setTimeout(() => closeBurst(state), BURST_QUIET_MS);
      state.timer.unref();
    }
  };
}

function closeBurst(state: Printer): void {
  state.timer = null;
  if (state.burst.length === 0) return;
  console.info(formatBurst(state.burst));
  state.burst = [];
}

/**
 * A PostgREST builder that reports its call when it is awaited: supabase-js
 * sends the request from `then`, so the clock starts there. Every builder a
 * method hands back is wrapped the same way, carrying the verb.
 */
function wrapQuery<T extends object>(builder: T, kind: "postgrest" | "rpc", target: string, verb: string | null): T {
  return new Proxy(builder, {
    get(raw, prop, receiver) {
      const value: unknown = Reflect.get(raw, prop, receiver);
      if (typeof value !== "function") return value;
      if (prop === "then") {
        return (onFulfilled?: (answer: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => {
          const answered = callStarted(kind, verb ? `${target} ${verb}` : target);
          return value.call(
            raw,
            (answer: unknown) => {
              answered(isRecord(answer) ? answer.data : undefined);
              return onFulfilled ? onFulfilled(answer) : answer;
            },
            (reason: unknown) => {
              answered(undefined);
              if (onRejected) return onRejected(reason);
              throw reason;
            }
          );
        };
      }
      return (...args: unknown[]) => {
        const next: unknown = value.apply(raw, args);
        if (!isRecord(next) || typeof next.then !== "function") return next;
        const nextVerb = verb ?? (kind === "postgrest" && typeof prop === "string" && QUERY_VERBS.has(prop) ? prop : null);
        return wrapQuery(next, kind, target, nextVerb);
      };
    },
  });
}

/**
 * Wraps a Supabase client's `from` and `rpc` in place, so every module that
 * imported the client reports through it. Patches once; prints only when
 * counting (countDbCalls), and always feeds collectDbCalls.
 */
export function patchSupabaseAdmin(admin: object): void {
  if (Reflect.get(admin, PATCHED) === true) return;
  const from: unknown = Reflect.get(admin, "from");
  const rpc: unknown = Reflect.get(admin, "rpc");
  if (typeof from !== "function" || typeof rpc !== "function") throw new Error("patchSupabaseAdmin: not a Supabase client");
  Reflect.set(admin, "from", (table: string) => wrapQuery(from.call(admin, table), "postgrest", table, null));
  Reflect.set(admin, "rpc", (fn: string, ...rest: unknown[]) => wrapQuery(rpc.call(admin, fn, ...rest), "rpc", fn, null));
  Reflect.set(admin, PATCHED, true);
}

/** Counts the app's service-role client when PERF_COUNT=1 in the Next server; else changes nothing. */
export function countDbCalls(admin: object): void {
  if (!counting()) return;
  printer().on = true;
  patchSupabaseAdmin(admin);
}

/** Better Auth's table and verb, read from the statement it sent ("session select"), or the verb alone ("begin"). */
function pgLabel(statement: unknown): string {
  const text = typeof statement === "string" ? statement : isRecord(statement) && typeof statement.text === "string" ? statement.text : "";
  const verb = /^\s*(\w+)/.exec(text)?.[1]?.toLowerCase() ?? "query";
  const table = /\b(?:from|into|update)\s+(?:"?\w+"?\s*\.\s*)?"?(\w+)"?/i.exec(text)?.[1];
  return table ? `${table} ${verb}` : verb;
}

/**
 * Wraps one pooled connection's `query`. Better Auth's queries (Kysely) take a
 * connection from the pool and query it, and the pool's own `query` does the
 * same, so the connection is where every statement passes. A cursor answers
 * through its own events and is not counted.
 */
function patchPgClient(client: PoolClient): void {
  const query: unknown = Reflect.get(client, "query");
  if (typeof query !== "function") return;
  Reflect.set(client, "query", (...args: unknown[]) => {
    if (isRecord(args[0]) && typeof args[0].submit === "function") return query.apply(client, args);
    const answered = callStarted("pg", pgLabel(args[0]));
    const rowsOf = (result: unknown) => (isRecord(result) ? result.rows : undefined);
    const callbackAt = args.findIndex((arg) => typeof arg === "function");
    const callback = args[callbackAt];
    if (typeof callback === "function") {
      args[callbackAt] = (error: unknown, result: unknown) => {
        answered(rowsOf(result));
        return callback(error, result);
      };
      return query.apply(client, args);
    }
    const returned: unknown = query.apply(client, args);
    if (!isRecord(returned) || typeof returned.then !== "function") return returned;
    return returned.then(
      (result: unknown) => {
        answered(rowsOf(result));
        return result;
      },
      (error: unknown) => {
        answered(undefined);
        throw error;
      }
    );
  });
}

/** Counts Better Auth's pool when PERF_COUNT=1 in the Next server: every connection it opens from now on. */
export function countPoolQueries(pool: Pool): void {
  if (!counting()) return;
  printer().on = true;
  pool.on("connect", patchPgClient);
}

/** Runs `fn` and returns its result with the calls it made through a patched client. */
export async function collectDbCalls<T>(fn: () => Promise<T>): Promise<{ result: T; calls: DbCall[] }> {
  const calls: DbCall[] = [];
  const result = await collecting.run(calls, fn);
  return { result, calls };
}

/** A start and an end, in milliseconds. */
type Span = { start: number; end: number };

/**
 * The most spans that follow one another without overlapping, picked greedily
 * by end: how many calls ran strictly one after another. `toleranceMs` absorbs
 * the rounding of stamps read back from printed lines.
 */
export function serialCount(spans: readonly Span[], toleranceMs = 0): number {
  let count = 0;
  let lastEnd = -Infinity;
  for (const span of [...spans].sort((a, b) => a.end - b.end)) {
    if (span.start >= lastEnd - toleranceMs) {
      count += 1;
      lastEnd = span.end;
    }
  }
  return count;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");
const clock = (epochMs: number) => {
  const at = new Date(epochMs);
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}.${pad(at.getMilliseconds(), 3)}`;
};
const size = (bytes: number) => (bytes < 1000 ? `${bytes}B` : `${(bytes / 1000).toFixed(1)}kB`);

export function formatDbCall(call: DbCall): string {
  const rows = `${call.rows} ${call.rows === 1 ? "row" : "rows"}`;
  return `[db] ${call.kind} ${call.label} ${call.durationMs.toFixed(1)}ms ${rows} ${size(call.bytes)} @${clock(call.startedAt)}`;
}

function formatBurst(calls: readonly DbCall[]): string {
  const spans = calls.map((call) => ({ start: call.startedAt, end: call.startedAt + call.durationMs }));
  const span = Math.max(...spans.map((s) => s.end)) - Math.min(...spans.map((s) => s.start));
  return `[db-burst] ${calls.length} ${calls.length === 1 ? "call" : "calls"} · serial ≈ ${serialCount(spans)} · ${(span / 1000).toFixed(1)} s`;
}

/** A printed [db] line read back: its kind and label, its start and end in milliseconds since midnight, rows and bytes. */
type PrintedDbCall = { kind: DbCallKind; label: string; start: number; end: number; rows: number; bytes: number };

const DB_LINE = /^\[db\] (postgrest|rpc|pg) (.+) (\d+\.\d)ms (\d+) rows? (\d+(?:\.\d)?)(B|kB) @(\d\d):(\d\d):(\d\d)\.(\d{3})$/;

/** Reads one line printed by formatDbCall; anything else is null. */
export function parseDbCallLine(line: string): PrintedDbCall | null {
  const match = DB_LINE.exec(line.trim());
  if (!match) return null;
  const [, printedKind, label, duration, rows, amount, unit, hours, minutes, seconds, millis] = match;
  const kind = KINDS.find((known) => known === printedKind);
  if (!kind) return null;
  const start = ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + Number(millis);
  return {
    kind,
    label,
    start,
    end: start + Number(duration),
    rows: Number(rows),
    bytes: Math.round(Number(amount) * (unit === "kB" ? 1000 : 1)),
  };
}

/** Printed stamps are whole milliseconds and durations tenths: two calls this close ran one after the other. */
const STAMP_TOLERANCE_MS = 2;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A request's printed calls on one clock: the stamps are a time of day, so a request across midnight moves its morning a day on. */
function onOneClock(calls: readonly PrintedDbCall[]): readonly PrintedDbCall[] {
  const starts = calls.map((call) => call.start);
  if (Math.max(...starts) - Math.min(...starts) < MS_PER_DAY / 2) return calls;
  return calls.map((call) => (call.start < MS_PER_DAY / 2 ? { ...call, start: call.start + MS_PER_DAY, end: call.end + MS_PER_DAY } : call));
}

/**
 * One request's calls as the budget counts them (CONVENTIONS §14): auth is
 * everything up to the end of its last Better Auth read (`pg`), the proxy's
 * and the route's own; the route's calls are what follows, with how many of
 * them ran one after another.
 */
export function countRequestCalls(printed: readonly PrintedDbCall[]): { calls: number; serial: number; auth: number } {
  const calls = onOneClock(printed);
  const authEnd = Math.max(-Infinity, ...calls.filter((call) => call.kind === "pg").map((call) => call.end));
  const route = calls.filter((call) => call.kind !== "pg" && call.start >= authEnd - STAMP_TOLERANCE_MS);
  return { calls: route.length, serial: serialCount(route, STAMP_TOLERANCE_MS), auth: calls.length - route.length };
}
