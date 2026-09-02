/**
 * Wire proofs for the measurement-log workstream (docs/MEASUREMENT-LOG-PLAN.md
 * §2 rule 7, §5). Records the raw JSON of the routes whose shape must not move
 * when body measurements change store, so a before/after diff proves it.
 *
 *   npx tsx scripts/wire-proof-measurements.ts record before
 *   npx tsx scripts/wire-proof-measurements.ts record after
 *   npx tsx scripts/wire-proof-measurements.ts diff before after
 *
 * Needs a running `next dev` on WIRE_PROOF_BASE (default http://localhost:3000)
 * and the linked DEV project in .env.local. Sessions are minted with no
 * browser: `generateLink` (sends no email) → `verifyOtp` → the @supabase/ssr
 * cookie jar, whose cookies become the Cookie header the app's auth helpers
 * read. Recordings go to WIRE_PROOF_DIR (default ./.wire-proofs, gitignored by
 * being outside the tree when the scratchpad is passed) — they contain health
 * data and are never committed.
 *
 * A vitest that mocks `supabaseAdmin` proves nothing about a wire; this is the
 * request-level harness the plan asks for.
 */
import "./env-bootstrap";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.WIRE_PROOF_BASE ?? "http://localhost:3000";
const OUT_ROOT = process.env.WIRE_PROOF_DIR ?? join(process.cwd(), ".wire-proofs");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// The two proof subjects the plan names (§6 commit 2) and their coach.
const COACH_EMAIL = "samuel.k@taboola.com";
const SUBJECTS = [
  {
    label: "fixture",
    email: "perf-client@fixture.local",
    clientId: "5ca1ec1e-0000-4000-8000-000000000001",
  },
  {
    label: "sam",
    email: "s.kalepa91@gmail.com",
    clientId: "f87bee53-0974-46d3-b1fb-34c14af6a8b5",
  },
] as const;

const DETAILS_PER_CLIENT = 3;

/**
 * Routes whose values change BY DESIGN (D6 gives the progress series
 * coach-logged readings; the series route gains five metrics, per-point
 * sources and a baseline; D8 makes "now" the newest reading, so a stale cache
 * on the comparison and profile reads may print a different number). Their
 * proof compares the KEY TREE; every other file must be byte-identical.
 */
const SHAPE_ONLY = [
  /^client-progress/,
  /^coach-series/,
  /^coach-comparison-/,
  /^client-me/,
];

type Session = { label: string; cookie: string };

