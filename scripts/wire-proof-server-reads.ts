/**
 * Request-level proof of docs/DATA-ACCESS-LOCKDOWN-PLAN.md §6 commit 3: the
 * client's reads, activation and the attention feed read through the server,
 * against the linked DEV database through a running `next dev`.
 *
 *   WIRE_PROOF_DIR=<scratchpad> npx tsx scripts/wire-proof-server-reads.ts record before
 *   WIRE_PROOF_DIR=<scratchpad> npx tsx scripts/wire-proof-server-reads.ts record after
 *   WIRE_PROOF_DIR=<scratchpad> npx tsx scripts/wire-proof-server-reads.ts diff before after
 *   npx tsx scripts/wire-proof-server-reads.ts access before|after
 *
 * `record` writes every response whole — its status, Cache-Control, content
 * type and body — for the fixture client, Sam Kalepa and the client-app smoke
 * account (GET /api/client/me, GET /api/client/progress at 30, 90 and 365 days)
 * and for their coach (GET /api/dashboard/attention-feed). `diff` holds every file byte-identical: the
 * same rows through a different door, and /api/client/** is the React Native
 * contract. The recordings hold health data, so they go to WIRE_PROOF_DIR,
 * outside the tree, and are never committed.
 *
 * `access` proves the decisions with real sessions, on throwaway rows removed
 * at the end:
 *   1  the coach activates a pending client of theirs with no login → 200:
 *      active from the start date sent, with the first check-in and the
 *      message, audited as client.activate — and invited, because the read of
 *      the client's login (fire-and-forget, after the answer) found none
 *   2  the coach activates another coach's pending client → 403 Forbidden, the
 *      row as it was, nothing audited, nobody invited
 *   3  a signed-in client on the coach's attention feed → before: 404 "Coach
 *      not found", from the feed's own lookup; after: 401 "Unauthorized", the
 *      answer every coach route gives through the auth seam
 */
import "./env-bootstrap";

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { supabaseAdmin } from "@/services/supabase-admin";
import { appendMeasurements } from "@/services/measurements-service";
import { getClientTodayString } from "@/services/today-service";
import { addDaysToDateString } from "@/lib/date-helpers";
import { mintSession, send, PROOF_BASE, type ProofSession } from "./proof-session";

const COACH_EMAIL = "samuel.k@taboola.com";
const SUBJECTS = [
  { label: "fixture", email: "perf-client@fixture.local" },
  { label: "sam", email: "s.kalepa91@gmail.com" },
  // "Test intake form bug": the account every client-app smoke signs in as.
  { label: "smoke", email: "s.kalepa91+intake@gmail.com" },
] as const;
const PROGRESS_DAYS = [30, 90, 365] as const;
// The other coach whose client the owner's coach may not activate: the perf
// fixture's (scripts/perf-fixtures.ts).
const OTHER_COACH_ID = "5ca1ec0a-0000-4000-8000-000000000001";

// ---------------------------------------------------------------------------
// record / diff
// ---------------------------------------------------------------------------

function proofDir(label: string): string {
  const root = process.env.WIRE_PROOF_DIR;
  if (!root) throw new Error("Set WIRE_PROOF_DIR to a folder outside the tree (the scratchpad)");
  return join(root, "server-reads", label);
}

/** The whole response a browser receives, as one text: status, headers that matter, body. */
async function capture(session: ProofSession, path: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`${PROOF_BASE}${path}`, {
    headers: { Cookie: session.cookie, Origin: PROOF_BASE, Accept: "application/json" },
    redirect: "manual",
  });
  const body = await res.text();
  const text = [
    `status: ${res.status}`,
    `cache-control: ${res.headers.get("cache-control") ?? ""}`,
    `content-type: ${res.headers.get("content-type") ?? ""}`,
    "",
    body,
  ].join("\n");
  return { status: res.status, text };
}

async function recordOne(dir: string, name: string, session: ProofSession, path: string): Promise<void> {
  const { status, text } = await capture(session, path);
  if (status !== 200) throw new Error(`${session.label} ${path} → ${status}: ${text.slice(0, 300)}`);
  writeFileSync(join(dir, `${name}.txt`), text);
  console.info(`  ${name}  ←  ${path}`);
}

