/**
 * Measures the reads of scripts/perf-routes.ts against DEV (CONVENTIONS §14
 * "Request budgets"): their database calls after auth, how many of those ran
 * one after another, the request's time and its body's size.
 *
 *   npx tsx scripts/perf-count.ts                 measure every read, print the table
 *   npx tsx scripts/perf-count.ts --only <text>   only the rows whose key holds <text>
 *   npx tsx scripts/perf-count.ts --write         also record each count as its row's baseline
 *   npx tsx scripts/perf-count.ts --enforce       also exit 1 when a read is over its budget
 *
 * It starts its own next dev (scripts/proof-server.ts, never :3000), which
 * prints every database call (PERF_COUNT=1, lib/perf/db-calls.ts), signs in as
 * the perf client and as its own coach (on DEV, the owner's) with minted
 * sessions, and requests each read as its screen sends it, twice: once to compile the route and fill the
 * auth cache, then the measured request. The counted calls are the [db] lines
 * printed from the measured request until the server goes quiet. Auth is
 * everything up to the end of the request's last Better Auth read (the
 * proxy's and the route's), and the budget counts what follows.
 *
 * A save is never requested: it would change the fixture. Its count is its
 * proof's: the proof server's [db] lines while the proof drives it.
 */
import "./env-bootstrap";

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { checkInWeekday } from "@/lib/check-in-week";
import { addDaysToDateString, getTrainingWeekEnd, getTrainingWeekStart } from "@/lib/date-helpers";
import { monthOf, shiftMonth } from "@/lib/month-grid";
import { countRequestCalls, parseDbCallLine } from "@/lib/perf/db-calls";
import { getClientExerciseList } from "@/services/exercise-analytics-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getClientTodayString } from "@/services/today-service";
import { PERF_CLIENT_EMAIL, PERF_CLIENT_ID, PERF_PLAN_ID } from "./perf-fixtures";
import { BASELINES, formatSize, overBudget, PERF_ROUTES, type FixtureKey, type Measured, type ReadRoute } from "./perf-routes";
import { startProofServer, stopProofServer, type ProofServer } from "./proof-server";
import { assertOneProject, endMintedSessions, mintSession, type ProofSession } from "./proof-session";

/** The server is quiet once no [db] line has come for this long: three of its own 300 ms burst gaps, and the pipe's delay. */
const QUIET_MS = 1_000;
/** How long a request may keep the server printing before the run gives up. */
const SETTLE_TIMEOUT_MS = 60_000;
const POLL_MS = 50;
/** A rate-limited request waits this long when the answer names no Retry-After, and is retried this many times. */
const RATE_LIMIT_WAIT_MS = 10_000;
const RATE_LIMIT_RETRIES = 6;
const ROUTES_FILE = join(__dirname, "perf-routes.ts");
const BASELINE_BEGIN = "// perf-count --write: begin";
const BASELINE_END = "// perf-count --write: end";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Fixture = Record<FixtureKey, string>;

/** The request a row's screen sends, its path and query filled from the fixture's values. */
function urlFor(route: ReadRoute, values: ReadonlyMap<string, string>): string {
  const value = (name: string) => {
    const found = values.get(name);
    if (found === undefined) throw new Error(`${route.key}: "${name}" is not a fixture value (scripts/perf-routes.ts FixtureKey)`);
    return found;
  };
  const path = route.path.replace(/\[(\w+)\]/g, (_, param: string) => value(route.params[param] ?? param));
  const query = route.query.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(value(name)));
  return `${path}${query}`;
}

/** One row's id from the fixture, or a refusal saying how to make it. */
async function oneId(label: string, query: PromiseLike<{ data: { id: string } | null; error: { message: string } | null }>): Promise<string> {
  const { data, error } = await query;
  if (error) throw new Error(`The perf fixture's ${label}: ${error.message}`);
  if (!data) throw new Error(`The perf fixture has no ${label}: run npx tsx scripts/seed-scale-client.ts`);
  return data.id;
}

/** The weekday, Monday first, of a YYYY-MM-DD date: 0 for Monday … 6 for Sunday. */
const mondayIndex = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

/** The perf client's coach, whose reads perf-count makes: its id, and the address its login signs in with. */
async function readCoach(): Promise<{ id: string; email: string }> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("coach_id, coaches!clients_coach_id_fkey(email)")
    .eq("id", PERF_CLIENT_ID)
    .single();
  if (error) throw new Error(`The perf client's coach: ${error.message}`);
  if (!data.coaches?.email) throw new Error("The perf client's coach has no address to sign in with");
  return { id: data.coach_id, email: data.coaches.email };
}

