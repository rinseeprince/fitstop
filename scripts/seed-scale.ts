/**
 * Production-realistic scale seed.
 *
 *   npx tsx scripts/seed-scale.ts --confirm
 *   npx tsx scripts/seed-scale.ts --confirm --scale 0.05      # 2 coaches, for debugging
 *   npx tsx scripts/seed-scale.ts --confirm --teardown
 *
 * Target shape at scale 1.0: 25 coaches x 20 clients = 500 clients over a
 * 180-day window, with the real logging fan-out measured off live data
 * (5.57 exercise_logs per session_log, 3.97 set_logs per exercise_log).
 *
 * Deterministic: the same --seed always produces byte-identical data, so a
 * before/after benchmark compares like with like. Nothing reads the wall clock —
 * the anchor date is a flag, defaulting to a fixed date rather than "today".
 *
 * Removable: every row carries a reserved UUID-namespace primary key, teardown
 * deletes by PK range scan in explicit reverse dependency order, and asserts
 * that no row outside the namespace was touched.
 *
 * See scripts/seed/ for the pieces: ids (the marker), rng (determinism),
 * model (engagement realism), generate (rows), db (batching/ANALYZE), teardown.
 */

import "./env-bootstrap";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  makeAdminClient, insertInBatches, countRows, analyzeTables, writeManifest,
  type WriteLedger, type Manifest,
} from "./seed/db";
import { seedUuid, seedEmail, SEED_ID_LO, SEED_ID_HI, SEED_EMAIL_DOMAIN } from "./seed/ids";
import { generateCoachBundle, fallbackCatalog, type CatalogExercise, type SeedContext } from "./seed/generate";
import { teardown, TEARDOWN_ORDER } from "./seed/teardown";
import { EXERCISE_POOL } from "./seed/model";

// ------------------------------------------------------------------ guards

/** The production project. The seed must never run here. */
const PROD_REF = "etezzztgafcotyahgijk";
/** Targets this script is allowed to write to without an explicit override. */
const KNOWN_TARGETS = new Set(["aeaphsslctwcmebldrzx", "local"]);

type Target = { ref: string; url: string; isLocal: boolean };

/**
 * Resolve the target, or refuse.
 *
 * Four guards, in order of severity:
 *   1. The URL must be present and parseable       -> otherwise UNKNOWN, refuse.
 *   2. The ref must not be production              -> refuse.
 *   3. The ref must be recognised (or named via --allow-ref) -> refuse.
 *   4. --confirm must be present                   -> refuse (checked by caller).
 *
 * Guard 3 is an allowlist rather than a denylist on purpose: a guard that only
 * rejects what it recognises will happily run against anything it does not.
 */
function resolveTarget(allowRef: string | null): Target {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url) {
    fail(
      "TARGET UNKNOWN — NEXT_PUBLIC_SUPABASE_URL is not set.",
      "Refusing to run: a seed that cannot identify its target cannot be guarded."
    );
  }

  // Both tests are anchored at BOTH ends. The local test previously had no `$`,
  // so any URL whose authority merely began with `localhost` — including
  // `https://localhost@<prod-ref>.supabase.co`, where the real host is
  // production and `localhost` is only userinfo — was classified local, handed
  // the ref "local", and waved past both the production refusal and the
  // allowlist. An unanchored guard is not a guard.
  const local = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/i.test(url);
  const hosted = url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/i);

  if (!local && !hosted) {
    fail(
      `TARGET UNKNOWN — cannot extract a project ref from NEXT_PUBLIC_SUPABASE_URL (${url}).`,
      "Refusing to run: the URL matches neither a local stack nor https://<ref>.supabase.co."
    );
  }

  const ref = local ? "local" : hosted![1].toLowerCase();

  if (ref === PROD_REF) {
    fail(
      `TARGET IS PRODUCTION (${ref}).`,
      "Refusing to run. This script never writes to the production project."
    );
  }

  if (!KNOWN_TARGETS.has(ref) && ref !== allowRef) {
    fail(
      `TARGET NOT RECOGNISED (${ref}).`,
      `Known targets: ${[...KNOWN_TARGETS].join(", ")}.`,
      `If this is intentional, re-run with --allow-ref=${ref} to name it explicitly.`
    );
  }

  return { ref, url, isLocal: local };
}

