import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A write goes through a route and `supabaseAdmin`, never through a session
 * client — a client built from the public key and the caller's own login.
 * The database holds one write rule for a session client (migration 200), so
 * any other session write fails for every user; this scan fails it here
 * first. The one allowance is activation's update of the client row, which
 * the kept rule "Coaches can update their own clients" admits.
 *
 * In the shape of `lib/measurements/baseline-ownership.test.ts`: every file
 * that builds a session client, or holds the browser's, is read for a table
 * write — `.from(…)` then `.insert(` / `.update(` / `.upsert(` / `.delete(` —
 * whose receiver is anything but `supabaseAdmin`.
 */
const ROOT = join(__dirname, "..");
const SCAN: string[] = ["app", "components", "contexts", "hooks", "lib", "services", "utils", "middleware.ts"];

// Builds a session client (the three server factories, the browser's), or
// imports the browser's.
const SESSION_CLIENT =
  /\b(createServerClient|createServerSupabaseClient|createPortalClient|createBrowserClient)\s*(<[^>]*>)?\s*\(|from\s+["']@\/services\/supabase-client["']/;

// The receiver (a dotted name, or a closing paren for anything computed), the
// table and the verb of a table write. `supabaseAdmin.storage.from(…)` reads as
// `supabaseAdmin`.
const TABLE_WRITE =
  /((?:[A-Za-z_$][\w$]*\s*\.\s*)*[A-Za-z_$][\w$]*|\))\s*\.\s*from\s*\(([^()]*)\)\s*\.\s*(insert|update|upsert|delete)\s*\(/g;

// File → the session writes it may make. Activation's alone.
const ALLOWED: Record<string, string[]> = {
  "app/api/clients/[id]/activate/route.ts": ["clients.update"],
};

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

/** Each table write in the source that is not `supabaseAdmin`'s, as `table.verb`. */
function sessionWrites(src: string): string[] {
  const writes: string[] = [];
  for (const [, receiver, tableArg, verb] of stripComments(src).matchAll(TABLE_WRITE)) {
    const root = receiver.split(".")[0].trim();
    if (root === "supabaseAdmin") continue;
    writes.push(`${tableArg.trim().replace(/^["'`]|["'`]$/g, "")}.${verb}`);
  }
  return writes;
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

describe("a session client writes nothing, activation's update aside", () => {
  it("no file writes to a table through a session client", () => {
    const offenders: string[] = [];
    for (const [rel, src] of sessionClientFiles()) {
      const allowed = [...(ALLOWED[rel] ?? [])];
      for (const write of sessionWrites(src)) {
        const at = allowed.indexOf(write);
        if (at === -1) offenders.push(`${rel} — ${write}`);
        else allowed.splice(at, 1);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("each allowance names a write its file really makes, and nothing else", () => {
    const files = sessionClientFiles();
    for (const [rel, writes] of Object.entries(ALLOWED)) {
      expect({ rel, writes: sessionWrites(files.get(rel) ?? "") }).toEqual({ rel, writes });
    }
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
        "app/api/clients/[id]/activate/route.ts",
      ])
    );
  });
});
