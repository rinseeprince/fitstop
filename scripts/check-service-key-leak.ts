/**
 * Server-secret containment gate. Asserts that the server's secrets cannot
 * reach the browser, and exits non-zero if one can: SUPABASE_SERVICE_ROLE_KEY,
 * held by services/supabase-admin.ts, and the database password and
 * BETTER_AUTH_SECRET, held by lib/auth.ts.
 *
 *   npx tsx scripts/check-service-key-leak.ts                  (or: npm run check:service-key)
 *   npx tsx scripts/check-service-key-leak.ts --require-bundle (pre-deploy: demands a prod build)
 *
 * TWO CLAUSES
 *   1. Import graph (no build required). Walks the reverse import graph upward
 *      from each module that holds a secret, following ONLY value imports, and
 *      fails if any "use client" module is reachable. Type-only edges are
 *      excluded because tsc/swc erase them — a client component doing
 *      `import type { Foo } from "@/services/some-service"` does NOT pull that
 *      service (or its supabaseAdmin import) into a bundle.
 *   2. Bundle scan (requires a build). Greps the browser-served static output
 *      for the service key's value, its bare JWT signature segment (in case the
 *      value is re-encoded or chunk-split) and its literal env-var name, and for
 *      the values of the database password (as DATABASE_URL writes it, and
 *      decoded) and BETTER_AUTH_SECRET (their names are not scanned: Better
 *      Auth's own browser code may spell them).
 *
 * EVERY CLAUSE CARRIES A POSITIVE CONTROL
 * A grep that finds nothing and a grep that is silently broken look identical.
 * So clause 1 asserts its closure still reaches app/api routes (if module
 * resolution breaks, the closure collapses to 1 and the "no client components"
 * result becomes meaningless), and clause 2 asserts the anon key IS present in
 * the bundle (if it is not, the scan is not reading real chunks). A failed
 * control reports INCONCLUSIVE (exit 2) — never a pass.
 *
 * WHY THIS EXISTS
 * Logged 2026-07-30. The containment rests entirely on two conventions that
 * nothing enforces: that Next.js only inlines NEXT_PUBLIC_* vars, and that
 * every client-side edge into a service module stays `import type`. The second
 * is one keystroke from breaking — deleting the word `type` in any of the 17
 * client files that type-import a service is enough to drag supabaseAdmin into
 * the client graph, and neither tsc nor eslint would object. Review will not
 * catch that accumulating (it did not catch the RLS or typography drifts
 * either — see scripts/assert-rls.ts, scripts/check-labels.ts).
 *
 * THIS SCRIPT NEVER PRINTS THE SECRET. It reports lengths and file paths only.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve as resolvePath, dirname, extname } from "node:path";
import { pathToFileURL } from "node:url";

/** Repo root. Matches scripts/check-labels.ts — npm scripts run from here. */
const ROOT = process.cwd();

/** Module suffixes that participate in the import graph. */
const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"] as const;

/** Directories the import-graph walk never descends into. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "supabase",
  "coverage",
  "public",
  "scratchpad",
]);

/** The modules that hold a server secret, each the root of clause 1's walk. */
const SEEDS = [
  { path: join(ROOT, "services/supabase-admin.ts"), holds: "the service-role client" },
  { path: join(ROOT, "lib/auth.ts"), holds: "the database password and Better Auth's signing secret" },
] as const;

/** A secret shorter than this could match unrelated bundle text, so a zero-hit scan for it would prove nothing. */
const MIN_SCANNABLE_SECRET = 16;

/** Browser-served build output, most-authoritative first. */
const BUNDLE_DIRS = [
  { path: join(ROOT, ".next/static"), kind: "production" as const },
  { path: join(ROOT, ".next/dev/static"), kind: "development" as const },
];

// ---------------------------------------------------------------- env loading

/**
 * Reads a var from the real environment, falling back to .env.local. CI supplies
 * these as real env vars; local runs read the file.
 */
export function readEnvVar(name: string): string | null {
  const fromEnv = process.env[name];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  const envFile = join(ROOT, ".env.local");
  if (!existsSync(envFile)) return null;

  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m || m[1] !== name) continue;
    const raw = m[2].trim().replace(/^["']|["']$/g, "").trim();
    return raw || null;
  }
  return null;
}

// ------------------------------------------------------------- import graph

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectFiles(join(dir, entry.name), out);
    } else if ((EXTS as readonly string[]).includes(extname(entry.name))) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/** Resolves an import specifier to an on-disk module, or null for bare packages. */
