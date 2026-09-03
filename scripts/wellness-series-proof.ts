/**
 * DEV proof of the wellness series (docs/MEASUREMENT-LOG-PLAN.md §6, commit 7).
 *
 *   npx tsx scripts/wellness-series-proof.ts
 *
 * Part 1 — for two real clients, per metric, the payload's points against an
 * independent count: the days whose `wellness_logs` row has that column
 * non-null, read as raw dates through PostgREST (no kernel, no assembly).
 * Equal by construction, ascending, unique.
 *
 * Part 2 — a throwaway client under the owner's coach row, written through
 * the app's own writer (`upsertWellnessLog`, the per-card wellness PATCH's
 * service): three days including a null column; one day re-saved — the same
 * row, the value changes, the position does not; one day backfilled after
 * later days — it sits at its date; the row count stays the number of days.
 * Then the client is deleted and the cascade proven. Every fixture number is
 * distinct.
 */
import "./env-bootstrap";

import { supabaseAdmin } from "@/services/supabase-admin";
import { getWellnessSeriesPayload } from "@/services/wellness-series-service";
import { upsertWellnessLog } from "@/services/daily-log-card-service";
import { fetchAllPages } from "@/lib/paged-fetch";
import { WELLNESS_KEYS, type WellnessKey } from "@/lib/wellness/keys";

const COACH_EMAIL = "samuel.k@taboola.com";
const PART_ONE_CLIENTS = [
  { id: "5ca1ec1e-0000-4000-8000-000000000001", label: "fixture client" },
  { id: "f87bee53-0974-46d3-b1fb-34c14af6a8b5", label: "Sam Kalepa" },
];

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.info(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

/** The days with a reading of `key`, as raw dates — independent of the kernel. */
async function loggedDates(clientId: string, key: WellnessKey): Promise<string[]> {
  const rows = await fetchAllPages<{ date: string }>(
    (from, to) =>
      supabaseAdmin
        .from("wellness_logs")
        .select("date")
        .eq("client_id", clientId)
        .not(key, "is", null)
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    { errorLabel: "wellness dates" }
  );
  return rows.map((row) => row.date);
}

async function partOne(): Promise<void> {
  for (const { id, label } of PART_ONE_CLIENTS) {
    console.info(`Part 1 — ${label}`);
    const payload = await getWellnessSeriesPayload(id);
    for (const key of WELLNESS_KEYS) {
      const expected = new Set(await loggedDates(id, key));
      const dates = payload[key].map((point) => point.date);
      check(
        `${key}: ${dates.length} points = ${expected.size} days with a reading`,
        dates.length === expected.size && dates.every((date) => expected.has(date))
      );
      check(
        `${key}: ascending and unique`,
        dates.every((date, i) => i === 0 || dates[i - 1] < date)
      );
    }
  }
}

async function createClient(name: string): Promise<string> {
  const { data: coach, error: coachError } = await supabaseAdmin
    .from("coaches")
    .select("id")
    .eq("email", COACH_EMAIL)
    .single();
  if (coachError || !coach) throw new Error(`Coach not found: ${coachError?.message}`);

  const { data, error } = await supabaseAdmin
    .from("clients")
    .insert({
      coach_id: coach.id,
      name,
      email: `wellness-proof-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@fixture.local`,
      active: true,
      start_date: "2026-05-01",
      timezone: "Europe/London",
      onboarding_status: "active",
    } as never)
    .select("id")
    .single();
  if (error || !data) throw new Error(`Client insert failed: ${error?.message}`);
  return data.id;
}

async function countRows(table: "wellness_logs" | "daily_logs", clientId: string): Promise<number | null> {
  const { count } = await supabaseAdmin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId);
  return count;
}

async function partTwo(): Promise<void> {
  console.info("Part 2 — a throwaway client, written through the app's own writer");
  const clientId = await createClient("Wellness series proof");
  try {
    // Day 1 — four readings, soreness left blank. Day 2 and day 3 — one each.
    await upsertWellnessLog(clientId, "2026-05-11", { mood: 3, energy: 7, sleep: 6, stress: 4 });
    await upsertWellnessLog(clientId, "2026-05-12", { mood: 2 });
    await upsertWellnessLog(clientId, "2026-05-13", { energy: 8 });

    let payload = await getWellnessSeriesPayload(clientId);
    check(
      "day 1: one point per non-null column (mood 3, energy 7, sleep 6, stress 4)",
      payload.mood[0]?.value === 3 &&
        payload.energy[0]?.value === 7 &&
        payload.sleep[0]?.value === 6 &&
        payload.stress[0]?.value === 4,
      payload
    );
    check("day 1: a null column is no reading", payload.soreness.length === 0, payload.soreness);
    check(
      "three days: mood on days 1 and 2, energy on days 1 and 3",
      payload.mood.map((p) => p.date).join(",") === "2026-05-11,2026-05-12" &&
        payload.energy.map((p) => p.date).join(",") === "2026-05-11,2026-05-13",
      payload
    );

    // Re-save day 1: the mood changes and a soreness is added — the same row.
    await upsertWellnessLog(clientId, "2026-05-11", { mood: 5, energy: 7, sleep: 6, stress: 4, soreness: 1 });
    payload = await getWellnessSeriesPayload(clientId);
    check(
      "re-saved day: the value changes (mood 3 → 5) on the same date",
      payload.mood[0]?.value === 5 && payload.mood[0]?.date === "2026-05-11",
      payload.mood
    );
    check(
      "re-saved day: still one point for that day, in its place",
      payload.mood.map((p) => p.date).join(",") === "2026-05-11,2026-05-12",
      payload.mood
    );
    check("re-saved day: the added soreness appears", payload.soreness[0]?.value === 1, payload.soreness);

    // Backfill an earlier day AFTER the later days were written.
    await upsertWellnessLog(clientId, "2026-05-09", { sleep: 9 });
    payload = await getWellnessSeriesPayload(clientId);
    check(
      "backfilled day sits at its date, first, though written last",
      payload.sleep.map((p) => `${p.date}:${p.value}`).join(",") === "2026-05-09:9,2026-05-11:6",
      payload.sleep
    );

    const rows = await countRows("wellness_logs", clientId);
    check(`rows = days: ${rows ?? "?"} wellness rows for 4 days`, rows === 4);
  } finally {
    const { error } = await supabaseAdmin.from("clients").delete().eq("id", clientId);
    const wellnessAfter = await countRows("wellness_logs", clientId);
    const spineAfter = await countRows("daily_logs", clientId);
    check(
      `cascade: the client's wellness rows (${wellnessAfter ?? "?"}) and spine rows (${spineAfter ?? "?"}) go with the client`,
      !error && wellnessAfter === 0 && spineAfter === 0,
      error?.message
    );
  }
}

async function main(): Promise<void> {
  await partOne();
  await partTwo();
  if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    process.exitCode = 1;
  } else {
    console.info("Every check holds.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
