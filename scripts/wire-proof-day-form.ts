/**
 * Wire proof for the day-form (docs/DAY-SPINE-FLATTEN-PLAN.md §5): every
 * route that carries a day keeps its bytes across a change to how the day is
 * written or read. A day is two rows, `wellness_logs` and `nutrition_logs`,
 * each found by (client_id, date), assembled at read.
 *
 *   npx tsx scripts/wire-proof-day-form.ts record before
 *   npx tsx scripts/wire-proof-day-form.ts record after
 *   npx tsx scripts/wire-proof-day-form.ts diff before after
 *   npx tsx scripts/wire-proof-day-form.ts cleanup after
 *
 * Needs a running `next dev` on WIRE_PROOF_BASE (default http://localhost:3000)
 * and the linked DEV project in .env.local. Recordings go to WIRE_PROOF_DIR
 * (default ./.wire-proofs) — they carry health data, so point it outside the
 * tree and never commit them. Both recordings are taken on the same calendar
 * day: the check-in window and the coach's default window move at midnight.
 *
 * For the fixture client and Sam Kalepa, as the client:
 * - `GET /api/client/daily-logs/[date]/wellness`, `…/nutrition` and
 *   `GET /api/client/day-summary?date=` on a logged day, an unlogged day a
 *   version covers and a gap day.
 * - `GET /api/client/check-in-context`.
 * As the coach: `GET /api/clients/[id]/daily-logs` over the default 30 days and
 * over a 30-day window that holds data.
 * On the fixture client only, a write: `PATCH …/wellness` and `PATCH …/nutrition`
 * on a day inside its open check-in week, twice each (a first save and a
 * re-save). The day's rows are deleted before each recording so the first save
 * is one, and `cleanup` deletes them at the end; the day then reads back
 * through the three GETs. The rows are snapshotted right after each save,
 * because a response's stamps are judged against the rows as they stood when
 * it was sent.
 *
 * The rule: every response byte-identical, with one exception the proof itself
 * makes — the proof day is written afresh at each recording, so its
 * `createdAt` and `updatedAt` are new each time. On that day alone the two
 * stamps are held out of the byte comparison and checked instead against the
 * tables: `createdAt` the earliest `created_at` and `updatedAt` the latest
 * `updated_at` of the day's rows at send, and `id` still the date. Every other
 * key, every other day, and the rows outside the proof day are identical.
 */
import "./env-bootstrap";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getClientTodayString } from "@/services/today-service";
import { fetchAllPages } from "@/lib/paged-fetch";
import { mintSession, send, PROOF_BASE, type ProofSession } from "./proof-session";

const OUT_ROOT = process.env.WIRE_PROOF_DIR ?? join(process.cwd(), ".wire-proofs");
const COACH_EMAIL = "samuel.k@taboola.com";

type Subject = {
  label: string;
  email: string;
  clientId: string;
  /** Days for the point reads: logged days, an unlogged day a version covers, a gap day. */
  days: string[];
  /** A 30-day coach window that holds data. */
  dataWindow: { start: string; end: string };
  /** The one client the proof writes on. */
  writes: boolean;
};

const SUBJECTS: Subject[] = [
  {
    label: "fixture",
    email: "perf-client@fixture.local",
    clientId: "5ca1ec1e-0000-4000-8000-000000000001",
    days: ["2026-08-13", "2026-08-20", "2025-08-01"],
    dataWindow: { start: "2026-07-15", end: "2026-08-13" },
    writes: true,
  },
  {
    label: "sam",
    email: "s.kalepa91@gmail.com",
    clientId: "f87bee53-0974-46d3-b1fb-34c14af6a8b5",
    days: ["2026-09-03", "2026-09-11", "2026-09-20", "2026-09-05"],
    dataWindow: { start: "2026-08-13", end: "2026-09-11" },
    writes: false,
  },
];

// Every fixture number distinct, so a value landing in the wrong field shows.
const WELLNESS_FIRST = { mood: 2, energy: 3, sleep: 4, stress: 5, soreness: 6 };
const WELLNESS_RESAVE = { mood: 1, energy: 7, sleep: 8, stress: 9, soreness: 10 };
const NUTRITION_FIRST = { caloriesConsumed: 1810, proteinG: 122, carbsG: 173, fatG: 61 };
const NUTRITION_RESAVE = { caloriesConsumed: 2240, proteinG: 151, carbsG: 262, fatG: 74 };