function resolveSpecifier(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolvePath(dirname(fromFile), spec);
  else return null;

  const candidates = [
    base,
    ...EXTS.map((e) => base + e),
    ...EXTS.map((e) => join(base, "index" + e)),
  ];
  for (const c of candidates) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {
      /* not this candidate */
    }
  }
  return null;
}

/**
 * True when a statement is erased at compile time: `import type ...`,
 * `export type ...`, or a named clause whose every specifier is `type`-modified.
 */
export function isTypeOnlyStatement(stmt: string): boolean {
  if (/^\s*(?:import|export)\s+type\s/.test(stmt)) return true;

  const braces = stmt.match(/\{([^}]*)\}/);
  if (!braces) return false;

  // A default or namespace binding alongside the braces makes it a value import.
  const beforeBrace = stmt.slice(0, stmt.indexOf("{"));
  if (/(?:import|export)\s+(?:[A-Za-z_$][\w$]*\s*,|\*\s+as\s)/.test(beforeBrace)) return false;

  const specs = braces[1].split(",").map((s) => s.trim()).filter(Boolean);
  return specs.length > 0 && specs.every((s) => /^type\s/.test(s));
}

const STATEMENT_RE =
  /(?:^|\n)[ \t]*(?:import|export)\b[\s\S]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\)|(?:^|\n)[ \t]*import\s*["']([^"']+)["']/g;

/** True when the module opens with a "use client" directive. */
export function isClientModule(source: string): boolean {
  const head = source.slice(0, 4000).replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "");
  return /^["']use client["']/.test(head);
}

export type GraphResult = {
  closureSize: number;
  clientModules: string[];
  chains: Map<string, string[]>;
  reachesApiRoute: boolean;
};

export type ImportGraph = { source: Map<string, string>; importers: Map<string, Set<string>> };

/** Every module's source and, for each module, the modules that value-import it. */
export function buildImportGraph(): ImportGraph {
  const files = collectFiles(ROOT);
  const source = new Map<string, string>();
  const importers = new Map<string, Set<string>>();

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    source.set(file, text);

    STATEMENT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = STATEMENT_RE.exec(text))) {
      const spec = m[1] || m[2] || m[3] || m[4];
      if (!spec) continue;
      // m[1] is the `... from "x"` form — the only one that can be type-only.
      if (m[1] && isTypeOnlyStatement(m[0])) continue;
      const target = resolveSpecifier(spec, file);
      if (!target) continue;
      if (!importers.has(target)) importers.set(target, new Set());
      importers.get(target)!.add(file);
    }
  }

  return { source, importers };
}

/** BFS upward from the seed following value imports only. */
export function buildValueClosure(seed: string, { source, importers }: ImportGraph): GraphResult {
  const seen = new Set([seed]);
  const queue = [seed];
  const parent = new Map<string, string>();
  const clientModules: string[] = [];

  while (queue.length) {
    const current = queue.shift()!;
    for (const importer of importers.get(current) ?? []) {
      if (seen.has(importer)) continue;
      seen.add(importer);
      parent.set(importer, current);
      if (isClientModule(source.get(importer) ?? "")) clientModules.push(importer);
      queue.push(importer);
    }
  }

  const chains = new Map<string, string[]>();
  for (const hit of clientModules) {
    const chain: string[] = [];
    let cursor: string | undefined = hit;
    while (cursor) {
      chain.push(relative(ROOT, cursor));
      cursor = parent.get(cursor);
    }
    chains.set(hit, chain);
  }

  const reachesApiRoute = [...seen].some((f) =>
    relative(ROOT, f).startsWith("app/api/")
  );

  return { closureSize: seen.size, clientModules, chains, reachesApiRoute };
}

// -------------------------------------------------------------- bundle scan

function collectBundleFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectBundleFiles(full, out);
    else out.push(full);
  }
  return out;
}

export type BundleResult = {
  kind: "production" | "development";
  dir: string;
  filesScanned: number;
  controlHits: string[];
  valueHits: string[];
  signatureHits: string[];
  nameHits: string[];
  /** One entry per other secret: the files holding its value. */
  secretHits: Array<{ label: string; hits: string[] }>;
};