function fail(...lines: string[]): never {
  console.error(`\n  ✖ ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`    ${l}`);
  console.error("");
  process.exit(1);
}

// --------------------------------------------------------------------- args

type Args = {
  confirm: boolean;
  teardown: boolean;
  scale: number;
  seed: number;
  anchorDate: string;
  windowDays: number;
  coaches: number;
  clientsPerCoach: number;
  personas: number;
  saturatedCoaches: number;
  password: string;
  allowRef: string | null;
  manifestPath: string;
  skipAnalyze: boolean;
};

const DEFAULTS: Args = {
  confirm: false,
  teardown: false,
  scale: 1,
  seed: 20260730,
  // Fixed, not "today": the dataset must be reproducible across days.
  anchorDate: "2026-07-30",
  windowDays: 180,
  coaches: 25,
  clientsPerCoach: 20,
  personas: 10,
  // The benchmark's expensive reads are per-coach and per-client, so the
  // dataset has to CONTAIN the worst case, not merely average toward it. These
  // coaches get a full roster where every client carries the complete window at
  // top-of-scale engagement — the shape the roster query has to survive.
  saturatedCoaches: 3,
  password: "seed-password-2026",
  allowRef: null,
  manifestPath: "scratchpad/seed-manifest.json",
  skipAnalyze: false,
};

function parseArgs(argv: readonly string[]): Args {
  const out: Args = { ...DEFAULTS };
  const known = new Set([
    "--confirm", "--teardown", "--scale", "--seed", "--anchor-date", "--window-days",
    "--coaches", "--clients-per-coach", "--personas", "--saturated-coaches",
    "--password", "--allow-ref", "--manifest", "--skip-analyze", "--help",
  ]);

  for (let i = 0; i < argv.length; i++) {
    // `[\s\S]` rather than the `s` (dotAll) flag: the repo's tsc target predates
    // es2018, where that flag is a compile error.
    const [flag, inlineValue] = argv[i].includes("=") ? argv[i].split(/=([\s\S]*)/) : [argv[i], undefined];
    // The old scale seed silently ignored unknown flags, so a typo'd guard
    // simply did nothing. Reject them loudly instead.
    if (!known.has(flag)) fail(`Unknown flag: ${argv[i]}`, "Run with --help for the flag list.");
    const value = (): string => {
      const v = inlineValue ?? argv[++i];
      if (v === undefined) fail(`${flag} requires a value.`);
      return v;
    };
    switch (flag) {
      case "--help": printHelp(); process.exit(0); break;
      case "--confirm": out.confirm = true; break;
      case "--teardown": out.teardown = true; break;
      case "--skip-analyze": out.skipAnalyze = true; break;
      case "--scale": out.scale = Number(value()); break;
      case "--seed": out.seed = Number(value()); break;
      case "--anchor-date": out.anchorDate = value(); break;
      case "--window-days": out.windowDays = Number(value()); break;
      case "--coaches": out.coaches = Number(value()); break;
      case "--clients-per-coach": out.clientsPerCoach = Number(value()); break;
      case "--personas": out.personas = Number(value()); break;
      case "--saturated-coaches": out.saturatedCoaches = Number(value()); break;
      case "--password": out.password = value(); break;
      case "--allow-ref": out.allowRef = value(); break;
      case "--manifest": out.manifestPath = value(); break;
    }
  }

  if (!Number.isFinite(out.scale) || out.scale <= 0 || out.scale > 1) {
    fail(`--scale must be in (0, 1]; got ${out.scale}.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.anchorDate)) {
    fail(`--anchor-date must be YYYY-MM-DD; got ${out.anchorDate}.`);
  }

  // Every numeric flag, not just --scale. `Number("twenty")` is NaN, and
  // `Math.max(1, Math.round(NaN))` is NaN rather than 1 — so a typo used to
  // produce a run that wrote nothing, ANALYZEd nothing, still wrote a "success"
  // manifest and exited 0. That is the same silent-no-op the unknown-flag check
  // above exists to prevent.
  const positiveInt = (name: string, v: number, min: number, max: number): void => {
    if (!Number.isInteger(v) || v < min || v > max) {
      // String(v), not JSON.stringify(v): the latter renders NaN as "null",
      // which is exactly the case this check exists to name clearly.
      fail(`${name} must be an integer in [${min}, ${max}]; got ${String(v)}.`);
    }
  };
  positiveInt("--seed", out.seed, 0, Number.MAX_SAFE_INTEGER);
  positiveInt("--window-days", out.windowDays, 1, 3650);
  positiveInt("--coaches", out.coaches, 1, 10_000);
  positiveInt("--clients-per-coach", out.clientsPerCoach, 1, 10_000);
  positiveInt("--personas", out.personas, 0, 10_000);
  positiveInt("--saturated-coaches", out.saturatedCoaches, 0, 10_000);
  if (out.password.length < 8) {
    fail(`--password must be at least 8 characters (Supabase rejects shorter).`);
  }

  out.coaches = Math.max(1, Math.round(out.coaches * out.scale));

  // Clamping rather than failing: --scale exists precisely to shrink the run,
  // and a Stage-1 smoke at --scale 0.05 resolves to a single coach. Saturating
  // that one coach is the right call (it exercises the dense path), but it must
  // be reported, not silently applied.
  if (out.saturatedCoaches > out.coaches) {
    console.warn(
      `\n  ⚠ --saturated-coaches ${out.saturatedCoaches} exceeds the ${out.coaches} coach(es) at ` +
        `--scale ${out.scale}; clamping to ${out.coaches}.\n` +
        "    Every coach is therefore worst-case and the engagement skew is NOT represented in this run.\n"
    );
    out.saturatedCoaches = out.coaches;
  }
  return out;
}

