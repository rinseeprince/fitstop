import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Who the caller is comes from Better Auth alone: lib/auth.ts holds the one
 * betterAuth(…) and the one pool to its tables, lib/auth-client.ts the one
 * createAuthClient(…), and no file builds a Supabase session client (a client
 * from the public key and a login) or imports one. Every query, every database
 * function call and every storage call the app makes has `supabaseAdmin` as
 * its receiver, filtered in code by the coach or client id the seam verified
 * (docs/DATA-ACCESS-LOCKDOWN-PLAN.md commits 2–5). No rule in the database
 * stands behind an app read, so a query through any other client would have
 * nothing to lean on; this scan fails the first one.
 *
 * In the shape of `lib/measurements/baseline-ownership.test.ts`: every file
 * under SCAN is read for a query — `.from(…)` then a read or a write — a
 * function call (`.rpc(`) or a storage call (`.storage`) whose receiver's root
 * is anything but `supabaseAdmin`, or a name the same file binds to it
 * (`const db = supabaseAdmin`).
 */
const ROOT = join(__dirname, "..");
const SCAN: string[] = ["app", "components", "contexts", "hooks", "lib", "services", "utils", "proxy.ts"];

// Builds a Supabase session client (the two factories of Supabase's SSR
// package, which the tree no longer installs, or the app's own wrappers of
// them), or imports one: the package itself, should it ever come back, or a
// wrapper.
const SESSION_CLIENT =
  /\b(createServerClient|createServerSupabaseClient|createBrowserClient)\s*(<[^>]*>)?\s*\(|from\s+["'](@supabase\/ssr|@\/services\/supabase-client|@\/lib\/supabase-server)["']/;
// The package's name, spelled in two halves so no line of the tree imports it,
// a test included (docs/BETTER-AUTH-PLAN.md commit 3 greps for it).
const SSR_PACKAGE = ["@supabase", "ssr"].join("/");

// Better Auth's server and its own connection; its browser client.
const BETTER_AUTH_SERVER = /\bbetterAuth\s*\(|\bnew\s+Pool\s*\(/;
const BETTER_AUTH_CLIENT = /\bcreateAuthClient\s*(<[^>]*>)?\s*\(/;

// The receiver (a dotted name, or a closing paren for anything computed), the
// table and the verb of a query — `.from(…)` then a read or a write.
// `supabaseAdmin.storage.from(…)` reads as `supabaseAdmin`.
const TABLE_QUERY =
  /((?:[A-Za-z_$][\w$]*\s*\.\s*)*[A-Za-z_$][\w$]*|\))\s*\.\s*from\s*\(([^()]*)\)\s*\.\s*(select|insert|update|upsert|delete)\s*\(/g;

// The receiver and the function of a database function call.
const RPC_CALL = /((?:[A-Za-z_$][\w$]*\s*\.\s*)*[A-Za-z_$][\w$]*|\))\s*\.\s*rpc\s*\(\s*([^,()]*)/g;

// The receiver of a storage call — Supabase's `.storage.from(bucket)` on a
// client, whatever follows; the browser's own `navigator.storage` is not one.
const STORAGE_CALL = /((?:[A-Za-z_$][\w$]*\s*\.\s*)*[A-Za-z_$][\w$]*|\))\s*\.\s*storage\s*\.\s*from\s*\(/g;

// A name bound to the service-role client itself, and to nothing narrower.
const ADMIN_ALIAS = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*supabaseAdmin\s*;?[ \t]*$/gm;

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

/** Every query, database function call and storage call in the source, with its receiver's root. */
function accesses(src: string): Access[] {
  const code = stripComments(src);
  const found: Access[] = [];
  for (const [, receiver, tableArg, verb] of code.matchAll(TABLE_QUERY)) {
    found.push({ root: receiver.split(".")[0].trim(), name: unquote(tableArg), verb });
  }
  for (const [, receiver, fnArg] of code.matchAll(RPC_CALL)) {
    found.push({ root: receiver.split(".")[0].trim(), name: unquote(fnArg), verb: "rpc" });
  }
  for (const [, receiver] of code.matchAll(STORAGE_CALL)) {
    found.push({ root: receiver.split(".")[0].trim(), name: "storage", verb: "storage" });
  }
  return found;
}

/** The names the source binds to `supabaseAdmin` itself — and to nothing else anywhere in the file. */
function adminAliases(src: string): Set<string> {
  const code = stripComments(src);
  const names = new Set([...code.matchAll(ADMIN_ALIAS)].map(([, name]) => name));
  for (const name of [...names]) {
    if (new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=(?!\\s*supabaseAdmin\\b)`).test(code)) names.delete(name);
  }
  return names;
}

/** Each query, function call or storage call in the source that is not the service role's, as `name.verb`. */
function notThroughTheServer(src: string): string[] {
  const aliases = adminAliases(src);
  return accesses(src)
    .filter((access) => access.root !== "supabaseAdmin" && !aliases.has(access.root))
    .map((access) => `${access.name}.${access.verb}`);
}

function scannedFiles(): Map<string, string> {
  const files = new Map<string, string>();
  for (const target of SCAN) {
    for (const file of filesUnder(target)) files.set(relative(ROOT, file), readFileSync(file, "utf8"));
  }
  return files;
}

function sessionClientFiles(): Map<string, string> {
  const files = new Map<string, string>();
  for (const [rel, src] of scannedFiles()) {
    if (SESSION_CLIENT.test(stripComments(src))) files.set(rel, src);
  }
  return files;
}

/** The scanned files whose code matches `pattern`, comments aside. */
function filesMatching(pattern: RegExp): string[] {
  return [...scannedFiles()].filter(([, src]) => pattern.test(stripComments(src))).map(([rel]) => rel);
}

describe("who the caller is comes from Better Auth alone", () => {
  it("no file builds a Supabase session client or imports one", () => {
    expect([...sessionClientFiles().keys()]).toEqual([]);
  });

  it("lib/auth.ts holds the one betterAuth(…) and the one pool", () => {
    expect(filesMatching(BETTER_AUTH_SERVER)).toEqual(["lib/auth.ts"]);
  });

  it("lib/auth-client.ts holds the one createAuthClient(…)", () => {
    expect(filesMatching(BETTER_AUTH_CLIENT)).toEqual(["lib/auth-client.ts"]);
  });

  it("each pattern reads real code: a session client, Better Auth's server and its client are spotted however they are spelled", () => {
    for (const src of [
      'const supabase = createServerClient(url, key, { cookies })',
      "createBrowserClient<Database>(url, key)",
      "const supabase = await createServerSupabaseClient()",
      `import { createServerClient as makeClient } from "${SSR_PACKAGE}"`,
      'import { supabase } from "@/services/supabase-client"',
      'import { createServerSupabaseClient } from "@/lib/supabase-server"',
    ]) {
      expect(SESSION_CLIENT.test(src)).toBe(true);
    }
    expect(SESSION_CLIENT.test('import { createClient } from "@supabase/supabase-js"')).toBe(false);
    expect(BETTER_AUTH_SERVER.test("export const auth = betterAuth({ secret })")).toBe(true);
    expect(BETTER_AUTH_SERVER.test("const pool = new Pool({ max: 4 })")).toBe(true);
    expect(BETTER_AUTH_CLIENT.test("export const authClient = createAuthClient()")).toBe(true);
  });
});

describe("every access goes through the service role", () => {
  it("every query, function call and storage call in the app is supabaseAdmin's", () => {
    const offenders: string[] = [];
    for (const [rel, src] of scannedFiles()) {
      for (const access of notThroughTheServer(src)) offenders.push(`${rel} — ${access}`);
    }
    expect(offenders).toEqual([]);
  });

  it("scans a real tree — the guard is worthless if the glob is empty", () => {
    const files = scannedFiles();
    expect(files.size).toBeGreaterThan(200);
    expect([...files.keys()]).toEqual(
      expect.arrayContaining(["proxy.ts", "lib/auth.ts", "lib/auth-client.ts", "lib/auth-helpers.ts", "contexts/auth-context.tsx"])
    );
    // The query pattern reads real code: the service role's own queries are found.
    const served = [...files.values()].filter((src) => accesses(src).some((a) => a.root === "supabaseAdmin"));
    expect(served.length).toBeGreaterThan(20);
  });

  it("reads a receiver across a chain, however the client came back, and only a real access", () => {
    expect(notThroughTheServer('await supabaseAdmin\n  .from("clients")\n  .select("id")\n  .eq("id", id)')).toEqual([]);
    expect(
      notThroughTheServer('const supabase = await createServerSupabaseClient();\nawait supabase\n  .from("wellness_logs") // the log\n  .select(COLUMNS)')
    ).toEqual(["wellness_logs.select"]);
    expect(notThroughTheServer('await supabase\n  .from("clients") // the row\n  .update(row)\n  .eq("id", id);')).toEqual([
      "clients.update",
    ]);
    expect(notThroughTheServer('(await createServerSupabaseClient()).from("coaches").select("id")')).toEqual([
      "coaches.select",
    ]);
    expect(notThroughTheServer('await supabase.rpc("get_client_streak", { p_client_id: id })')).toEqual([
      "get_client_streak.rpc",
    ]);
    expect(notThroughTheServer('supabaseAdmin.rpc("get_client_streak", args)')).toEqual([]);
    expect(notThroughTheServer('supabaseAdmin.storage.from("content-library").upload(path, file)')).toEqual([]);
    expect(notThroughTheServer('const { data } = await supabase.storage.from("content-library").download(path)')).toEqual([
      "storage.storage",
    ]);
    expect(notThroughTheServer('createHash("sha256").update(ip).digest("hex")')).toEqual([]);
    expect(notThroughTheServer("const estimate = await navigator.storage.estimate()")).toEqual([]);
    expect(notThroughTheServer("Array.from(ids).map((id) => id)")).toEqual([]);
  });

  it("accepts a name bound to supabaseAdmin itself, and nothing narrower", () => {
    expect(notThroughTheServer('const db = supabaseAdmin;\nawait db.from("clients").select("id")')).toEqual([]);
    expect(notThroughTheServer('const db = supabaseAdmin\nawait db.from("clients").select("id")')).toEqual([]);
    expect(notThroughTheServer('const db = supabase;\nawait db.from("clients").select("id")')).toEqual(["clients.select"]);
    expect(notThroughTheServer('const db = supabaseAdmin;\nconst db = supabase;\nawait db.from("clients").select("id")')).toEqual([
      "clients.select",
    ]);
    expect(notThroughTheServer('const db = supabaseAdmin.from("clients");\nawait db.from("clients").select("id")')).toEqual([
      "clients.select",
    ]);
    expect(notThroughTheServer('async function read(client: Client) {\n  return client.from("clients").select("id");\n}')).toEqual([
      "clients.select",
    ]);
  });
});