type DayRow = Record<string, unknown> & { date: string };
type StampRow = { date: string; created_at: string; updated_at: string };
type Snapshot = {
  clientToday: string;
  wellness: StampRow[];
  nutrition: StampRow[];
};
type Meta = { patchDay: string };

const STAMPS = ["createdAt", "updatedAt"];
const ISO_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(\+00:00|Z)$/;

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.info(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 800));
  }
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 120));

async function recordOne(
  dir: string,
  name: string,
  session: ProofSession,
  method: "GET" | "PATCH",
  path: string,
  body?: unknown
): Promise<unknown> {
  await pause();
  const res = await send(session, method, path, body);
  if (res.status !== 200) {
    throw new Error(`${session.label} ${method} ${path} → ${res.status}: ${res.text.slice(0, 300)}`);
  }
  writeFileSync(join(dir, `${name}.json`), res.text);
  console.info(`  ${name}  ←  ${method} ${path}`);
  return res.json;
}

/** The client's rows in the two tables, as the tables hold them — no kernel. */
async function snapshot(clientId: string): Promise<Snapshot> {
  const stamps = (table: "wellness_logs" | "nutrition_logs") =>
    fetchAllPages<StampRow>(
      (from, to) =>
        supabaseAdmin
          .from(table)
          .select("date, created_at, updated_at")
          .eq("client_id", clientId)
          .order("date", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      { errorLabel: table }
    );
  const [clientToday, wellness, nutrition] = await Promise.all([
    getClientTodayString(clientId),
    stamps("wellness_logs"),
    stamps("nutrition_logs"),
  ]);
  return { clientToday, wellness, nutrition };
}

/** One day's rows in the two tables as they stand right now — a PATCH response is judged against these. */
async function snapshotDay(clientId: string, date: string): Promise<Pick<Snapshot, "wellness" | "nutrition">> {
  const stamps = async (table: "wellness_logs" | "nutrition_logs") => {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("date, created_at, updated_at")
      .eq("client_id", clientId)
      .eq("date", date);
    if (error) throw new Error(`${table} snapshot failed: ${error.message}`);
    return (data ?? []) as StampRow[];
  };
  const [wellness, nutrition] = await Promise.all([stamps("wellness_logs"), stamps("nutrition_logs")]);
  return { wellness, nutrition };
}

/** The fixture's proof day: the rows the proof itself made, one per table. */
async function deleteFixtureDay(clientId: string, date: string): Promise<void> {
  if (date < "2026-09-01") throw new Error(`refusing to delete a day before the proof's window: ${date}`);
  for (const table of ["nutrition_logs", "wellness_logs"] as const) {
    const { error, count } = await supabaseAdmin
      .from(table)
      .delete({ count: "exact" })
      .eq("client_id", clientId)
      .eq("date", date);
    if (error) throw new Error(`delete ${table} on ${date} failed: ${error.message}`);
    console.info(`  ${table}: ${count ?? 0} row(s) removed on ${date}`);
  }
}

/** A day inside the fixture's current check-in week that the day rule lets it write. */
async function resolvePatchDay(session: ProofSession, subject: Subject): Promise<string> {
  const ctx = await send(session, "GET", "/api/client/check-in-context");
  if (ctx.status !== 200) throw new Error(`check-in-context probe → ${ctx.status}: ${ctx.text.slice(0, 200)}`);
  const { periodStart, periodEnd } = (ctx.json as { data: { periodStart: string; periodEnd: string } }).data;
  const today = await getClientTodayString(subject.clientId);
  const patchDay = periodEnd <= today ? periodEnd : today;
  if (patchDay < periodStart) throw new Error(`no writable day in the period ${periodStart}..${periodEnd}`);
  return patchDay;
}

async function recordSubject(dir: string, coach: ProofSession, subject: Subject): Promise<void> {
  const session = await mintSession(subject.email, subject.label);
  const p = subject.label;
  const days = [...subject.days];

  let patchDay: string | null = null;
  if (subject.writes) {
    patchDay = await resolvePatchDay(session, subject);
    await deleteFixtureDay(subject.clientId, patchDay);
    const state = await send(session, "GET", `/api/client/daily-logs/${patchDay}/wellness`);
    const editable = (state.json as { data?: { editable?: boolean } })?.data?.editable;
    if (state.status !== 200 || editable !== true) {
      throw new Error(`${patchDay} is not writable for the fixture (${state.status}, editable ${String(editable)})`);
    }
    writeFileSync(join(dir, `meta-${p}.json`), JSON.stringify({ patchDay } satisfies Meta));
    console.info(`  the fixture's proof day is ${patchDay}`);
  }

  for (const day of days) {
    await recordOne(dir, `wellness-${p}-${day}`, session, "GET", `/api/client/daily-logs/${day}/wellness`);
    await recordOne(dir, `nutrition-${p}-${day}`, session, "GET", `/api/client/daily-logs/${day}/nutrition`);
    await recordOne(dir, `day-summary-${p}-${day}`, session, "GET", `/api/client/day-summary?date=${day}`);
  }

  if (patchDay) {
    // Each PATCH response carries the day's stamps as they stood when it was
    // sent, so the rows are snapshotted right after each save, not once at the
    // end: a later save moves the day's latest stamp.
    const writes: Array<[string, "wellness" | "nutrition", Record<string, number>]> = [
      ["patch-wellness-first", "wellness", WELLNESS_FIRST],
      ["patch-wellness-resave", "wellness", WELLNESS_RESAVE],
      ["patch-nutrition-first", "nutrition", NUTRITION_FIRST],
      ["patch-nutrition-resave", "nutrition", NUTRITION_RESAVE],
    ];
    for (const [name, card, body] of writes) {
      await recordOne(dir, `${name}-${p}`, session, "PATCH", `/api/client/daily-logs/${patchDay}/${card}`, body);
      writeFileSync(join(dir, `stamps-${name}-${p}.json`), JSON.stringify(await snapshotDay(subject.clientId, patchDay)));
    }
    await recordOne(dir, `wellness-${p}-written`, session, "GET", `/api/client/daily-logs/${patchDay}/wellness`);
    await recordOne(dir, `nutrition-${p}-written`, session, "GET", `/api/client/daily-logs/${patchDay}/nutrition`);
    await recordOne(dir, `day-summary-${p}-written`, session, "GET", `/api/client/day-summary?date=${patchDay}`);
  }

  await recordOne(dir, `check-in-context-${p}`, session, "GET", "/api/client/check-in-context");

  await recordOne(dir, `coach-daily-logs-${p}-default`, coach, "GET", `/api/clients/${subject.clientId}/daily-logs`);
  await recordOne(
    dir,
    `coach-daily-logs-${p}-window`,
    coach,
    "GET",
    `/api/clients/${subject.clientId}/daily-logs?startDate=${subject.dataWindow.start}&endDate=${subject.dataWindow.end}`
  );

  writeFileSync(join(dir, `db-${p}.json`), JSON.stringify(await snapshot(subject.clientId)));
  console.info(`  db-${p}  ←  wellness_logs, nutrition_logs (service role)`);
}

async function record(label: string): Promise<void> {
  const dir = join(OUT_ROOT, label);
  mkdirSync(dir, { recursive: true });
  console.info(`Recording "${label}" into ${dir} against ${PROOF_BASE}`);
  const coach = await mintSession(COACH_EMAIL, "coach");
  for (const subject of SUBJECTS) {
    console.info(`${subject.label}:`);
    await recordSubject(dir, coach, subject);
  }
  console.info("Done.");
}

async function cleanup(label: string): Promise<void> {
  const fixture = SUBJECTS.find((subject) => subject.writes);
  if (!fixture) return;
  const metaPath = join(OUT_ROOT, label, `meta-${fixture.label}.json`);
  if (!existsSync(metaPath)) throw new Error(`no ${metaPath}: nothing to clean up`);
  const { patchDay } = JSON.parse(readFileSync(metaPath, "utf8")) as Meta;
  console.info(`Removing the fixture's proof day ${patchDay}:`);
  await deleteFixtureDay(fixture.clientId, patchDay);
  console.info("Done.");
}

// ---------------------------------------------------------------------------
// The diff
// ---------------------------------------------------------------------------

/** The day with its two stamps held out — only ever applied to the proof day. */
const withoutStamps = (day: DayRow): Record<string, unknown> =>
  Object.fromEntries(Object.entries(day).filter(([key]) => !STAMPS.includes(key)));

const stampsFor = (rows: StampRow[], date: string) => rows.filter((row) => row.date === date);
const earliest = (rows: StampRow[]) =>
  rows.map((row) => row.created_at).reduce((min, stamp) => (Date.parse(stamp) < Date.parse(min) ? stamp : min));
const latest = (rows: StampRow[]) =>
  rows.map((row) => row.updated_at).reduce((max, stamp) => (Date.parse(stamp) > Date.parse(max) ? stamp : max));

/**
 * The proof day against the rule: every key but the two stamps byte-identical,
 * `id` the date, and the stamps the earliest and latest of the day's rows as
 * they stood when the response was sent. Returns the problems, none when it holds.
 */
function proofDayProblems(before: DayRow, after: DayRow, rows: Pick<Snapshot, "wellness" | "nutrition">): string[] {
  const problems: string[] = [];
  const date = after.date;
  if (before.date !== date) problems.push(`dates differ: ${before.date} vs ${date}`);
  if (JSON.stringify(withoutStamps(before)) !== JSON.stringify(withoutStamps(after))) {
    problems.push(
      `${date}: the kept keys differ — before ${JSON.stringify(withoutStamps(before))}, after ${JSON.stringify(withoutStamps(after))}`
    );
  }
  if (after.id !== date) problems.push(`${date}: id is ${String(after.id)}, not the date`);
  const dayRows = [...stampsFor(rows.wellness, date), ...stampsFor(rows.nutrition, date)];
  if (dayRows.length === 0) {
    problems.push(`${date}: listed, but neither table holds a row`);
    return problems;
  }
  if (typeof after.createdAt !== "string" || !ISO_STAMP.test(after.createdAt)) problems.push(`${date}: createdAt ${String(after.createdAt)}`);
  if (typeof after.updatedAt !== "string" || !ISO_STAMP.test(after.updatedAt)) problems.push(`${date}: updatedAt ${String(after.updatedAt)}`);
  if (after.createdAt !== earliest(dayRows)) problems.push(`${date}: createdAt ${String(after.createdAt)}, the earliest row is ${earliest(dayRows)}`);
  if (after.updatedAt !== latest(dayRows)) problems.push(`${date}: updatedAt ${String(after.updatedAt)}, the latest row is ${latest(dayRows)}`);
  return problems;
}

/**
 * A list of days: the same dates in the same order, every day byte-identical
 * except the proof day, which follows the rule above against the rows as they
 * stood at the end of the recording (nothing is written after the lists).
 */
function listProblems(before: DayRow[], after: DayRow[], patchDay: string | null, snap: Snapshot): string[] {
  if (!Array.isArray(before) || !Array.isArray(after)) return ["not a list on both sides"];
  const beforeDates = before.map((day) => day.date).join();
  const afterDates = after.map((day) => day.date).join();
  if (beforeDates !== afterDates) return [`the days listed differ: [${beforeDates}] vs [${afterDates}]`];
  return before.flatMap((day, i) => {
    if (day.date === patchDay) return proofDayProblems(day, after[i], snap);
    return JSON.stringify(day) === JSON.stringify(after[i]) ? [] : [`${day.date}: differs — before ${JSON.stringify(day)}, after ${JSON.stringify(after[i])}`];
  });
}

function diff(beforeLabel: string, afterLabel: string): void {
  const a = join(OUT_ROOT, beforeLabel);
  const b = join(OUT_ROOT, afterLabel);
  const read = (dir: string, name: string) => readFileSync(join(dir, `${name}.json`), "utf8");
  const both = (name: string) => existsSync(join(a, `${name}.json`)) && existsSync(join(b, `${name}.json`));
  const identical = (name: string) => {
    check(`${name} byte-identical`, both(name) && read(a, name) === read(b, name));
  };

  for (const subject of SUBJECTS) {
    const p = subject.label;
    console.info(`${p}:`);
    const snapBefore = JSON.parse(read(a, `db-${p}`)) as Snapshot;
    const snapAfter = JSON.parse(read(b, `db-${p}`)) as Snapshot;
    check(
      `the client's today is the same at both recordings (${snapAfter.clientToday})`,
      snapBefore.clientToday === snapAfter.clientToday
    );

    let patchDay: string | null = null;
    if (subject.writes) {
      const metaBefore = JSON.parse(read(a, `meta-${p}`)) as Meta;
      const metaAfter = JSON.parse(read(b, `meta-${p}`)) as Meta;
      check(`the proof day is the same at both recordings (${metaAfter.patchDay})`, metaBefore.patchDay === metaAfter.patchDay);
      patchDay = metaAfter.patchDay;
    }

    // The tables outside the proof day are untouched by the proof, so their
    // rows — dates and stamps — must be the same at both recordings.
    const outside = (snap: Snapshot) =>
      JSON.stringify({
        wellness: snap.wellness.filter((row) => row.date !== patchDay),
        nutrition: snap.nutrition.filter((row) => row.date !== patchDay),
      });
    check(
      `the rows outside the proof day are the same at both recordings (${snapAfter.wellness.length} wellness, ${snapAfter.nutrition.length} food)`,
      outside(snapBefore) === outside(snapAfter)
    );

    const days = subject.writes ? [...subject.days, "written"] : subject.days;
    for (const day of days) {
      identical(`wellness-${p}-${day}`);
      identical(`nutrition-${p}-${day}`);
      identical(`day-summary-${p}-${day}`);
    }

    if (subject.writes) {
      for (const name of ["patch-wellness-first", "patch-wellness-resave", "patch-nutrition-first", "patch-nutrition-resave"]) {
        const was = JSON.parse(read(a, `${name}-${p}`)) as { success: boolean; data: DayRow };
        const now = JSON.parse(read(b, `${name}-${p}`)) as { success: boolean; data: DayRow };
        // The rows as they stood when this response was sent.
        const atSend = JSON.parse(read(b, `stamps-${name}-${p}`)) as Pick<Snapshot, "wellness" | "nutrition">;
        const problems = [
          ...(was.success === true && now.success === true ? [] : ["success is not true on both sides"]),
          ...proofDayProblems(was.data, now.data, atSend),
        ];
        check(`${name}-${p}: identical outside the two stamps, which match the rows at send`, problems.length === 0, problems);
      }
    }

    const ctxBefore = JSON.parse(read(a, `check-in-context-${p}`)) as { data: Record<string, unknown> & { dailyLogs: DayRow[] } };
    const ctxAfter = JSON.parse(read(b, `check-in-context-${p}`)) as { data: Record<string, unknown> & { dailyLogs: DayRow[] } };
    const heldOut = (ctx: typeof ctxBefore) => JSON.stringify({ ...ctx, data: { ...ctx.data, dailyLogs: "<held out>" } });
    check(`check-in-context-${p}: everything but dailyLogs is byte-identical`, heldOut(ctxBefore) === heldOut(ctxAfter));
    const ctx = listProblems(ctxBefore.data.dailyLogs, ctxAfter.data.dailyLogs, patchDay, snapAfter);
    check(
      `check-in-context-${p}: dailyLogs identical (${ctxAfter.data.dailyLogs.length} day(s); the proof day's stamps match the rows)`,
      ctx.length === 0,
      ctx
    );

    for (const window of ["default", "window"]) {
      const name = `coach-daily-logs-${p}-${window}`;
      const was = JSON.parse(read(a, name)) as { success: boolean; data: DayRow[] };
      const now = JSON.parse(read(b, name)) as { success: boolean; data: DayRow[] };
      const problems = [
        ...(was.success === true && now.success === true ? [] : ["success is not true on both sides"]),
        ...listProblems(was.data, now.data, patchDay, snapAfter),
      ];
      check(`${name}: the same ${now.data.length} day(s), identical (the proof day's stamps match the rows)`, problems.length === 0, problems);
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
  if (mode === "cleanup" && first) return cleanup(first);
  throw new Error("usage: record <label> | diff <before> <after> | cleanup <label>");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