/** Every value a row can name, read once from the perf fixtures and the perf client's coach. */
async function readFixture(coachId: string): Promise<Fixture> {
  const today = await getClientTodayString(PERF_CLIENT_ID);
  const [planSession, event, sessionLog, checkIn, client, exercises, plans, contentItem] = await Promise.all([
    oneId(
      "live session of its plan",
      supabaseAdmin.from("training_sessions").select("id").eq("plan_id", PERF_PLAN_ID).eq("is_active", true).eq("is_rest", false)
        .order("week_index").order("order_index").limit(1).maybeSingle()
    ),
    oneId(
      "workout on or after today",
      supabaseAdmin.from("training_events").select("id").eq("client_id", PERF_CLIENT_ID).gte("date", today)
        .order("date").order("day_order").limit(1).maybeSingle()
    ),
    oneId(
      "logged workout",
      supabaseAdmin.from("session_logs").select("id").eq("client_id", PERF_CLIENT_ID).order("completed_at", { ascending: false }).limit(1).maybeSingle()
    ),
    oneId(
      "sent check-in",
      supabaseAdmin.from("check_ins").select("id").eq("client_id", PERF_CLIENT_ID).not("sent_snapshot", "is", null)
        .order("created_at", { ascending: false }).limit(1).maybeSingle()
    ),
    supabaseAdmin.from("clients").select("next_check_in_due").eq("id", PERF_CLIENT_ID).single(),
    getClientExerciseList(PERF_CLIENT_ID),
    supabaseAdmin.from("coach_saved_plans").select("id, coach_saved_sessions(count)").eq("coach_id", coachId),
    oneId(
      "coach's content item",
      supabaseAdmin.from("content_items").select("id").eq("coach_id", coachId).order("created_at", { ascending: false }).limit(1).maybeSingle()
    ),
  ]);
  if (client.error) throw new Error(`The perf client: ${client.error.message}`);
  if (plans.error) throw new Error(`The coach's programs: ${plans.error.message}`);
  const sessionsIn = (plan: (typeof plans.data)[number]) => plan.coach_saved_sessions[0]?.count ?? 0;
  const savedPlan = [...plans.data].sort((a, b) => sessionsIn(b) - sessionsIn(a))[0]?.id;
  if (!savedPlan) throw new Error("The perf client's coach has no saved program");
  const exercise = [...exercises].sort((a, b) => b.logCount - a.logCount).find((item) => item.exerciseId)?.exerciseId;
  if (!exercise) throw new Error("The perf client has logged no catalog exercise: run npx tsx scripts/seed-scale-client.ts");

  const first = monthOf(today);
  const last = addDaysToDateString(shiftMonth(first, 1), -1);
  const checkInDay = checkInWeekday({ nextCheckInDue: client.data.next_check_in_due });
  return {
    client: PERF_CLIENT_ID,
    plan: PERF_PLAN_ID,
    planSession,
    event,
    sessionLog,
    checkIn,
    exercise,
    today,
    fortnightStart: addDaysToDateString(today, -13),
    monthStart: addDaysToDateString(first, -mondayIndex(first)),
    monthEnd: addDaysToDateString(last, 6 - mondayIndex(last)),
    weekStart: getTrainingWeekStart(today, checkInDay),
    weekEnd: getTrainingWeekEnd(today, checkInDay),
    savedPlan,
    contentItem,
  };
}

/** The server's output as whole lines, read on as it prints. */
class ServerLines {
  readonly lines: string[] = [];
  private chunksRead = 0;
  private partial = "";
  constructor(private readonly output: string[]) {}

  pull(): void {
    while (this.chunksRead < this.output.length) {
      const parts = (this.partial + this.output[this.chunksRead]).split("\n");
      this.chunksRead += 1;
      this.partial = parts.pop() ?? "";
      this.lines.push(...parts);
    }
  }

  /** Resolves once no [db] line has arrived for QUIET_MS. */
  async settle(): Promise<void> {
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    let quietSince = Date.now();
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      const before = this.lines.length;
      this.pull();
      if (this.lines.slice(before).some((line) => parseDbCallLine(line))) quietSince = Date.now();
      if (Date.now() - quietSince >= QUIET_MS) return;
    }
    throw new Error(`The server was still printing database calls after ${SETTLE_TIMEOUT_MS / 1000} s`);
  }
}

/** One request as the session, retried while it is rate limited; its status, body and time. */
async function request(base: string, session: ProofSession, url: string): Promise<{ status: number; bytes: number; ms: number; text: string }> {
  for (let attempt = 0; ; attempt += 1) {
    const started = performance.now();
    const res = await fetch(`${base}${url}`, { headers: { ...session.headers, Accept: "application/json" } });
    const body = Buffer.from(await res.arrayBuffer());
    const ms = performance.now() - started;
    if (res.status !== 429 || attempt >= RATE_LIMIT_RETRIES) return { status: res.status, bytes: body.byteLength, ms, text: body.toString("utf8") };
    const wait = Number(res.headers.get("Retry-After")) * 1000 || RATE_LIMIT_WAIT_MS;
    console.info(`  rate limited; waiting ${Math.round(wait / 1000)} s`);
    await sleep(wait);
  }
}