function printHelp(): void {
  console.info(`
  Scale seed for performance benchmarking.

    --confirm                 REQUIRED to write anything.
    --teardown                Remove every seeded row, then exit.
    --scale <0..1>            Fraction of the coach count. 0.05 = 2 coaches.
    --seed <int>              PRNG seed. Same seed => identical data.
    --anchor-date <ISO>       The "today" the window ends on. Default ${DEFAULTS.anchorDate}.
    --window-days <n>         History length. Default ${DEFAULTS.windowDays}.
    --coaches <n>             Coaches at scale 1.0. Default ${DEFAULTS.coaches}.
    --clients-per-coach <n>   Default ${DEFAULTS.clientsPerCoach}.
    --personas <n>            Coaches AND clients given a real login. Default ${DEFAULTS.personas}.
    --saturated-coaches <n>   Coaches whose FULL roster gets the complete window at top
                              engagement — the worst case the roster query must survive.
                              Default ${DEFAULTS.saturatedCoaches}. Everyone else keeps the skew.
    --password <str>          Password for those logins.
    --allow-ref <ref>         Authorise an unrecognised project ref.
    --manifest <path>         Where to write the run manifest.
    --skip-analyze            Skip ANALYZE. Only for local debugging — it invalidates the benchmark.
`);
}

// ----------------------------------------------------------------- progress

function makeProgress(totalEstimate: number, startedMs: number) {
  let done = 0;
  return {
    add(n: number) { done += n; },
    line(label: string): string {
      const pct = totalEstimate > 0 ? Math.min(100, (done / totalEstimate) * 100) : 0;
      const elapsed = (Date.now() - startedMs) / 1000;
      const rate = done / Math.max(elapsed, 0.001);
      const remaining = Math.max(0, totalEstimate - done);
      const eta = rate > 0 ? remaining / rate : 0;
      return (
        `  ${label.padEnd(22)} ${done.toLocaleString().padStart(9)} rows  ` +
        `${pct.toFixed(1).padStart(5)}%  ${Math.round(rate).toLocaleString()}/s  ` +
        `elapsed ${fmt(elapsed)}  eta ${fmt(eta)}`
      );
    },
    get done() { return done; },
  };
}