async function record(label: string): Promise<void> {
  const dir = proofDir(label);
  mkdirSync(dir, { recursive: true });
  console.info(`Recording "${label}" into ${dir} against ${PROOF_BASE}`);

  for (const subject of SUBJECTS) {
    const client = await mintSession(subject.email, subject.label);
    await recordOne(dir, `client-me-${subject.label}`, client, "/api/client/me");
    for (const days of PROGRESS_DAYS) {
      await recordOne(dir, `client-progress-${subject.label}-${days}`, client, `/api/client/progress?days=${days}`);
    }
  }
  const coach = await mintSession(COACH_EMAIL, "coach");
  await recordOne(dir, "coach-attention-feed", coach, "/api/dashboard/attention-feed");
  console.info("Done.");
}

function diff(before: string, after: string): void {
  const a = proofDir(before);
  const b = proofDir(after);
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
    const ta = readFileSync(pa, "utf8");
    const tb = readFileSync(pb, "utf8");
    if (ta === tb) {
      console.info(`= ${name}: byte-identical (${Buffer.byteLength(ta)} bytes)`);
      continue;
    }
    failures += 1;
    let at = 0;
    while (at < ta.length && ta[at] === tb[at]) at += 1;
    console.error(`✗ ${name}: differs at byte ${at}`);
    console.error(`    ${before}: …${ta.slice(Math.max(0, at - 60), at + 60)}…`);
    console.error(`    ${after}:  …${tb.slice(Math.max(0, at - 60), at + 60)}…`);
  }
  if (failures > 0) {
    console.error(`${failures} of ${names.length} response(s) differ`);
    process.exitCode = 1;
  } else {
    console.info(`Every response holds: ${names.length} byte-identical.`);
  }
}

// ---------------------------------------------------------------------------
// access
// ---------------------------------------------------------------------------

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.info(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 600));
  }
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls a count until it is non-zero, for writes the route makes after its answer. */
async function eventually(count: () => Promise<number>): Promise<number> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const n = await count();
    if (n > 0) return n;
    await settle(250);
  }
  return 0;
}

async function throwawayClient(coachId: string, email: string, name: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .insert({
      coach_id: coachId,
      name,
      email,
      active: true,
      onboarding_status: "setup_in_progress",
      timezone: "Europe/London",
      user_id: null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`client insert: ${error?.message}`);
  return data.id;
}

async function countFor(table: "audit_logs" | "client_invitations", clientId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId);
  if (error) throw new Error(`${table} count: ${error.message}`);
  return count ?? 0;
}

const ACTIVATION_COLUMNS = "onboarding_status, start_date, next_check_in_due, welcome_message, updated_at";

async function activationRow(clientId: string) {
  const { data, error } = await supabaseAdmin.from("clients").select(ACTIVATION_COLUMNS).eq("id", clientId).single();
  if (error || !data) throw new Error(`client read: ${error?.message}`);
  return data;
}

