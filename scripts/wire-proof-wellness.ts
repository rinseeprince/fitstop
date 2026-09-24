/**
 * Wire proof for the client's wellness series (docs/MEASUREMENT-LOG-PLAN.md §6
 * commit 11): `GET /api/client/progress` builds its five wellness series from
 * the client's own daily logs, one value per logged day, where it plotted each
 * check-in's stored weekly average before.
 *
 *   npx tsx scripts/wire-proof-wellness.ts record before
 *   npx tsx scripts/wire-proof-wellness.ts record after
 *   npx tsx scripts/wire-proof-wellness.ts diff before after
 *
 * Needs a running `next dev` on WIRE_PROOF_BASE (default http://localhost:3000)
 * and the linked DEV project in .env.local. Recordings go to WIRE_PROOF_DIR
 * (default ./.wire-proofs) — they carry health data, so point it outside the
 * tree and never commit them.
 *
 * For the fixture client and Sam Kalepa:
 * - `GET /api/client/check-ins?limit=20` and the first three
 *   `GET /api/client/check-ins/[id]` are byte-identical: a check-in keeps
 *   reporting what it sent.
 * - `GET /api/client/progress` at 30, 90 and 365 days: everything but
 *   `data.wellnessMetrics` is identical — the physique series, the goal block,
 *   the streak, adherence and the check-in count. `wellnessMetrics` keeps its
 *   shape on both sides: the five series in order, each with the same six keys
 *   in the same order, each point `{ date, value }`, null only where the type
 *   allows it. After the switch, each series' points are exactly the client's
 *   logged days of that score in the window — read at record time straight
 *   from `wellness_logs` with the service role (raw rows, no kernel) — and the
 *   card's value is the last of them.
 *
 * Not a key-tree diff: that would read a nullable leaf turning from null into
 * a number as a lost key (Sam's 90-day `percentChange` is null over one
 * check-in and a number over twelve logged days), so the wellness half is held
 * against the contract instead.
 */
import "./env-bootstrap";

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getClientTodayString } from "@/services/today-service";
import { addDaysToDateString } from "@/lib/date-helpers";
import { fetchAllPages } from "@/lib/paged-fetch";
import { WELLNESS_KEYS, type WellnessKey } from "@/lib/wellness/keys";
import { mintSession, send, PROOF_BASE, type ProofSession } from "./proof-session";

const OUT_ROOT = process.env.WIRE_PROOF_DIR ?? join(process.cwd(), ".wire-proofs");

const SUBJECTS = [
  { label: "fixture", email: "perf-client@fixture.local", clientId: "5ca1ec1e-0000-4000-8000-000000000001" },
  { label: "sam", email: "s.kalepa91@gmail.com", clientId: "f87bee53-0974-46d3-b1fb-34c14af6a8b5" },
] as const;

const WINDOWS = [30, 90, 365] as const;
const DETAILS_PER_CLIENT = 3;

// The wire's wellness series, in its order, and the keys each one carries.
const SERIES_NAMES: Record<WellnessKey, string> = {
  mood: "Mood",
  energy: "Energy",
  sleep: "Sleep",
  stress: "Stress",
  soreness: "Soreness",
};
const SERIES_KEYS = ["id", "name", "currentValue", "percentChange", "trend", "chartData"];
const TRENDS = new Set(["up", "down", "stable"]);

type LogRow = { id: string; date: string } & Record<WellnessKey, number | null>;
type LogSnapshot = { clientToday: string; rows: LogRow[] };
type Series = {
  id: string;
  name: string;
  currentValue: number | null;
  percentChange: number | null;
  trend: string;
  chartData: Array<{ date: string; value: number }>;
};
type Progress = { success: boolean; data: Record<string, unknown> & { wellnessMetrics: Series[] } };

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.info(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 600));
  }
}

async function recordOne(dir: string, name: string, session: ProofSession, path: string): Promise<unknown> {
  const res = await send(session, "GET", path);
  if (res.status !== 200) {
    throw new Error(`${session.label} GET ${path} → ${res.status}: ${res.text.slice(0, 300)}`);
  }
  writeFileSync(join(dir, `${name}.json`), res.text);
  console.info(`  ${name}  ←  GET ${path}`);
  return res.json;
}