function fmt(seconds: number): string {
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

// --------------------------------------------------------------------- main

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const target = resolveTarget(args.allowRef);

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) fail("SUPABASE_SERVICE_ROLE_KEY is not set.", "Never hardcode it; it belongs in .env.local.");

  if (!args.confirm) {
    fail(
      "--confirm is required.",
      `Target would be: ${target.ref} (${target.url})`,
      args.teardown ? "This would DELETE every seeded row." : "This would WRITE a large dataset."
    );
  }

  const db = makeAdminClient(target.url, serviceKey);

  console.info(`\n  target      ${target.ref}  (${target.url})`);
  console.info(`  namespace   ${SEED_ID_LO} .. ${SEED_ID_HI}`);
  console.info(`  auth domain @${SEED_EMAIL_DOMAIN}`);

  if (args.teardown) {
    console.info("\n  TEARDOWN — deleting seeded rows in reverse dependency order.\n");
    const report = await teardown(db, (table, removed) => {
      if (removed > 0) console.info(`    ${table.padEnd(30)} ${removed.toLocaleString().padStart(9)} removed`);
    });
    const total = report.perTable.reduce((s, t) => s + t.removed, 0);
    console.info(`\n  removed ${total.toLocaleString()} rows across ${report.perTable.length} tables`);
    console.info(`  removed ${report.authUsersRemoved} auth users (+${report.profilesRemoved} profiles by cascade)`);
    console.info("  every table's unmarked row count was unchanged — no collateral damage.\n");
    if (!args.skipAnalyze) {
      console.info("  running ANALYZE on the emptied tables...");
      analyzeTables(TEARDOWN_ORDER, !target.isLocal, target.ref);
      console.info("  ANALYZE complete.\n");
    }
    return;
  }

  // Refuse to stack a second dataset on top of an existing one — the PK range
  // would collide and the manifest would be wrong.
  const existing = await countRows(db, "clients");
  if (existing.marked > 0) {
    fail(
      `${existing.marked} seeded clients already exist in the namespace.`,
      "Run --teardown first. Seeding on top would collide on primary keys."
    );
  }

  const catalog = await loadCatalog(db);
  const totalClients = args.coaches * args.clientsPerCoach;
  const personaClientIndices = new Set<number>(
    Array.from({ length: Math.min(args.personas, totalClients) }, (_, i) => i)
  );

  // Coaches 0..n-1, so a saturated coach is also a persona coach at the default
  // settings — logging in as coach000 lands on the densest roster in the
  // dataset, which is the one worth looking at.
  const saturatedCoachIndices = new Set<number>(
    Array.from({ length: Math.min(args.saturatedCoaches, args.coaches) }, (_, i) => i)
  );

  const ctx: SeedContext = {
    seed: args.seed,
    anchorDate: args.anchorDate,
    windowDays: args.windowDays,
    clientsPerCoach: args.clientsPerCoach,
    catalog,
    personaClientIndices,
    saturatedCoachIndices,
  };

  console.info(`\n  coaches     ${args.coaches}`);
  console.info(`  clients     ${totalClients}  (${args.clientsPerCoach}/coach)`);
  console.info(`  window      ${args.windowDays} days ending ${args.anchorDate}`);
  console.info(`  seed        ${args.seed}`);
  console.info(`  personas    ${Math.min(args.personas, args.coaches)} coaches + ${personaClientIndices.size} clients with real logins`);
  console.info(
    `  saturated   ${saturatedCoachIndices.size} coaches x ${args.clientsPerCoach} clients ` +
      `= ${saturatedCoachIndices.size * args.clientsPerCoach} clients at full ${args.windowDays}-day window, ` +
      "full plan coverage, top engagement"
  );
  console.info(`  catalog     ${catalog.length} exercises${catalog[0]?.id ? "" : "  (FALLBACK — exercise_id will be NULL)"}\n`);

  const unmarkedBefore: Record<string, number> = {};
  for (const table of TEARDOWN_ORDER) {
    unmarkedBefore[table] = (await countRows(db, table)).unmarked;
  }

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const ledger: WriteLedger = new Map();
  // ~3,300 rows/client at the measured fan-out; only used for the ETA.
  const progress = makeProgress(totalClients * 3300, startedMs);

  for (let coachIdx = 0; coachIdx < args.coaches; coachIdx++) {
    const isPersonaCoach = coachIdx < args.personas;
    let steps = generateCoachBundle(coachIdx, ctx);

    if (isPersonaCoach) {
      // handle_new_user creates the coaches row itself for a non-invited signup,
      // and coaches_email_key is NOT its ON CONFLICT target — so pre-inserting a
      // row with the same email makes createUser fail with 23505 inside the
      // trigger. Create the user first, then adopt the row it produced.
      const coachRow = steps.find((s) => s.table === "coaches")!.rows[0];
      const authId = await ensureAuthUser(db, seedEmail("coach", coachIdx), args.password);
      // .select() so a zero-row match is detectable. Without it the update
      // reports success having matched nothing, and because the `coaches`
      // insert is filtered out below, the coach would simply never exist —
      // every client insert for this coach then fails on the coach_id FK, or
      // worse, succeeds against a stale row from a previous run.
      const { data: adopted, error } = await db
        .from("coaches")
        .update({ ...coachRow, user_id: authId })
        .eq("user_id", authId)
        .select("id");
      if (error) throw new Error(`adopting trigger-created coaches row: ${error.message}`);
      if ((adopted?.length ?? 0) !== 1) {
        throw new Error(
          `adopting trigger-created coaches row for ${seedEmail("coach", coachIdx)}: expected exactly 1 row, ` +
            `matched ${adopted?.length ?? 0}. handle_new_user did not create the coaches row this script ` +
            "relies on (it derives role='trainer' only for a signup with no pending invitation). " +
            "Investigate before re-running — the namespace now holds a partial dataset."
        );
      }
      steps = steps.filter((s) => s.table !== "coaches");
    }

    for (const step of steps) {
      await insertInBatches(db, step.table, step.rows, ledger, {
        mode: step.mode,
        onConflict: step.onConflict,
      });
      if (step.mode !== "upsert") progress.add(step.rows.length);
    }

    // Persona clients: the invitation row is already in place, so the trigger
    // derives role='client' and writes only profiles. Link afterwards.
    for (let c = 0; c < args.clientsPerCoach; c++) {
      const clientIdx = coachIdx * args.clientsPerCoach + c;
      if (!personaClientIndices.has(clientIdx)) continue;
      const authId = await ensureAuthUser(db, seedEmail("client", clientIdx), args.password);
      const { error } = await db
        .from("clients")
        .update({ user_id: authId })
        .eq("id", seedUuid("client", coachIdx, c));
      if (error) throw new Error(`linking client ${clientIdx}: ${error.message}`);
    }

    console.info(progress.line(`coach ${coachIdx + 1}/${args.coaches}`));
  }

  const touched = [...ledger.keys()];
  console.info(`\n  wrote ${progress.done.toLocaleString()} rows across ${touched.length} tables in ${fmt((Date.now() - startedMs) / 1000)}\n`);
  for (const [table, n] of [...ledger.entries()].sort((a, b) => b[1] - a[1])) {
    console.info(`    ${table.padEnd(30)} ${n.toLocaleString().padStart(10)}`);
  }

  if (args.skipAnalyze) {
    console.warn(
      "\n  ⚠ ANALYZE SKIPPED. Planner statistics are stale, so EXPLAIN will report plans\n" +
        "    chosen from wrong row estimates. Do not benchmark this dataset.\n"
    );
  } else {
    console.info("\n  running ANALYZE on every touched table...");
    // `touched` comes from the insert ledger, which misses `coaches` when every
    // coach took the persona path (its insert is replaced by an adoption
    // UPDATE). ANALYZE must cover every table the run wrote, not every table it
    // INSERTed into.
    analyzeTables([...new Set([...touched, "coaches"])], !target.isLocal, target.ref);
    console.info("  ANALYZE complete — planner statistics are fresh.\n");
  }

  const manifest: Manifest = {
    seed: args.seed,
    anchorDate: args.anchorDate,
    windowDays: args.windowDays,
    coaches: args.coaches,
    clientsPerCoach: args.clientsPerCoach,
    scale: args.scale,
    targetRef: target.ref,
    idRange: { lo: SEED_ID_LO, hi: SEED_ID_HI },
    emailDomain: SEED_EMAIL_DOMAIN,
    written: Object.fromEntries(ledger),
    unmarkedBefore,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  writeManifest(args.manifestPath, manifest);
  console.info(`  manifest -> ${args.manifestPath}`);
  console.info(`  logins   -> coach000@${SEED_EMAIL_DOMAIN} .. / client000@${SEED_EMAIL_DOMAIN} .. (password: ${args.password})\n`);
}