async function measure(route: ReadRoute, url: string, session: ProofSession, server: ProofServer, lines: ServerLines): Promise<Measured> {
  await request(server.base, session, url);
  await lines.settle();
  const from = lines.lines.length;
  const answer = await request(server.base, session, url);
  await lines.settle();
  const printed = lines.lines.slice(from).flatMap((line) => parseDbCallLine(line) ?? []);
  if (answer.status === 401) throw new Error(`${route.key} answered 401: the ${route.role}'s minted session was refused`);
  if (answer.status >= 400) console.info(`  ${route.key} answered ${answer.status}: ${answer.text.slice(0, 160)}`);
  return { ...countRequestCalls(printed), ms: Math.round(answer.ms), bytes: answer.bytes, status: answer.status };
}

/** Rewrites the BASELINES block of scripts/perf-routes.ts: the rows measured now, the others as they were. */
function writeBaselines(measured: Map<string, Measured>): void {
  const source = readFileSync(ROUTES_FILE, "utf8");
  const begin = source.indexOf(BASELINE_BEGIN);
  const end = source.indexOf(BASELINE_END);
  if (begin === -1 || end < begin || source.indexOf(BASELINE_BEGIN, begin + 1) !== -1 || source.indexOf(BASELINE_END, end + 1) !== -1) {
    throw new Error(`${ROUTES_FILE} must hold "${BASELINE_BEGIN}" and "${BASELINE_END}" once each, in that order`);
  }
  const merged = new Map(Object.entries(BASELINES));
  for (const [key, value] of measured) merged.set(key, value);
  const entries = PERF_ROUTES.flatMap((route) => {
    const m = merged.get(route.key);
    return m ? [`  ${JSON.stringify(route.key)}: { calls: ${m.calls}, serial: ${m.serial}, auth: ${m.auth}, ms: ${m.ms}, bytes: ${m.bytes}, status: ${m.status} },`] : [];
  });
  const block = `${BASELINE_BEGIN}\nexport const BASELINES: Readonly<Record<string, Measured>> = {\n${entries.join("\n")}\n};\n`;
  writeFileSync(ROUTES_FILE, source.slice(0, begin) + block + source.slice(end));
}

function printTable(rows: { route: ReadRoute; measured: Measured }[]): void {
  const keyWidth = Math.max(...rows.map(({ route }) => route.key.length));
  const head = `${"route".padEnd(keyWidth)}  status  calls  serial  auth      ms      size  verdict`;
  console.info(`\n${head}\n${"-".repeat(head.length)}`);
  for (const { route, measured: m } of rows) {
    const over = overBudget(m, route.budget);
    const verdict = over.length > 0 ? `over: ${over.join("; ")}` : "ok";
    console.info(
      `${route.key.padEnd(keyWidth)}  ${String(m.status).padStart(6)}  ${String(m.calls).padStart(5)}  ${String(m.serial).padStart(6)}  ` +
        `${String(m.auth).padStart(4)}  ${String(m.ms).padStart(6)}  ${formatSize(m.bytes).padStart(8)}  ${verdict}`
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const onlyAt = args.indexOf("--only");
  const only = onlyAt >= 0 ? args[onlyAt + 1] : undefined;
  if (onlyAt >= 0 && !only) throw new Error("--only needs the text a row's key holds");

  assertOneProject();
  const reads = PERF_ROUTES.filter((route): route is ReadRoute => route.method === "GET").filter((route) => !only || route.key.includes(only));
  const toMeasure = reads.filter((route) => !route.unmeasured);
  if (toMeasure.length === 0) throw new Error(`No read to measure${only ? ` holds "${only}"` : ""}`);

  const coach = await readCoach();
  const values = new Map<string, string>(Object.entries(await readFixture(coach.id)));
  const sessions = {
    coach: await mintSession(coach.email, "the perf client's coach"),
    client: await mintSession(PERF_CLIENT_EMAIL, "perf client"),
  };
  const results: { route: ReadRoute; measured: Measured }[] = [];
  let server: ProofServer | null = null;
  try {
    server = await startProofServer();
    const lines = new ServerLines(server.output);
    await lines.settle();
    for (const [index, route] of toMeasure.entries()) {
      console.info(`[${index + 1}/${toMeasure.length}] ${route.key}`);
      results.push({ route, measured: await measure(route, urlFor(route, values), sessions[route.role], server, lines) });
    }
  } finally {
    try {
      console.info(`Ended ${await endMintedSessions()} minted session(s).`);
    } finally {
      if (server) await stopProofServer();
    }
  }

  printTable(results);
  const notRequested = reads.filter((route) => route.unmeasured);
  for (const route of notRequested) console.info(`not requested: ${route.key} (${route.unmeasured})`);
  const saves = PERF_ROUTES.length - PERF_ROUTES.filter((route) => route.method === "GET").length;
  if (!only) console.info(`not requested: ${saves} saves (their counts are their proofs')`);

  const over = results.filter(({ route, measured }) => overBudget(measured, route.budget).length > 0);
  console.info(`\n${results.length} reads measured: ${results.length - over.length} within budget, ${over.length} over.`);
  if (args.includes("--write")) {
    writeBaselines(new Map(results.map(({ route, measured }) => [route.key, measured])));
    console.info(`Wrote ${results.length} baseline(s) to scripts/perf-routes.ts.`);
  }
  if (args.includes("--enforce") && over.length > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error("perf-count failed:", error);
  process.exit(1);
});
