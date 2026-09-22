/**
 * Wire proofs for the goals rebuild (docs/MEASUREMENT-LOG-PLAN.md §6 commit 8d):
 * the four client endpoints keep their fields exactly, now filled from the goal
 * in force on the client's today instead of the profile's copy.
 *
 *   npx tsx scripts/wire-proof-goals.ts record before
 *   npx tsx scripts/wire-proof-goals.ts record after
 *   npx tsx scripts/wire-proof-goals.ts diff before after
 *
 * Needs a running `next dev` on WIRE_PROOF_BASE (default http://localhost:3000)
 * and the linked DEV project in .env.local. Recordings go to WIRE_PROOF_DIR
 * (default ./.wire-proofs) — they carry health data, so point it outside the
 * tree and never commit them.
 *
 * Sam's recordings must be byte-identical: the profile's copy and the goal
 * agree for him. The fixture's must keep their shape — its copy held a stale
 * 170 kg against the goal's 77.1. `PATCH /api/client/settings` is a write: it
 * sends the client's own timezone back, a no-op that still moves the client's
 * `updatedAt` — which the next recording's `/api/client/me` then reads — so
 * that one key is masked on those two wires before comparing.
 */
import "./env-bootstrap";

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mintSession, send, PROOF_BASE, type ProofSession } from "./proof-session";

const OUT_ROOT = process.env.WIRE_PROOF_DIR ?? join(process.cwd(), ".wire-proofs");

const SUBJECTS = [
  { label: "fixture", email: "perf-client@fixture.local", exact: false },
  { label: "sam", email: "s.kalepa91@gmail.com", exact: true },
] as const;

const MASKED = ["client-settings-", "client-me-"];

/** A recorded response with the one key a no-op write still moves masked. */
function normalise(name: string, text: string): string {
  if (!MASKED.some((prefix) => name.startsWith(prefix))) return text;
  const parsed = JSON.parse(text) as { data?: { updatedAt?: string } };
  if (parsed.data?.updatedAt) parsed.data.updatedAt = "<masked: every write moves it>";
  return JSON.stringify(parsed);
}

async function recordOne(
  dir: string,
  name: string,
  session: ProofSession,
  method: "GET" | "PATCH",
  path: string,
  body?: unknown
): Promise<unknown> {
  const res = await send(session, method, path, body);
  if (res.status !== 200) {
    throw new Error(`${session.label} ${method} ${path} → ${res.status}: ${res.text.slice(0, 300)}`);
  }
  writeFileSync(join(dir, `${name}.json`), res.text);
  console.info(`  ${name}  ←  ${method} ${path}`);
  return res.json;
}

async function record(label: string): Promise<void> {
  const dir = join(OUT_ROOT, label);
  mkdirSync(dir, { recursive: true });
  console.info(`Recording "${label}" into ${dir} against ${PROOF_BASE}`);

  for (const subject of SUBJECTS) {
    const client = await mintSession(subject.email, subject.label);
    const p = subject.label;
    const me = (await recordOne(dir, `client-me-${p}`, client, "GET", "/api/client/me")) as {
      data: { timezone?: string | null; unitPreference?: string };
    };
    await recordOne(dir, `client-progress-${p}`, client, "GET", "/api/client/progress");
    await recordOne(dir, `client-journey-${p}`, client, "GET", "/api/client/journey");
    // Send back what the client already has: nothing changes but updatedAt.
    const settings = me.data.timezone
      ? { timezone: me.data.timezone }
      : { unitPreference: me.data.unitPreference ?? "metric" };
    await recordOne(dir, `client-settings-${p}`, client, "PATCH", "/api/client/settings", settings);
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
  const names = [...new Set([...readdirSync(a), ...readdirSync(b)])].sort();
  let failures = 0;

  for (const name of names) {
    const pa = join(a, name);
    const pb = join(b, name);
    if (!existsSync(pa) || !existsSync(pb)) {
      failures += 1;
      console.error(`✗ ${name}: recorded in ${existsSync(pa) ? before : after} only`);
      continue;
    }
    const ta = normalise(name, readFileSync(pa, "utf8"));
    const tb = normalise(name, readFileSync(pb, "utf8"));
    const exact = SUBJECTS.some((s) => s.exact && name.endsWith(`-${s.label}.json`));
    if (ta === tb) {
      const masked = MASKED.some((prefix) => name.startsWith(prefix));
      console.info(`= ${name}: byte-identical${masked ? " (updatedAt masked)" : ""}`);
      continue;
    }
    const ka = keyTree(JSON.parse(ta));
    const kb = keyTree(JSON.parse(tb));
    const removed = [...ka].filter((k) => !kb.has(k));
    const added = [...kb].filter((k) => !ka.has(k));
    if (!exact && removed.length === 0 && added.length === 0) {
      console.info(`≈ ${name}: values differ, every field and type kept`);
      continue;
    }
    failures += 1;
    console.error(
      `✗ ${name}: ${exact ? "bytes differ" : "shape changed"}${removed.length ? `; lost ${removed.join(", ")}` : ""}${added.length ? `; added ${added.join(", ")}` : ""}`
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