/** Idempotent auth-user creation. Returns the user id either way. */
async function ensureAuthUser(
  db: SupabaseClient,
  email: string,
  password: string
): Promise<string> {
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // required for a later signInWithPassword
  });
  if (!error && data.user) return data.user.id;

  // Already present from a previous partial run — find it by paging.
  for (let page = 1; page <= 200; page++) {
    const list = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (list.error) throw new Error(`listUsers: ${list.error.message}`);
    const users = list.data?.users ?? [];
    const hit = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (users.length < 200) break;
  }
  throw new Error(`createUser failed for ${email}: ${error?.message ?? "unknown"}`);
}

/**
 * The live global exercise catalogue, so `exercise_id` is real and the
 * progression / PR RPCs (the top two entries on the benchmark target list) have
 * a signal to find. Falls back loudly rather than silently seeding NULLs.
 */
async function loadCatalog(db: SupabaseClient): Promise<CatalogExercise[]> {
  const { data, error } = await db
    .from("exercises")
    .select("id, name, category")
    .is("coach_id", null)
    .limit(400);
  if (error || !data || data.length === 0) {
    console.warn(
      `  ⚠ global exercises catalogue unavailable${error ? ` (${error.message})` : " (empty)"} — ` +
        "falling back to built-in names with exercise_id NULL.\n" +
        "    Progression/PR analytics will bucket everything as unknown. Seed the catalogue first\n" +
        "    (npx tsx scripts/seed-exercise-catalog.ts) for a representative benchmark."
    );
    return fallbackCatalog();
  }
  const baseByName = new Map(EXERCISE_POOL.map((e) => [e.name.toLowerCase(), e.base]));
  return data.map((row) => {
    const r = row as { id: string; name: string; category: string | null };
    return {
      id: r.id,
      name: r.name,
      compound: (r.category ?? "").toLowerCase() === "compound",
      base: baseByName.get(r.name.toLowerCase()) ?? 40,
    };
  });
}

main().catch((err: unknown) => {
  console.error(`\n  ✖ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
