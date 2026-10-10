// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The database-call counter (lib/perf/db-calls.ts, CONVENTIONS §14 "Request
 * budgets") prints only with PERF_COUNT=1 in the Next server. Everywhere else,
 * production first, installing it must leave the app's client and Better
 * Auth's pool exactly as they were: these tests hold both halves.
 */

type Env = { PERF_COUNT?: string; NEXT_RUNTIME?: string };

/** The printer lives on globalThis, one per process; each test starts without one. */
const PRINTER = Symbol.for("atletafit.perf.db-calls.printer");

/** A fresh copy of the counter, loaded under `env`. */
async function counterUnder(env: Env) {
  vi.stubEnv("PERF_COUNT", env.PERF_COUNT);
  vi.stubEnv("NEXT_RUNTIME", env.NEXT_RUNTIME);
  vi.resetModules();
  return import("./db-calls");
}

const OFF: Env = { PERF_COUNT: undefined, NEXT_RUNTIME: "nodejs" };
const SCRIPT: Env = { PERF_COUNT: "1", NEXT_RUNTIME: undefined };
const ON: Env = { PERF_COUNT: "1", NEXT_RUNTIME: "nodejs" };

/** A Supabase client whose every request answers `rows`, so a query runs through supabase-js's own builders. */
function clientAnswering(rows: unknown) {
  const fetch = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } }))
  );
  return createClient("http://localhost:54321", "test-key", {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch },
  });
}

/** A pooled connection's stand-in: `query` answers `rows` as pg does, by promise or by callback. */
function connectionAnswering(rows: unknown[]) {
  return {
    query: vi.fn((_text: unknown, values?: unknown, callback?: unknown) => {
      const answer = { rows, rowCount: rows.length };
      const done = typeof values === "function" ? values : callback;
      if (typeof done === "function") {
        done(null, answer);
        return undefined;
      }
      return Promise.resolve(answer);
    }),
  };
}

let info: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  Reflect.deleteProperty(globalThis, PRINTER);
  info = vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis, PRINTER);
});

const printed = (): string[] => info.mock.calls.map((call: unknown[]) => String(call[0]));

describe("off: the counter changes nothing", () => {
  it.each([
    ["without PERF_COUNT, in the server", OFF],
    ["with PERF_COUNT=1, outside the server (a script, a test)", SCRIPT],
  ])("%s", async (_label, env) => {
    const { countDbCalls, countPoolQueries } = await counterUnder(env);
    const client = clientAnswering([{ id: "a" }]);
    const pool = new Pool();

    countDbCalls(client);
    countPoolQueries(pool);

    expect(Object.hasOwn(client, "from")).toBe(false);
    expect(Object.hasOwn(client, "rpc")).toBe(false);
    expect(Object.getOwnPropertySymbols(client)).toEqual([]);
    expect(pool.listenerCount("connect")).toBe(0);
    await client.from("clients").select("id");
    expect(printed()).toEqual([]);
    await pool.end();
  });

  it("leaves the app's own client untouched without PERF_COUNT, and patches it with it", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");

    await counterUnder(OFF);
    const off = (await import("@/services/supabase-admin")).supabaseAdmin;
    expect(Object.hasOwn(off, "from")).toBe(false);
    expect(Object.hasOwn(off, "rpc")).toBe(false);

    await counterUnder(ON);
    const on = (await import("@/services/supabase-admin")).supabaseAdmin;
    expect(Object.hasOwn(on, "from")).toBe(true);
    expect(Object.hasOwn(on, "rpc")).toBe(true);
  });

  it("imports nothing of the app: node's async context and pg's types alone", () => {
    const source = readFileSync(join(__dirname, "db-calls.ts"), "utf8");
    const imports = [...source.matchAll(/^import\s+(type\s+)?[^"]*"([^"]+)";$/gm)].map(([, type, from]) => `${type ?? ""}${from}`);
    expect(imports).toEqual(["node:async_hooks", "type pg"]);
  });
});

describe("on: PERF_COUNT=1 in the server prints every call", () => {
  it("prints a PostgREST query with its table, its first verb, its rows and its size, and answers as before", async () => {
    const { countDbCalls } = await counterUnder(ON);
    const client = clientAnswering([{ id: "a" }, { id: "b" }]);
    countDbCalls(client);

    const read = await client.from("clients").select("id").eq("coach_id", "c");
    const written = await client.from("client_notes").insert({ body: "x" }).select("id");
    await client.rpc("get_exercise_prs", { p_client_id: "c" });

    expect(read.data).toEqual([{ id: "a" }, { id: "b" }]);
    expect(written.data).toEqual([{ id: "a" }, { id: "b" }]);
    const lines = printed();
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^\[db\] postgrest clients select \d+\.\dms 2 rows 23B @\d\d:\d\d:\d\d\.\d{3}$/);
    expect(lines[1]).toMatch(/^\[db\] postgrest client_notes insert \d+\.\dms 2 rows 23B @/);
    expect(lines[2]).toMatch(/^\[db\] rpc get_exercise_prs \d+\.\dms 2 rows 23B @/);
  });

  it("prints Better Auth's statements on every connection the pool opens, by promise and by callback", async () => {
    const { countPoolQueries } = await counterUnder(ON);
    const pool = new Pool();
    countPoolQueries(pool);
    const connection = connectionAnswering([{ id: 1 }]);
    pool.emit("connect", connection);

    const answer = await connection.query(`select "id" from "better_auth"."session" where "token" = $1`, ["t"]);
    await new Promise((resolve) => {
      void connection.query("begin", resolve);
    });

    expect(answer).toEqual({ rows: [{ id: 1 }], rowCount: 1 });
    expect(printed()[0]).toMatch(/^\[db\] pg session select \d+\.\dms 1 row 10B @/);
    expect(printed()[1]).toMatch(/^\[db\] pg begin \d+\.\dms 1 row 10B @/);
    await pool.end();
  });

  it("closes a burst once nothing has been in flight for 300 ms", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { countPoolQueries } = await counterUnder(ON);
    const pool = new Pool();
    countPoolQueries(pool);
    let answerSlow: (answer: unknown) => void = () => undefined;
    const connection = {
      query: vi.fn((text: unknown) =>
        text === "slow" ? new Promise((resolve) => (answerSlow = resolve)) : Promise.resolve({ rows: [] })
      ),
    };
    pool.emit("connect", connection);

    const slow = connection.query("slow");
    await connection.query("select 1");
    await connection.query("select 2");
    vi.advanceTimersByTime(1_000);
    expect(printed().filter((line) => line.startsWith("[db-burst]"))).toEqual([]);

    answerSlow({ rows: [] });
    await slow;
    vi.advanceTimersByTime(299);
    expect(printed().filter((line) => line.startsWith("[db-burst]"))).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(printed().filter((line) => line.startsWith("[db-burst]"))).toEqual([
      expect.stringMatching(/^\[db-burst\] 3 calls · serial ≈ 2 · \d+\.\d s$/),
    ]);
    await pool.end();
  });
});

