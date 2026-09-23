/**
 * Request-level proof that a nutrition plan's two training-surplus settings
 * are saved with the plan and never reprice a day before its start (migration
 * 196; owner, 2026-09-23: a past day's target never changes, and the settings
 * apply on save, never when a switch moves), against the linked DEV database
 * through a running `next dev`.
 *
 *   npx tsx scripts/surplus-settings-proof.ts
 *
 * A throwaway client under the owner's coach, deleted at the end: an intake
 * weight, the energy pair, a program with a session three days ago, one today
 * and one in two days (each a 15% surplus), and a nutrition version that began
 * twenty days ago with the surplus on — inserted as a row, since no save may
 * start in the past. Then, as the coach, over HTTP:
 *
 *   1  the switch has no endpoint of its own: PATCH on the nutrition route is
 *      refused and every day reads as before;
 *   2  a save without the two settings is refused;
 *   3  a plan saved from today with the surplus off reprices today and after,
 *      and the day three days ago keeps its surplus — the old version is
 *      capped at yesterday with its setting intact;
 *   4  a same-day re-save with the surplus on replaces today's version in
 *      place, setting included;
 *   5  a plan queued for a later day keeps its own setting while the one
 *      before it keeps its own;
 *   6  the save function refuses a call without the settings;
 *   7  the coach cannot move the past session, nor drop a library session on a
 *      past day, and neither leaves a trace.
 *
 * Every fixture number is distinct.
 */
import "./env-bootstrap";

import { supabaseAdmin } from "@/services/supabase-admin";
import { appendMeasurements } from "@/services/measurements-service";
import { getNutritionTargetsForDateRange } from "@/services/nutrition-days-service";
import { addDaysToDateString, getTodayDateStringInTimezone } from "@/lib/date-helpers";
import { mintSession, send, type ProofSession, type ProofResponse } from "./proof-session";

