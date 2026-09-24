import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A write goes through a route and `supabaseAdmin`, never through a session
 * client — a client built from the public key and the caller's own login.
 * The database holds one write rule for a session client, "Coaches can update
 * their own clients" (migration 200), and nothing uses it: activation writes
 * through the server. So a session write fails for every user, or lands
 * through a rule nothing may lean on; this scan fails every one here first.
 *
 * The readers that moved off the session client (docs/DATA-ACCESS-LOCKDOWN-PLAN.md
 * commit 3) read through the server alone: in each of their files, every query
 * and every database function call has `supabaseAdmin` as its receiver.
 *
 * In the shape of `lib/measurements/baseline-ownership.test.ts`: every file
 * that builds a session client, or holds the browser's, is read for a table
 * write — `.from(…)` then `.insert(` / `.update(` / `.upsert(` / `.delete(` —
 * whose receiver is anything but `supabaseAdmin`.
 */
const ROOT = join(__dirname, "..");
const SCAN: string[] = ["app", "components", "contexts", "hooks", "lib", "services", "utils", "middleware.ts"];

// Builds a session client (the two server factories, the browser's), or
// imports the browser's.
const SESSION_CLIENT =
  /\b(createServerClient|createServerSupabaseClient|createBrowserClient)\s*(<[^>]*>)?\s*\(|from\s+["']@\/services\/supabase-client["']/;

// The client's own profile and progress, activation, the coach's attention feed.
const SERVER_ONLY = [
  "services/client-portal-progress.ts",
  "services/client-portal-service.ts",
  "app/api/clients/[id]/activate/route.ts",
  "app/api/dashboard/attention-feed/route.ts",
];

// The receiver (a dotted name, or a closing paren for anything computed), the
// table and the verb of a query — `.from(…)` then a read or a write.
// `supabaseAdmin.storage.from(…)` reads as `supabaseAdmin`.
const TABLE_QUERY =
  /((?:[A-Za-z_$][\w$]*\s*\.\s*)*[A-Za-z_$][\w$]*|\))\s*\.\s*from\s*\(([^()]*)\)\s*\.\s*(select|insert|update|upsert|delete)\s*\(/g;
const WRITE_VERBS = new Set(["insert", "update", "upsert", "delete"]);

// The receiver and the function of a database function call.
const RPC_CALL = /((?:[A-Za-z_$][\w$]*\s*\.\s*)*[A-Za-z_$][\w$]*|\))\s*\.\s*rpc\s*\(\s*([^,()]*)/g;

function filesUnder(target: string): string[] {
  const abs = join(ROOT, target);
  if (statSync(abs).isFile()) return [abs];
  const out: string[] = [];
  for (const entry of readdirSync(abs)) {
    const full = join(abs, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(join(target, entry)));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

// Comments explain the rule and must not trip it; a trailing comment would
// also split a chain the pattern reads across lines.
const stripComments = (src: string) =>
  src
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .map((line) => line.replace(/\s\/\/\s.*$/, ""))
    .join("\n");

type Access = { root: string; name: string; verb: string };

const unquote = (arg: string) => arg.trim().replace(/^["'`]|["'`]$/g, "");

/** Every query and database function call in the source, with its receiver's root. */
function accesses(src: string): Access[] {
  const code = stripComments(src);
  const found: Access[] = [];
  for (const [, receiver, tableArg, verb] of code.matchAll(TABLE_QUERY)) {
    found.push({ root: receiver.split(".")[0].trim(), name: unquote(tableArg), verb });
  }
  for (const [, receiver, fnArg] of code.matchAll(RPC_CALL)) {
    found.push({ root: receiver.split(".")[0].trim(), name: unquote(fnArg), verb: "rpc" });
  }
  return found;
}

/** Each table write in the source that is not `supabaseAdmin`'s, as `table.verb`. */
function sessionWrites(src: string): string[] {
  return accesses(src)
    .filter((access) => access.root !== "supabaseAdmin" && WRITE_VERBS.has(access.verb))
    .map((access) => `${access.name}.${access.verb}`);
}

/** Each query or function call in the source that is not `supabaseAdmin`'s, as `name.verb`. */
function notThroughTheServer(src: string): string[] {
  return accesses(src)
    .filter((access) => access.root !== "supabaseAdmin")
    .map((access) => `${access.name}.${access.verb}`);
}

function sessionClientFiles(): Map<string, string> {
  const files = new Map<string, string>();
  for (const target of SCAN) {
    for (const file of filesUnder(target)) {
      const src = readFileSync(file, "utf8");
      if (SESSION_CLIENT.test(stripComments(src))) files.set(relative(ROOT, file), src);
    }
  }
  return files;
}

describe("a session client writes nothing", () => {
  it("no file writes to a table through a session client", () => {
    const offenders: string[] = [];
    for (const [rel, src] of sessionClientFiles()) {
      for (const write of sessionWrites(src)) offenders.push(`${rel} — ${write}`);
    }
    expect(offenders).toEqual([]);
  });

  it("reads a write's receiver across a chain, and only a table write", () => {
    expect(sessionWrites('await supabase\n  .from("clients") // the row\n  .update(row)\n  .eq("id", id);')).toEqual([
      "clients.update",
    ]);
    expect(sessionWrites('await supabaseAdmin\n  .from("clients")\n  .delete()')).toEqual([]);
    expect(sessionWrites('supabaseAdmin.storage.from("content-library").update(path, file)')).toEqual([]);
    expect(sessionWrites('(await createServerSupabaseClient()).from("coaches").upsert(row)')).toEqual([
      "coaches.upsert",
    ]);
    expect(sessionWrites('createHash("sha256").update(ip).digest("hex")')).toEqual([]);
    expect(sessionWrites('await supabase.from("coaches").select("id")')).toEqual([]);
  });

  it("scans a real tree — the guard is worthless if the glob is empty", () => {
    const count = SCAN.reduce((n, t) => n + filesUnder(t).length, 0);
    expect(count).toBeGreaterThan(200);
    const files = [...sessionClientFiles().keys()];
    expect(files).toEqual(
      expect.arrayContaining([
        "middleware.ts",
        "lib/auth-helpers.ts",
        "services/supabase-client.ts",
        "contexts/auth-context.tsx",
      ])
    );
  });
});

describe("the readers moved to the server read through it alone", () => {
  it("every query and function call in their files is supabaseAdmin's", () => {
    const offenders: string[] = [];
    for (const rel of SERVER_ONLY) {
      for (const access of notThroughTheServer(readFileSync(join(ROOT, rel), "utf8"))) {
        offenders.push(`${rel} — ${access}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("reads a query's receiver, however the session client came back", () => {
    expect(notThroughTheServer('await supabaseAdmin\n  .from("clients")\n  .select("id")\n  .eq("id", id)')).toEqual([]);
    expect(
      notThroughTheServer('const supabase = await createServerSupabaseClient();\nawait supabase\n  .from("wellness_logs") // the log\n  .select(COLUMNS)')
    ).toEqual(["wellness_logs.select"]);
    expect(notThroughTheServer('(await createServerSupabaseClient()).from("coaches").select("id")')).toEqual([
      "coaches.select",
    ]);
    expect(notThroughTheServer('await supabase.rpc("get_client_streak", { p_client_id: id })')).toEqual([
      "get_client_streak.rpc",
    ]);
    expect(notThroughTheServer('supabaseAdmin.rpc("get_client_streak", args)')).toEqual([]);
    expect(notThroughTheServer("Array.from(ids).map((id) => id)")).toEqual([]);
  });
});
