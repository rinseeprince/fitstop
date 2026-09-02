/**
 * Request-level proof of the derived baseline and the log's grants, against
 * the linked DEV database (docs/MEASUREMENT-LOG-PLAN.md §5, commit 2).
 *
 *   npx tsx scripts/measurement-baseline-proof.ts
 *
 * The baseline — the reading as of the client's start date — is derived by the
 * view `client_baseline_measurements` (migration 158), so a vitest that mocks
 * `supabaseAdmin` proves nothing about it. This script creates a throwaway
 * client under the owner's coach row, writes readings through the app's own
 * `appendMeasurements`, reads the two views back, and asserts each scenario
 * against the derivation that would get it WRONG:
 *
 *   A  a reading on the start date, one before, one after  → the on-date one
 *      (falsifies "earliest ever" and "newest ever")
 *   B  only readings before the start                       → the latest before
 *      (falsifies "earliest ever")
 *   C  only readings after the start                        → the earliest after
 *      (falsifies "newest ever")
 *   D  two rows on the start date                           → the later write
 *      (rule 2 inside the baseline)
 *   E  a start date still ahead                             → derived all the same;
 *      the screens read `Starts …`, the view does not care
 *   F  rule 3: an equal value for the same day, source and stamp is not written
 *   G  the energy pair recomputes only when the appended row is the newest
 *
 * Then it deletes the client row and proves the log's rows went with it —
 * the ON DELETE CASCADE that teardown relies on, since service_role holds no
 * DELETE on the table. Every fixture number is distinct.
 */
import "./env-bootstrap";

import { supabaseAdmin } from "@/services/supabase-admin";
import {
  appendMeasurements,
  getBaseline,
  getCurrentMeasurements,
} from "@/services/measurements-service";

const COACH_EMAIL = "samuel.k@taboola.com";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.info(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

async function createClient(name: string, startDate: string | null): Promise<string> {
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
      email: `baseline-proof-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@fixture.local`,
      active: true,
      start_date: startDate,
      timezone: "Europe/London",
      onboarding_status: "active",
    } as never)
    .select("id")
    .single();
  if (error || !data) throw new Error(`Client insert failed: ${error?.message}`);
  return data.id;
}