const COACH_EMAIL = "samuel.k@taboola.com";
const ZONE = "Europe/London";
const SURPLUS_PERCENT = 15;
const FIRST_BASELINE = 2320;

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) console.info(`  ✓ ${label}`);
  else {
    failures += 1;
    console.error(`  ✗ ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail).slice(0, 600)}`}`);
  }
}

/** The app's own rate limit answers 429 with a wait; the proof waits it out. */
async function call(
  session: ProofSession,
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown
): Promise<ProofResponse> {
  let res = await send(session, method, path, body);
  for (let attempt = 0; res.status === 429 && attempt < 8; attempt++) {
    const wait = Number((res.json as { retryAfter?: number } | null)?.retryAfter ?? 5) + 1;
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    res = await send(session, method, path, body);
  }
  return res;
}

const withSurplus = (baseline: number) => Math.round(baseline * (1 + SURPLUS_PERCENT / 100));

async function main(): Promise<void> {
  const { data: coach, error: coachError } = await supabaseAdmin
    .from("coaches")
    .select("id")
    .eq("email", COACH_EMAIL)
    .single();
  if (coachError || !coach) throw new Error(`Coach not found: ${coachError?.message}`);
  const coachSession = await mintSession(COACH_EMAIL, "coach");

  const today = getTodayDateStringInTimezone(ZONE);
  const d = (offset: number) => addDaysToDateString(today, offset);

  const { data: client, error: clientError } = await supabaseAdmin
    .from("clients")
    .insert({
      coach_id: coach.id,
      name: "Surplus settings proof",
      email: `surplus-settings-proof-${Date.now()}@fixture.local`,
      active: true,
      user_id: null,
      start_date: d(-20),
      timezone: ZONE,
      onboarding_status: "active",
      height: 181,
      gender: "male",
      date_of_birth: "1988-06-14",
      work_activity_level: "moderately_active",
      bmr: 1790,
      tdee: 2560,
      check_in_frequency: "weekly",
      next_check_in_due: d(4),
    } as never)
    .select("id")
    .single();
  if (clientError || !client) throw new Error(`Client insert failed: ${clientError?.message}`);
  const C = client.id;

  try {
    console.info("Setup");
    await appendMeasurements({ clientId: C, source: "intake", recordedOn: d(-20), values: { weight: 87.3 } });
    const { data: program, error: programError } = await supabaseAdmin
      .from("training_plans")
      .insert({
        client_id: C,
        coach_id: coach.id,
        coach_prompt: "",
        name: "Surplus proof program",
        status: "active",
        effective_from: d(-20),
        effective_until: d(30),
        frequency_per_week: 3,
        split_type: "full_body",
      } as never)
      .select("id")
      .single();
    if (programError || !program) throw new Error(`Program insert failed: ${programError?.message}`);
    const eventIds: Record<number, string> = {};
    for (const offset of [-3, 0, 2, 6]) {
      const { data: event, error: eventError } = await supabaseAdmin
        .from("training_events")
        .insert({
          client_id: C,
          training_plan_id: program.id,
          date: d(offset),
          session_name: "Full body",
          status: "scheduled",
          calorie_surplus_percentage: SURPLUS_PERCENT,
          estimated_calories: 410,
        } as never)
        .select("id")
        .single();
      if (eventError || !event) throw new Error(`Event insert failed: ${eventError?.message}`);
      eventIds[offset] = event.id;
    }
    const { data: firstVersion, error: versionError } = await supabaseAdmin
      .from("nutrition_plans")
      .insert({
        client_id: C,
        coach_id: coach.id,
        status: "active",
        effective_from: d(-20),
        effective_until: d(30),
        work_activity_level: "moderately_active",
        training_volume_hours: "3-5",
        protein_target_g_per_kg: 2.0,
        diet_type: "balanced",
        baseline_calories: FIRST_BASELINE,
        protein_target_g: 175,
        carb_target_g: 236,
        fat_target_g: 71,
        base_weight_kg: 87.3,
        bmr: 1790,
        tdee: 2560,
        include_activity_burn: true,
        surplus_as_carbs: false,
      } as never)
      .select("id")
      .single();
    if (versionError || !firstVersion) throw new Error(`Version insert failed: ${versionError?.message}`);

    const read = () => getNutritionTargetsForDateRange(C, d(-3), d(8));
    const before = await read();
    check(
      "the day three days ago is a training day priced with the surplus",
      before.get(d(-3))?.calories === withSurplus(FIRST_BASELINE) && before.get(d(-3))?.isTrainingDay === true,
      before.get(d(-3))
    );

    console.info("1. The switch has no endpoint of its own");
    const patch = await call(coachSession, "PATCH", `/api/clients/${C}/nutrition`, { includeActivityBurn: false });
    check("PATCH on the nutrition route is refused (405)", patch.status === 405, patch.status);
    const afterPatch = await read();
    check("every day reads as before", JSON.stringify([...afterPatch]) === JSON.stringify([...before]));

    console.info("2. A save must state both settings");
    const saveBody = { proteinTargetGPerKg: 2.0, dietType: "balanced", effectiveFrom: today };
    const missing = await call(coachSession, "POST", `/api/clients/${C}/nutrition`, saveBody);
    check("a save without the settings is refused (400)", missing.status === 400, missing.status);

    console.info("3. A plan saved from today with the surplus off");
    const off = await call(coachSession, "POST", `/api/clients/${C}/nutrition`, {
      ...saveBody,
      includeActivityBurn: false,
      surplusAsCarbs: false,
    });
    check("the save succeeds", off.status === 200, off.text.slice(0, 300));
    const { data: versions } = await supabaseAdmin
      .from("nutrition_plans")
      .select("id, effective_from, effective_until, include_activity_burn, surplus_as_carbs, baseline_calories")
      .eq("client_id", C)
      .eq("status", "active")
      .order("effective_from", { ascending: true });
    const first = versions?.find((row) => row.id === firstVersion.id);
    const fromToday = versions?.find((row) => row.effective_from === today);
    check(
      "the old version ends yesterday with its setting intact",
      first?.effective_until === d(-1) && first?.include_activity_burn === true,
      first
    );
    check(
      "the new version starts today with the surplus off",
      fromToday?.include_activity_burn === false && fromToday?.surplus_as_carbs === false,
      fromToday
    );
    const afterOff = await read();
    check(
      "three days ago keeps its surplus",
      JSON.stringify(afterOff.get(d(-3))) === JSON.stringify(before.get(d(-3))),
      { before: before.get(d(-3)), after: afterOff.get(d(-3)) }
    );
    const todayTarget = afterOff.get(today);
    check(
      "today is a training day at the new baseline, no surplus",
      todayTarget?.isTrainingDay === true && todayTarget?.calories === fromToday?.baseline_calories,
      { todayTarget, baseline: fromToday?.baseline_calories }
    );
    check(
      "the session in two days takes no surplus either",
      afterOff.get(d(2))?.calories === fromToday?.baseline_calories,
      afterOff.get(d(2))
    );

    console.info("4. A same-day re-save with the surplus on replaces today's version in place");
    const on = await call(coachSession, "POST", `/api/clients/${C}/nutrition`, {
      ...saveBody,
      includeActivityBurn: true,
      surplusAsCarbs: true,
    });
    check("the re-save succeeds", on.status === 200, on.text.slice(0, 300));
    const { data: replaced } = await supabaseAdmin
      .from("nutrition_plans")
      .select("id, include_activity_burn, surplus_as_carbs, baseline_calories")
      .eq("client_id", C)
      .eq("status", "active")
      .eq("effective_from", today)
      .single();
    check(
      "same version, both settings now on",
      replaced?.id === fromToday?.id && replaced?.include_activity_burn === true && replaced?.surplus_as_carbs === true,
      replaced
    );
    const afterOn = await read();
    check(
      "today takes the surplus again",
      afterOn.get(today)?.calories === withSurplus(replaced?.baseline_calories ?? 0),
      afterOn.get(today)
    );
    check(
      "three days ago is still what it was",
      JSON.stringify(afterOn.get(d(-3))) === JSON.stringify(before.get(d(-3)))
    );

    console.info("5. A plan queued for a later day keeps its own setting");
    const queued = await call(coachSession, "POST", `/api/clients/${C}/nutrition`, {
      ...saveBody,
      effectiveFrom: d(5),
      includeActivityBurn: false,
      surplusAsCarbs: false,
    });
    check("the queued save succeeds", queued.status === 200, queued.text.slice(0, 300));
    const afterQueued = await read();
    const { data: queuedVersion } = await supabaseAdmin
      .from("nutrition_plans")
      .select("baseline_calories, include_activity_burn")
      .eq("client_id", C)
      .eq("status", "active")
      .eq("effective_from", d(5))
      .single();
    check(
      "its session in six days takes no surplus",
      queuedVersion?.include_activity_burn === false &&
        afterQueued.get(d(6))?.calories === queuedVersion?.baseline_calories,
      { queuedVersion, day: afterQueued.get(d(6)) }
    );
    check(
      "today's version keeps its surplus for the session in two days",
      afterQueued.get(d(2))?.calories === withSurplus(replaced?.baseline_calories ?? 0),
      afterQueued.get(d(2))
    );
    check(
      "and three days ago is still what it was",
      JSON.stringify(afterQueued.get(d(-3))) === JSON.stringify(before.get(d(-3)))
    );

    console.info("6. The save function refuses a call without the settings");
    const { error: beltError } = await supabaseAdmin.rpc("create_nutrition_plan_atomic", {
      p_client_id: C,
      p_coach_id: coach.id,
      p_work_activity_level: "moderately_active",
      p_training_volume_hours: "3-5",
      p_protein_target_g_per_kg: 2.0,
      p_diet_type: "balanced",
      p_goal_weight_kg: null,
      p_goal_deadline: null,
      p_baseline_calories: 2280,
      p_protein_target_g: 173,
      p_carb_target_g: 229,
      p_fat_target_g: 69,
      p_base_weight_kg: 87.3,
      p_bmr: 1790,
      p_tdee: 2560,
      p_custom_macros_enabled: false,
      p_custom_calories: null,
      p_custom_protein_g: null,
      p_custom_carb_g: null,
      p_custom_fat_g: null,
      p_regeneration_reason: "regenerated",
      p_daily_targets: [],
      p_include_activity_burn: null,
      p_surplus_as_carbs: false,
      p_effective_until: d(9),
      p_effective_from: d(8),
      p_today: today,
    } as never);
    check(
      "refused with the settings sentence",
      beltError?.message.includes("needs both surplus settings") === true,
      beltError?.message
    );

    console.info("7. The coach cannot move a past session, nor place one on a past day");
    const move = await call(
      coachSession,
      "POST",
      `/api/clients/${C}/training/${program.id}/events/${eventIds[-3]}/move`,
      { fromDate: d(-3), targetDate: d(1) }
    );
    check("moving the session from three days ago is refused (400)", move.status === 400, move.text.slice(0, 300));
    const { data: stayed } = await supabaseAdmin
      .from("training_events")
      .select("date")
      .eq("id", eventIds[-3])
      .single();
    check("the session is still on its day", stayed?.date === d(-3), stayed);
    const drop = await call(coachSession, "POST", `/api/clients/${C}/training/place-from-library`, {
      type: "session",
      savedSessionId: "4f2b8c1e-7d3a-4e9b-a6c5-2d8f1b7e9a30",
      planId: program.id,
      targetDate: d(-1),
    });
    check("dropping a library session on yesterday is refused (400)", drop.status === 400, drop.text.slice(0, 300));
    const { count: yesterdaySessions } = await supabaseAdmin
      .from("training_events")
      .select("id", { count: "exact", head: true })
      .eq("client_id", C)
      .eq("date", d(-1));
    check("nothing landed on yesterday", yesterdaySessions === 0, yesterdaySessions);
    const final = await read();
    check(
      "and three days ago is still what it was",
      JSON.stringify(final.get(d(-3))) === JSON.stringify(before.get(d(-3)))
    );
  } finally {
    await supabaseAdmin.from("clients").delete().eq("id", C);
  }

  console.info(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