/** The client's whole wellness log as raw rows, and their today — no kernel. */
async function snapshotLog(clientId: string): Promise<LogSnapshot> {
  const [rows, clientToday] = await Promise.all([
    fetchAllPages<LogRow>(
      (from, to) =>
        supabaseAdmin
          .from("wellness_logs")
          .select("id, date, mood, energy, sleep, stress, soreness")
          .eq("client_id", clientId)
          .order("date", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      { errorLabel: "wellness logs" }
    ),
    getClientTodayString(clientId),
  ]);
  return { clientToday, rows };
}

async function record(label: string): Promise<void> {
  const dir = join(OUT_ROOT, label);
  mkdirSync(dir, { recursive: true });
  console.info(`Recording "${label}" into ${dir} against ${PROOF_BASE}`);

  for (const subject of SUBJECTS) {
    const session = await mintSession(subject.email, subject.label);
    const p = subject.label;

    const list = (await recordOne(dir, `client-check-ins-${p}`, session, "/api/client/check-ins?limit=20")) as {
      data: Array<{ id: string }>;
    };
    for (const { id } of list.data.slice(0, DETAILS_PER_CLIENT)) {
      await recordOne(dir, `client-check-in-${p}-${id}`, session, `/api/client/check-ins/${id}`);
    }
    for (const days of WINDOWS) {
      await recordOne(dir, `client-progress-${p}-${days}`, session, `/api/client/progress?days=${days}`);
    }
    writeFileSync(join(dir, `db-wellness-${p}.json`), JSON.stringify(await snapshotLog(subject.clientId)));
    console.info(`  db-wellness-${p}  ←  wellness_logs (service role)`);
  }
  console.info("Done.");
}

/** The payload with its wellness series held out, in its own key order. */
function everythingButWellness(progress: Progress): string {
  return JSON.stringify({ ...progress, data: { ...progress.data, wellnessMetrics: "<held out>" } });
}

function shapeProblems(series: unknown): string[] {
  if (!Array.isArray(series) || series.length !== WELLNESS_KEYS.length) return ["not five series"];
  const problems: string[] = [];
  (series as Series[]).forEach((s, i) => {
    const key = WELLNESS_KEYS[i];
    if (Object.keys(s).join() !== SERIES_KEYS.join()) problems.push(`${key}: keys ${Object.keys(s).join()}`);
    if (s.id !== key || s.name !== SERIES_NAMES[key]) problems.push(`#${i} is ${s.id} / ${s.name}`);
    if (!(s.currentValue === null || typeof s.currentValue === "number")) problems.push(`${key}: currentValue`);
    if (!(s.percentChange === null || typeof s.percentChange === "number")) problems.push(`${key}: percentChange`);
    if (!TRENDS.has(s.trend)) problems.push(`${key}: trend ${s.trend}`);
    if (!Array.isArray(s.chartData)) {
      problems.push(`${key}: chartData`);
      return;
    }
    for (const point of s.chartData) {
      if (
        Object.keys(point).join() !== "date,value" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(point.date) ||
        typeof point.value !== "number"
      ) {
        problems.push(`${key}: point ${JSON.stringify(point)}`);
        break;
      }
    }
  });
  return problems;
}

/** Each series against the client's logged days of that score in the window. */
function valueProblems(series: Series[], log: LogSnapshot, days: number): string[] {
  const fromDay = addDaysToDateString(log.clientToday, -days);
  const problems: string[] = [];
  WELLNESS_KEYS.forEach((key, i) => {
    const expected = log.rows
      .filter((row) => row.date >= fromDay && row[key] != null)
      .map((row) => ({ date: row.date, value: row[key] as number }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const actual = series[i].chartData;
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      problems.push(`${key}: ${actual.length} points on the wire, ${expected.length} logged days from ${fromDay}`);
    }
    const last = expected.length > 0 ? expected[expected.length - 1].value : null;
    if (series[i].currentValue !== last) problems.push(`${key}: currentValue ${series[i].currentValue}, last logged ${last}`);
  });
  return problems;
}

function diff(before: string, after: string): void {
  const a = join(OUT_ROOT, before);
  const b = join(OUT_ROOT, after);
  const read = (dir: string, name: string) => readFileSync(join(dir, name), "utf8");

  for (const subject of SUBJECTS) {
    const p = subject.label;
    console.info(`${p}:`);

    // A check-in reports what it sent: its list and its detail do not move.
    const checkInFiles = [...new Set([...readdirSync(a), ...readdirSync(b)])]
      .filter((name) => name.startsWith(`client-check-in-${p}-`) || name === `client-check-ins-${p}.json`)
      .sort();
    for (const name of checkInFiles) {
      const both = existsSync(join(a, name)) && existsSync(join(b, name));
      check(`${name} byte-identical`, both && read(a, name) === read(b, name));
    }

    const logBefore = JSON.parse(read(a, `db-wellness-${p}.json`)) as LogSnapshot;
    const logAfter = JSON.parse(read(b, `db-wellness-${p}.json`)) as LogSnapshot;
    check(
      `the log and the client's today are the same at both recordings (${logAfter.rows.length} days, today ${logAfter.clientToday})`,
      JSON.stringify(logBefore) === JSON.stringify(logAfter)
    );

    for (const days of WINDOWS) {
      const name = `client-progress-${p}-${days}.json`;
      const was = JSON.parse(read(a, name)) as Progress;
      const now = JSON.parse(read(b, name)) as Progress;
      check(`${days} days: everything but the wellness series is identical`, everythingButWellness(was) === everythingButWellness(now));
      const shapeBefore = shapeProblems(was.data.wellnessMetrics);
      const shapeAfter = shapeProblems(now.data.wellnessMetrics);
      check(`${days} days: the wellness series keep their shape`, shapeBefore.length === 0 && shapeAfter.length === 0, {
        before: shapeBefore,
        after: shapeAfter,
      });
      if (shapeAfter.length > 0) continue;
      const values = valueProblems(now.data.wellnessMetrics, logAfter, days);
      const density = WELLNESS_KEYS.map(
        (key, i) => `${key} ${was.data.wellnessMetrics[i]?.chartData.length ?? "?"} → ${now.data.wellnessMetrics[i].chartData.length}`
      ).join(", ");
      check(`${days} days: every point is a logged day in the window, the card the last (${density})`, values.length === 0, values);
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
  throw new Error("usage: record <label> | diff <before> <after>");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