async function access(mode: "before" | "after"): Promise<void> {
  console.info(`Access proof, ${mode} the change, against ${PROOF_BASE}`);
  const { data: coach, error: coachError } = await supabaseAdmin
    .from("coaches")
    .select("id")
    .eq("email", COACH_EMAIL)
    .single();
  if (coachError || !coach) throw new Error(`Coach not found: ${coachError?.message}`);

  const stamp = Date.now();
  const made: string[] = [];
  try {
    const coachSession = await mintSession(COACH_EMAIL, "coach");

    console.info("1. The coach activates a pending client of theirs, with no login");
    const own = await throwawayClient(coach.id, `activation-proof-${stamp}@fixture.local`, "Activation proof");
    made.push(own);
    const today = await getClientTodayString(own);
    await appendMeasurements({ clientId: own, source: "intake", recordedOn: today, values: { weight: 83.6 } });
    const START = addDaysToDateString(today, -2);
    const DUE = addDaysToDateString(today, 5);
    const activated = await send(coachSession, "POST", `/api/clients/${own}/activate`, {
      startDate: START,
      firstCheckInDue: DUE,
      welcomeMessage: "Activation proof welcome",
    });
    check(
      "→ 200 { activated: true }",
      activated.status === 200 && activated.text === JSON.stringify({ success: true, data: { activated: true } }),
      { status: activated.status, text: activated.text.slice(0, 200) }
    );
    const ownRow = await activationRow(own);
    check(
      "…active from the start date sent, with the first check-in and the message",
      ownRow.onboarding_status === "active" &&
        ownRow.start_date === START &&
        ownRow.next_check_in_due === DUE &&
        ownRow.welcome_message === "Activation proof welcome",
      ownRow
    );
    const audited = await eventually(() => countFor("audit_logs", own));
    check("…audited as client.activate", audited === 1, audited);
    const invited = await eventually(() => countFor("client_invitations", own));
    check("…and invited: the read of its login, after the answer, found none", invited === 1, invited);
    // The invite's email attempt ends in a status write; let it land before cleanup.
    await settle(1500);

    console.info("2. The coach activates another coach's pending client");
    const foreign = await throwawayClient(OTHER_COACH_ID, `activation-proof-foreign-${stamp}@fixture.local`, "Activation proof foreign");
    made.push(foreign);
    await appendMeasurements({
      clientId: foreign,
      source: "intake",
      recordedOn: await getClientTodayString(foreign),
      values: { weight: 91.2 },
    });
    const foreignBefore = await activationRow(foreign);
    const refused = await send(coachSession, "POST", `/api/clients/${foreign}/activate`, {
      startDate: START,
      firstCheckInDue: DUE,
      welcomeMessage: "Activation proof foreign welcome",
    });
    check(
      "→ 403 Forbidden",
      refused.status === 403 && refused.text === JSON.stringify({ success: false, error: "Forbidden" }),
      { status: refused.status, text: refused.text.slice(0, 200) }
    );
    await settle(1500);
    const foreignAfter = await activationRow(foreign);
    check("…the row as it was", JSON.stringify(foreignAfter) === JSON.stringify(foreignBefore), {
      foreignBefore,
      foreignAfter,
    });
    const foreignAudit = await countFor("audit_logs", foreign);
    const foreignInvites = await countFor("client_invitations", foreign);
    check("…nothing audited, nobody invited", foreignAudit === 0 && foreignInvites === 0, { foreignAudit, foreignInvites });

    console.info("3. A signed-in client on the coach's attention feed");
    const client = await mintSession(SUBJECTS[1].email, "client");
    const feed = await send(client, "GET", "/api/dashboard/attention-feed");
    if (mode === "before") {
      check(
        "→ 404 Coach not found (the feed's own lookup)",
        feed.status === 404 && feed.text === JSON.stringify({ success: false, error: "Coach not found" }),
        { status: feed.status, text: feed.text.slice(0, 200) }
      );
    } else {
      check(
        "→ 401 Unauthorized (the auth seam, as every coach route)",
        feed.status === 401 && feed.text === JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: feed.status, text: feed.text.slice(0, 200) }
      );
    }
  } finally {
    console.info("Cleanup");
    for (const id of made) {
      const { error: auditError } = await supabaseAdmin.from("audit_logs").delete().eq("client_id", id);
      if (auditError) console.error(`  audit rows not deleted: ${auditError.message}`);
      const { error: clientError } = await supabaseAdmin.from("clients").delete().eq("id", id);
      if (clientError) console.error(`  client not deleted: ${clientError.message}`);
    }
    for (const id of made) {
      const { data: left } = await supabaseAdmin.from("clients").select("id").eq("id", id).maybeSingle();
      const rest = (await countFor("audit_logs", id)) + (await countFor("client_invitations", id));
      check(`cleanup: ${id} is gone, with its audit rows and invitation`, left === null && rest === 0, { left, rest });
    }
  }

  if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    process.exitCode = 1;
  } else {
    console.info("Every check holds.");
  }
}

async function main(): Promise<void> {
  const [mode, first, second] = process.argv.slice(2);
  if (mode === "record" && first) return record(first);
  if (mode === "diff" && first && second) return diff(first, second);
  if (mode === "access" && (first === "before" || first === "after")) return access(first);
  throw new Error("usage: record <label> | diff <before> <after> | access before|after");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