function need(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name} in .env.local`);
  return value;
}

async function mintSession(email: string, label: string): Promise<Session> {
  const url = need("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  const admin = createClient(url, need("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError || !link?.properties?.email_otp) {
    throw new Error(`generateLink failed for ${email}: ${linkError?.message ?? "no otp"}`);
  }

  const anon = createClient(url, need("NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON_KEY), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
    email,
    token: link.properties.email_otp,
    type: "email",
  });
  if (verifyError || !verified.session) {
    throw new Error(`verifyOtp failed for ${email}: ${verifyError?.message ?? "no session"}`);
  }

  const jar = new Map<string, string>();
  const ssr = createServerClient(url, need("NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON_KEY), {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) jar.set(name, value);
      },
    },
  });
  const { error: setError } = await ssr.auth.setSession({
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
  });
  if (setError) throw new Error(`setSession failed for ${email}: ${setError.message}`);
  if (jar.size === 0) throw new Error(`No auth cookie minted for ${email}`);

  const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  return { label, cookie };
}

async function get(session: Session, path: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Cookie: session.cookie, Origin: BASE, Accept: "application/json" },
  });
  const body = await res.text();
  return { status: res.status, body };
}

async function recordOne(
  dir: string,
  name: string,
  session: Session,
  path: string
): Promise<unknown> {
  const { status, body } = await get(session, path);
  if (status !== 200) {
    throw new Error(`${session.label} ${path} → ${status}: ${body.slice(0, 300)}`);
  }
  writeFileSync(join(dir, `${name}.json`), body);
  console.info(`  ${name}  ←  ${path}`);
  return JSON.parse(body) as unknown;
}

type CheckInList = { data: Array<{ id: string; createdAt: string }> };
type StartDateHolder = { data: { startDate?: string } };

async function record(label: string): Promise<void> {
  const dir = join(OUT_ROOT, label);
  mkdirSync(dir, { recursive: true });
  console.info(`Recording "${label}" into ${dir} against ${BASE}`);

  const coach = await mintSession(COACH_EMAIL, "coach");

  for (const subject of SUBJECTS) {
    const client = await mintSession(subject.email, subject.label);
    const p = subject.label;

    const list = (await recordOne(
      dir,
      `client-check-ins-${p}`,
      client,
      "/api/client/check-ins?limit=20"
    )) as CheckInList;
    const ids = list.data.slice(0, DETAILS_PER_CLIENT).map((row) => row.id);

    for (const id of ids) {
      await recordOne(dir, `client-check-in-${p}-${id}`, client, `/api/client/check-ins/${id}`);
      await recordOne(dir, `coach-check-in-${p}-${id}`, coach, `/api/check-in/${id}`);
      await recordOne(dir, `coach-comparison-${p}-${id}`, coach, `/api/check-in/${id}/comparison`);
    }

    await recordOne(dir, `client-progress-${p}-90`, client, "/api/client/progress");
    await recordOne(dir, `client-progress-${p}-365`, client, "/api/client/progress?days=365");
    const me = (await recordOne(dir, `client-me-${p}`, client, "/api/client/me")) as StartDateHolder;

    await recordOne(
      dir,
      `coach-series-${p}`,
      coach,
      `/api/clients/${subject.clientId}/measurement-series`
    );
    // The `from` form exists only while the route takes the parameter; a
    // recording that cannot be repeated is reported, never diffed.
    if (me.data.startDate && process.env.WIRE_PROOF_WITH_FROM === "1") {
      await recordOne(
        dir,
        `coach-series-${p}-from`,
        coach,
        `/api/clients/${subject.clientId}/measurement-series?from=${me.data.startDate}`
      );
    }
  }
  console.info("Done.");
}

/** Every path through a JSON value, as `a.b[].c` strings with array items collapsed. */
function keyTree(value: unknown, prefix = ""): Set<string> {
  const out = new Set<string>();
  if (Array.isArray(value)) {
    out.add(`${prefix}[]`);
    for (const item of value) for (const key of keyTree(item, `${prefix}[]`)) out.add(key);
    return out;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k;
      out.add(path);
      for (const key of keyTree(v, path)) out.add(key);
    }
    return out;
  }
  out.add(`${prefix}:${value === null ? "null" : typeof value}`);
  return out;
}

function diff(before: string, after: string): void {
  const a = join(OUT_ROOT, before);
  const b = join(OUT_ROOT, after);
  const names = new Set([...readdirSync(a), ...readdirSync(b)]);
  let failures = 0;

  for (const name of [...names].sort()) {
    const pa = join(a, name);
    const pb = join(b, name);
    if (!existsSync(pa) || !existsSync(pb)) {
      console.info(`~ ${name}: recorded in ${existsSync(pa) ? before : after} only`);
      continue;
    }
    const ta = readFileSync(pa, "utf8");
    const tb = readFileSync(pb, "utf8");
    if (ta === tb) {
      console.info(`= ${name}: byte-identical`);
      continue;
    }
    const shapeOnly = SHAPE_ONLY.some((re) => re.test(name));
    const ka = keyTree(JSON.parse(ta));
    const kb = keyTree(JSON.parse(tb));
    const removed = [...ka].filter((k) => !kb.has(k));
    const added = [...kb].filter((k) => !ka.has(k));
    if (shapeOnly) {
      if (removed.length === 0) {
        console.info(
          `≈ ${name}: values differ by design; shape kept${added.length ? `, added ${added.join(", ")}` : ""}`
        );
      } else {
        failures += 1;
        console.error(`✗ ${name}: shape LOST ${removed.join(", ")}`);
      }
      continue;
    }
    failures += 1;
    console.error(
      `✗ ${name}: bytes differ${removed.length ? `; keys lost ${removed.join(", ")}` : ""}${added.length ? `; keys added ${added.join(", ")}` : ""}`
    );
  }

  if (failures > 0) {
    console.error(`${failures} proof(s) failed`);
    process.exitCode = 1;
  } else {
    console.info("Every proof holds.");
  }
}

async function main(): Promise<void> {
  const [mode, first, second] = process.argv.slice(2);
  if (mode === "record" && first) return record(first);
  if (mode === "diff" && first && second) return diff(first, second);
  throw new Error("usage: record <label> | diff <before> <after>");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