export function scanBundle(
  dir: string,
  kind: "production" | "development",
  serviceKey: string,
  control: string,
  otherSecrets: ReadonlyArray<{ label: string; value: string }> = []
): BundleResult {
  const files = collectBundleFiles(dir);
  const signature = serviceKey.split(".")[2] ?? "";

  const result: BundleResult = {
    kind,
    dir,
    filesScanned: files.length,
    controlHits: [],
    valueHits: [],
    signatureHits: [],
    nameHits: [],
    secretHits: otherSecrets.map(({ label }) => ({ label, hits: [] })),
  };

  for (const file of files) {
    // latin1 keeps binary assets readable as bytes; the needles are all ASCII.
    let text: string;
    try {
      text = readFileSync(file, "latin1");
    } catch {
      continue;
    }
    const rel = relative(ROOT, file);
    if (text.includes(serviceKey)) result.valueHits.push(rel);
    if (signature.length >= 20 && text.includes(signature)) result.signatureHits.push(rel);
    if (text.includes("SUPABASE_SERVICE_ROLE_KEY")) result.nameHits.push(rel);
    if (text.includes(control)) result.controlHits.push(rel);
    otherSecrets.forEach(({ value }, i) => {
      if (text.includes(value)) result.secretHits[i].hits.push(rel);
    });
  }

  return result;
}

/**
 * The database password in every form a bundle could carry it: as the
 * connection string writes it (percent-encoded, as an inlined DATABASE_URL
 * would hold it) and decoded, once when the two are the same. Empty when the
 * string holds no password, is not a URL, or escapes it badly (pg could not
 * read it either).
 */
export function databasePasswordForms(databaseUrl: string): string[] {
  try {
    const written = new URL(databaseUrl).password;
    return written ? [...new Set([written, decodeURIComponent(written)])] : [];
  } catch {
    return [];
  }
}

/**
 * What the bundle scan searches for besides the service key: each form of the
 * database password, and BETTER_AUTH_SECRET's value. A secret that is missing,
 * a password with no form, and any form shorter than MIN_SCANNABLE_SECRET are
 * named in `unscannable` instead: a zero-hit scan for them would prove nothing.
 */
export function otherSecretNeedles(
  databaseUrl: string | null,
  authSecret: string | null
): { needles: Array<{ label: string; value: string }>; unscannable: string[] } {
  const passwordForms = databaseUrl ? databasePasswordForms(databaseUrl) : [];
  const needles = [
    ...passwordForms.map((value, i) => ({ label: i === 0 ? "database password" : "database password, decoded", value })),
    { label: "BETTER_AUTH_SECRET value", value: authSecret ?? "" },
  ];
  const unscannable = [
    ...(passwordForms.length === 0 ? ["database password"] : []),
    ...needles.filter(({ value }) => value.length < MIN_SCANNABLE_SECRET).map(({ label }) => label),
  ];
  return { needles, unscannable };
}