describe("the scale harness's path", () => {
  it("collects one function's calls through a patched client and prints nothing", async () => {
    const { patchSupabaseAdmin, collectDbCalls } = await counterUnder(SCRIPT);
    const client = clientAnswering([{ id: "a" }]);
    patchSupabaseAdmin(client);

    await client.from("before").select("id");
    const { result, calls } = await collectDbCalls(async () => {
      const { data } = await client.from("clients").select("id");
      await client.rpc("get_client_exercise_list", {});
      return data;
    });

    expect(result).toEqual([{ id: "a" }]);
    expect(calls.map((call) => [call.kind, call.label, call.rows])).toEqual([
      ["postgrest", "clients select", 1],
      ["rpc", "get_client_exercise_list", 1],
    ]);
    expect(printed()).toEqual([]);
  });
});

describe("serial: the most calls that ran one after another", () => {
  it.each([
    ["three in a row", [[0, 10], [10, 20], [20, 30]], 0, 3],
    ["three at once", [[0, 10], [0, 12], [1, 9]], 0, 1],
    ["two at once, then one", [[0, 10], [0, 12], [12, 20]], 0, 2],
    ["a stamp rounded past the next start, within the tolerance", [[0, 10.4], [10, 20]], 2, 2],
    ["the same, read exactly", [[0, 10.4], [10, 20]], 0, 1],
  ])("%s", async (_label, spans, tolerance, serial) => {
    const { serialCount } = await counterUnder(SCRIPT);
    expect(serialCount(spans.map(([start, end]) => ({ start, end })), tolerance)).toBe(serial);
  });
});

describe("a printed line reads back", () => {
  it("as its kind, label, span, rows and size", async () => {
    const { formatDbCall, parseDbCallLine } = await counterUnder(SCRIPT);
    const startedAt = new Date(2026, 9, 10, 14, 3, 22, 517).getTime();
    const line = formatDbCall({ kind: "postgrest", label: "clients select", startedAt, durationMs: 212.44, rows: 1, bytes: 1834 });

    expect(line).toBe("[db] postgrest clients select 212.4ms 1 row 1.8kB @14:03:22.517");
    expect(parseDbCallLine(line)).toEqual({
      kind: "postgrest",
      label: "clients select",
      start: ((14 * 60 + 3) * 60 + 22) * 1000 + 517,
      end: ((14 * 60 + 3) * 60 + 22) * 1000 + 517 + 212.4,
      rows: 1,
      bytes: 1800,
    });
  });

  it("and nothing else does", async () => {
    const { parseDbCallLine } = await counterUnder(SCRIPT);
    expect(parseDbCallLine("[db-burst] 3 calls · serial ≈ 2 · 0.4 s")).toBeNull();
    expect(parseDbCallLine(" ✓ Compiled /api/client/me in 1.2s")).toBeNull();
  });
});

describe("one request's calls, as the budget counts them", () => {
  const call = (kind: "postgrest" | "rpc" | "pg", label: string, start: number, end: number) => ({ kind, label, start, end, rows: 1, bytes: 10 });

  it("counts auth up to the end of the last Better Auth read, and the route's calls after it", async () => {
    const { countRequestCalls } = await counterUnder(SCRIPT);
    const request = [
      call("pg", "session select", 0, 200),
      call("pg", "user select", 200, 400),
      call("postgrest", "profiles select", 400, 600),
      call("pg", "session select", 650, 850),
      call("pg", "user select", 850, 1050),
      call("postgrest", "clients select", 1050, 1250),
      call("postgrest", "notes select", 1250, 1450),
      call("rpc", "get_exercise_prs", 1250, 1500),
    ];
    expect(countRequestCalls(request)).toEqual({ calls: 3, serial: 2, auth: 5 });
  });

  it("counts every call as the route's when no Better Auth read came", async () => {
    const { countRequestCalls } = await counterUnder(SCRIPT);
    expect(countRequestCalls([call("postgrest", "a select", 0, 10), call("postgrest", "b select", 10, 20)])).toEqual({ calls: 2, serial: 2, auth: 0 });
  });

  it("reads a request across midnight on one clock", async () => {
    const { countRequestCalls } = await counterUnder(SCRIPT);
    const day = 24 * 60 * 60 * 1000;
    const request = [call("pg", "session select", day - 300, day - 100), call("postgrest", "clients select", 50, 250)];
    expect(countRequestCalls(request)).toEqual({ calls: 1, serial: 1, auth: 1 });
  });
});