async function main(): Promise<void> {
  console.info("Scenario client, start date 2026-04-01");
  const clientId = await createClient("Baseline proof", "2026-04-01");
  const ids: string[] = [];
  const remember = (result: Awaited<ReturnType<typeof appendMeasurements>>) => {
    for (const row of Object.values(result.rows)) if (row) ids.push(row.id);
    return result;
  };

  try {
    // A — weight: 20 Mar 71.1, 1 Apr 72.2, 10 Apr 73.3
    remember(await appendMeasurements({ clientId, source: "intake", recordedOn: "2026-03-20", values: { weight: 71.1 } }));
    remember(await appendMeasurements({ clientId, source: "coach_entry", recordedOn: "2026-04-01", values: { weight: 72.2 } }));
    remember(await appendMeasurements({ clientId, source: "coach_entry", recordedOn: "2026-04-10", values: { weight: 73.3 } }));
    // B — waist: only before the start: 10 Mar 90.1, 25 Mar 89.2
    remember(await appendMeasurements({ clientId, source: "coach_entry", recordedOn: "2026-03-10", values: { waist: 90.1 } }));
    remember(await appendMeasurements({ clientId, source: "coach_entry", recordedOn: "2026-03-25", values: { waist: 89.2 } }));
    // C — hips: only after the start: 5 Apr 100.4, 20 Apr 99.5
    remember(await appendMeasurements({ clientId, source: "coach_entry", recordedOn: "2026-04-05", values: { hips: 100.4 } }));
    remember(await appendMeasurements({ clientId, source: "coach_entry", recordedOn: "2026-04-20", values: { hips: 99.5 } }));
    // D — chest: two rows on the start date; the later write wins.
    remember(await appendMeasurements({ clientId, source: "coach_entry", recordedOn: "2026-04-01", values: { chest: 101.6 } }));
    remember(await appendMeasurements({ clientId, source: "check_in", sourceId: "00000000-0000-4000-8000-00000000d001", recordedOn: "2026-04-01", values: { chest: 102.7 } }));

    const baseline = await getBaseline(clientId);
    check("A: the reading ON the start date is the baseline (72.2)", baseline.weight?.value === 72.2, baseline.weight);
    check("A: its date is the start date", baseline.weight?.date === "2026-04-01", baseline.weight?.date);
    check("B: only-before → the LATEST before (89.2, 25 Mar)", baseline.waist?.value === 89.2 && baseline.waist.date === "2026-03-25", baseline.waist);
    check("C: only-after → the EARLIEST after (100.4, 5 Apr)", baseline.hips?.value === 100.4 && baseline.hips.date === "2026-04-05", baseline.hips);
    check("D: two rows on the start date → the later write (102.7)", baseline.chest?.value === 102.7, baseline.chest);
    check("baseline shows its source", baseline.chest?.source === "check_in", baseline.chest?.source);

    const current = await getCurrentMeasurements(clientId);
    check("current weight is the newest by day (73.3)", current.weight?.value === 73.3, current.weight);
    check("current waist is the newest of any date (89.2)", current.waist?.value === 89.2, current.waist);

    // F — rule 3: same value, same day, same source and stamp → not written.
    const repeat = await appendMeasurements({ clientId, source: "coach_entry", recordedOn: "2026-04-10", values: { weight: 73.3 } });
    check("F: an unchanged value is not written again", repeat.inserted.length === 0 && repeat.unchanged.includes("weight"), repeat);
    const changed = remember(await appendMeasurements({ clientId, source: "coach_entry", recordedOn: "2026-04-10", values: { weight: 73.4 } }));
    check("F: a changed value on the same day IS written", changed.inserted.includes("weight"), changed);
    const otherStamp = remember(await appendMeasurements({ clientId, source: "check_in", sourceId: "00000000-0000-4000-8000-00000000f001", recordedOn: "2026-04-10", values: { weight: 73.4 } }));
    check("F: the same value under a different stamp IS written", otherStamp.inserted.includes("weight"), otherStamp);

    // G — the energy trigger: a backdated row is not the newest; a newer one is.
    // (No height/gender on this client, so the recompute writes nothing — the
    // status string is the proof, not the pair.)
    const backdated = remember(await appendMeasurements({ clientId, source: "coach_entry", recordedOn: "2026-03-01", values: { weight: 70.5 } }));
    check("G: a backdated weight does not recompute energy", backdated.energy === "not_newest", backdated.energy);
    const newest = remember(await appendMeasurements({ clientId, source: "coach_entry", recordedOn: "2026-04-30", values: { weight: 74.6 } }));
    check("G: the newest weight recomputes energy", newest.energy === "recomputed", newest.energy);
    const girth = remember(await appendMeasurements({ clientId, source: "coach_entry", recordedOn: "2026-05-01", values: { arms: 33.3 } }));
    check("G: a girth never recomputes energy", girth.energy === "not_newest", girth.energy);

    // E — a start date still ahead.
    const futureId = await createClient("Baseline proof (future start)", "2099-01-01");
    try {
      await appendMeasurements({ clientId: futureId, source: "intake", recordedOn: "2026-04-02", values: { weight: 60.7 } });
      const futureBaseline = await getBaseline(futureId);
      check("E: a future start still derives (the latest before it)", futureBaseline.weight?.value === 60.7, futureBaseline.weight);
    } finally {
      await supabaseAdmin.from("clients").delete().eq("id", futureId);
    }

    // No start date: no baseline at all.
    const noStartId = await createClient("Baseline proof (no start)", null);
    try {
      await appendMeasurements({ clientId: noStartId, source: "intake", recordedOn: "2026-04-03", values: { weight: 61.8 } });
      const none = await getBaseline(noStartId);
      check("no start date → no baseline", none.weight === undefined, none);
    } finally {
      await supabaseAdmin.from("clients").delete().eq("id", noStartId);
    }
  } finally {
    // The cascade proof: the app role cannot delete a reading, and does not
    // need to — the client row takes its log with it.
    const { count: before } = await supabaseAdmin
      .from("client_measurements_live")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId);
    const { error: deleteError } = await supabaseAdmin.from("clients").delete().eq("id", clientId);
    const { count: after } = await supabaseAdmin
      .from("client_measurements_live")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId);
    check(`cascade: ${before ?? "?"} rows before the client delete, ${after ?? "?"} after`, !deleteError && (before ?? 0) > 0 && after === 0, deleteError?.message);
    const { error: directDelete } = await supabaseAdmin.from("client_measurements").delete().in("id", ids.slice(0, 1));
    check("rule 1: service_role cannot DELETE a reading", directDelete !== null, directDelete);
  }

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