// --------------------------------------------------------------------- main

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  const requireBundle = argv.includes("--require-bundle");
  const problems: string[] = [];
  let inconclusive = false;

  console.info("Server-secret containment gate\n");

  // ---- clause 1: import graph -------------------------------------------
  console.info("[1/2] import graph        (no build required)");

  const missingSeed = SEEDS.find((seed) => !existsSync(seed.path));
  if (missingSeed) {
    console.error(`  INCONCLUSIVE — seed module not found: ${relative(ROOT, missingSeed.path)}`);
    console.error("  (was it renamed? update SEEDS in this script)");
    return 2;
  }

  const importGraph = buildImportGraph();
  for (const seed of SEEDS) {
    const graph = buildValueClosure(seed.path, importGraph);
    console.info(`  value-import closure from ${relative(ROOT, seed.path)} (${seed.holds}): ${graph.closureSize} files`);

    if (!graph.reachesApiRoute) {
      console.error("  CONTROL FAILED — closure reaches no app/api route.");
      console.error("  Module resolution is broken, so 'no client modules' proves nothing.");
      inconclusive = true;
    }

    console.info(`  "use client" files in closure: ${graph.clientModules.length}`);
    if (graph.clientModules.length > 0) {
      for (const hit of graph.clientModules) {
        const chain = graph.chains.get(hit) ?? [];
        console.error(`\n  !! ${chain.join("\n       <- ")}`);
      }
      problems.push(
        `${graph.clientModules.length} client module(s) value-import ${relative(ROOT, seed.path)}, which holds ${seed.holds}`
      );
    }
  }
  if (problems.length === 0 && !inconclusive) {
    console.info("  PASS");
  }

  // ---- clause 2: bundle scan --------------------------------------------
  console.info("\n[2/2] bundle scan         .next/static");

  const serviceKey = readEnvVar("SUPABASE_SERVICE_ROLE_KEY");
  const control =
    readEnvVar("NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? readEnvVar("NEXT_PUBLIC_SUPABASE_URL");
  const { needles: otherSecrets, unscannable } = otherSecretNeedles(
    readEnvVar("DATABASE_URL"),
    readEnvVar("BETTER_AUTH_SECRET")
  );

  const available = BUNDLE_DIRS.filter((b) => existsSync(b.path));
  // --require-bundle demands a PRODUCTION build; a dev bundle never satisfies the gate.
  const target = requireBundle
    ? available.find((b) => b.kind === "production")
    : available[0];

  if (!target) {
    const detail = requireBundle
      ? "no production build found at .next/static"
      : "no build output found";
    if (requireBundle) {
      console.error(`  FAILED — ${detail}. Run \`npm run build\` first.`);
      problems.push("pre-deploy gate ran without a production build");
    } else {
      console.info(`  SKIPPED — ${detail}. Run \`npm run build\`, then re-run with --require-bundle.`);
    }
  } else if (!serviceKey) {
    console.error("  INCONCLUSIVE — SUPABASE_SERVICE_ROLE_KEY not set and not in .env.local.");
    console.error("  Cannot search for a value the gate cannot read.");
    inconclusive = true;
  } else if (!control) {
    console.error("  INCONCLUSIVE — no NEXT_PUBLIC_* control value available.");
    console.error("  Without a positive control a zero-hit scan proves nothing.");
    inconclusive = true;
  } else if (unscannable.length > 0) {
    console.error(`  INCONCLUSIVE — ${unscannable.join(" and ")} not set, or shorter than ${MIN_SCANNABLE_SECRET} characters.`);
    console.error("  Cannot search for a value the gate cannot read, or one that unrelated text could match.");
    inconclusive = true;
  } else {
    const scan = scanBundle(target.path, target.kind, serviceKey, control, otherSecrets);
    console.info(`  scanned ${scan.filesScanned} files in ${relative(ROOT, scan.dir)} (${scan.kind} build)`);

    if (scan.controlHits.length === 0) {
      console.error("  CONTROL FAILED — the public anon value was not found in the bundle.");
      console.error("  The scan is not reading real chunks; a zero-hit result is meaningless.");
      inconclusive = true;
    } else {
      console.info(`  positive control (anon key): found in ${scan.controlHits.length} chunk(s)   OK`);
    }

    const report = (label: string, hits: string[]) => {
      console.info(`  ${label}: ${hits.length} hits`);
      for (const h of hits.slice(0, 10)) console.error(`      !! ${h}`);
      if (hits.length > 10) console.error(`      ... and ${hits.length - 10} more`);
    };

    report("service key value    ", scan.valueHits);
    report("JWT signature segment", scan.signatureHits);
    report("SUPABASE_SERVICE_ROLE_KEY", scan.nameHits);
    for (const { label, hits } of scan.secretHits) report(label, hits);

    const leaked =
      scan.valueHits.length + scan.signatureHits.length + scan.nameHits.length;
    const otherLeaked = scan.secretHits.reduce((sum, { hits }) => sum + hits.length, 0);
    if (leaked > 0) problems.push(`${leaked} service-role reference(s) in browser-served output`);
    if (otherLeaked > 0) problems.push(`${otherLeaked} database password or Better Auth secret value(s) in browser-served output`);
    if (leaked + otherLeaked === 0 && scan.controlHits.length > 0) {
      console.info("  PASS");
    }

    if (target.kind === "development" && !requireBundle) {
      console.info(
        "\n  NOTE: this was a development build. The pre-deploy gate requires a" +
          "\n  production build — re-run with --require-bundle after `npm run build`."
      );
    }
  }

  // ---- verdict -----------------------------------------------------------
  console.info("");
  if (problems.length > 0) {
    console.error(`FAILED — ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      "\nThe service-role key bypasses RLS, and the database password and Better" +
        "\nAuth's secret open every login. Anything reaching the browser with one of" +
        "\nthem grants every visitor that access. Do not deploy."
    );
    return 1;
  }
  if (inconclusive) {
    console.error("INCONCLUSIVE — a positive control failed; the gate proved nothing.");
    console.error("Fix the control before trusting this result.");
    return 2;
  }
  if (!target && !requireBundle) {
    console.info("PARTIAL — import graph clean; bundle clause skipped (no build).");
    return 0;
  }
  console.info("PASS");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
