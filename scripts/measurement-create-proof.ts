/**
 * Request-level proof of the Journey's Log measurement route,
 * `POST /api/clients/[id]/measurements` (docs/MEASUREMENT-LOG-PLAN.md §6
 * commit 10), against the linked DEV database through a running `next dev`.
 *
 *   npx tsx scripts/measurement-create-proof.ts
 *
 * A vitest that mocks the measurement service proves nothing about the
 * route's chain, the log's rules or the feed that reads what it wrote. This
 * drives the real route as the owner's coach with a minted session, on a
 * throwaway client created under that coach and removed at the end (its audit
 * rows are removed first; its readings and its "Mark seen" anchor go with it,
 * ON DELETE CASCADE). Every fixture number is distinct.
 *
 *   0  a first visit starts the feed: the first Overview load starts the anchor
 *      and answers it with nothing since (all caught up), the next load gives
 *      the same answer, and starting it again never moves it
 *   1  a waist and a weight: 200, one coach_entry row each, dated as sent, the
 *      coach as creator, the note kept; audited without the value
 *   2  the same value again on the same day writes nothing, audits nothing and
 *      answers the reading that stands
 *   3  the Overview's "Since your last visit" lists the two after Mark seen,
 *      each with its change from the day before
 *   4  refusals — a key that is not a body measurement, a value out of range,
 *      a day after the coach's today: 400, nothing written
 *   5  another coach's client → 404, nothing written; no session → the
 *      sign-in redirect, before the route runs; a write without the Origin the
 *      CSRF check reads → 403
 *   6  the old address is gone (404), and so is the table it once wrote
 */
import "./env-bootstrap";

import { supabaseAdmin } from "@/services/supabase-admin";
import { appendMeasurements } from "@/services/measurements-service";
import { getCoachTodayString } from "@/services/today-service";
import { startLastViewed } from "@/services/coach-client-views-service";
import { addDaysToDateString } from "@/lib/date-helpers";
import type { ActivityItem } from "@/types/coach-brief";
import { mintSession, send, PROOF_BASE } from "./proof-session";

const COACH_EMAIL = "samuel.k@taboola.com";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.info(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 600));
  }
}

type Reading = { id: string; metricKey: string; value: number; date: string; recordedAt: string };
type Reply = { success?: boolean; data?: Reading; error?: string };

/** The client's readings in the log, newest written first. */
async function readingsOf(clientId: string) {
  const { data, error } = await supabaseAdmin
    .from("client_measurements")
    .select("id, metric_key, value, recorded_on, source, created_by, note")
    .eq("client_id", clientId)
    .order("recorded_at", { ascending: false });
  if (error) throw new Error(`readings read failed: ${error.message}`);
  return data ?? [];
}

/**
 * The audit rows for one reading. The route records its audit fire-and-forget,
 * after answering, so the row may land a moment after the response: poll
 * briefly before judging.
 */
async function auditRowsFor(clientId: string, targetId: string, expected: number) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { data, error } = await supabaseAdmin
      .from("audit_logs")
      .select("action, actor_id, target_table, metadata")
      .eq("client_id", clientId)
      .eq("target_id", targetId);
    if (error) throw new Error(`audit read failed: ${error.message}`);
    if ((data ?? []).length >= expected) return data ?? [];
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return [];
}

async function main(): Promise<void> {
  const { data: coach, error: coachError } = await supabaseAdmin
    .from("coaches")
    .select("id")
    .eq("email", COACH_EMAIL)
    .single();
  if (coachError || !coach) throw new Error(`Coach not found: ${coachError?.message}`);

  const stamp = Date.now();
  const made: string[] = [];

  try {
    const { data: client, error: clientError } = await supabaseAdmin
      .from("clients")
      .insert({ coach_id: coach.id, name: "Measurement create proof", email: `measurement-create-proof-${stamp}@fixture.local` })
      .select("id")
      .single();
    if (clientError || !client) throw new Error(`client insert: ${clientError?.message}`);
    const A = client.id;
    made.push(A);

    // The route bounds the day on the coach's calendar, so the proof dates from it.
    const today = await getCoachTodayString(coach.id);
    const day = (n: number) => addDaysToDateString(today, n);
    // Three days back, the readings each new one is measured against in the feed.
    await appendMeasurements({ clientId: A, source: "intake", recordedOn: day(-3), values: { waist: 88.2, weight: 79.4 } });

    const session = await mintSession(COACH_EMAIL, "coach");
    const url = (clientId: string) => `/api/clients/${clientId}/measurements`;
    const post = async (clientId: string, body: unknown) => {
      const res = await send(session, "POST", url(clientId), body);
      return { status: res.status, body: res.json as Reply };
    };

    console.info("0. A first visit starts the feed");
    type BriefBody = { data?: { lastViewedAt?: string | null; activity?: ActivityItem[] } };
    const anchorRow = async () => {
      const { data, error } = await supabaseAdmin
        .from("coach_client_views")
        .select("last_viewed_at")
        .eq("coach_id", coach.id)
        .eq("client_id", A)
        .maybeSingle();
      if (error) throw new Error(`anchor read failed: ${error.message}`);
      return data?.last_viewed_at ?? null;
    };
    check("setup: the fresh client has no anchor", (await anchorRow()) === null);
    const firstVisit = await send(session, "GET", `/api/clients/${A}/overview-brief`);
    const firstBrief = (firstVisit.json as BriefBody)?.data;
    const started = await anchorRow();
    const sameMoment = (a: string | null | undefined, b: string | null | undefined) =>
      a != null && b != null && Date.parse(a) === Date.parse(b);
    check(
      "the first Overview load starts the anchor and answers it, with nothing since — all caught up",
      firstVisit.status === 200 && sameMoment(firstBrief?.lastViewedAt, started) && (firstBrief?.activity ?? []).length === 0,
      { answered: firstBrief?.lastViewedAt, stored: started }
    );
    const nextVisit = await send(session, "GET", `/api/clients/${A}/overview-brief`);
    const nextBrief = (nextVisit.json as BriefBody)?.data;
    check(
      "the next load gives the same answer, the anchor unmoved",
      sameMoment(nextBrief?.lastViewedAt, started) && sameMoment(await anchorRow(), started) && (nextBrief?.activity ?? []).length === 0,
      { started, next: nextBrief?.lastViewedAt }
    );
    // On the database itself: the start is ON CONFLICT DO NOTHING, so it never moves an anchor.
    const startedAgain = await startLastViewed(coach.id, A);
    check(
      "starting it again writes nothing and answers the anchor that stands",
      sameMoment(startedAgain, started) && sameMoment(await anchorRow(), started),
      { startedAgain, started }
    );

    // The feed lists what arrives after the coach's anchor; Mark seen moves it
    // to now. The anchor is stamped by the app server's clock and a reading by
    // the database's: a short pause keeps a small skew between the two from
    // reading as a feed that missed the readings.
    const seen = await send(session, "POST", `/api/clients/${A}/overview-brief/seen`);
    const anchor = (seen.json as { data?: { lastViewedAt?: string } })?.data?.lastViewedAt ?? "";
    check("setup: Mark seen → 200", seen.status === 200 && anchor !== "", seen);
    await new Promise((resolve) => setTimeout(resolve, 1500));

    console.info("1. A waist and a weight, logged as the coach");
    const waist = await post(A, { metricKey: "waist", value: 86.7, recordedOn: today, note: "proof waist" });
    check("waist → 200 with the reading", waist.status === 200 && waist.body.data?.metricKey === "waist" && waist.body.data?.value === 86.7, waist);
    const weight = await post(A, { metricKey: "weight", value: 78.6, recordedOn: day(-1) });
    check("weight → 200, dated the day sent", weight.status === 200 && weight.body.data?.date === day(-1), weight);
    check(
      "setup: both written after the anchor, by the database's clock",
      Date.parse(waist.body.data?.recordedAt ?? "") > Date.parse(anchor) && Date.parse(weight.body.data?.recordedAt ?? "") > Date.parse(anchor),
      { anchor, waist: waist.body.data?.recordedAt, weight: weight.body.data?.recordedAt }
    );

    const rows = await readingsOf(A);
    const waistRow = rows.find((r) => r.id === waist.body.data?.id);
    const weightRow = rows.find((r) => r.id === weight.body.data?.id);
    check(
      "the waist is one coach_entry row: dated today, the coach its creator, the note kept",
      waistRow?.source === "coach_entry" && waistRow.recorded_on === today && waistRow.created_by === coach.id && waistRow.note === "proof waist" && Number(waistRow.value) === 86.7,
      waistRow
    );
    check(
      "the weight is one coach_entry row with no note",
      weightRow?.source === "coach_entry" && weightRow.recorded_on === day(-1) && weightRow.note === null && Number(weightRow.value) === 78.6,
      weightRow
    );

    const audit = await auditRowsFor(A, waist.body.data?.id ?? "", 1);
    const event = audit[0];
    check(
      "audited as measurement.create on client_measurements, by the coach",
      audit.length === 1 && event?.action === "measurement.create" && event.target_table === "client_measurements" && event.actor_id === coach.id,
      audit
    );
    // jsonb keeps its own key order, so the keys are compared, not the text.
    const metadata = (event?.metadata ?? {}) as Record<string, unknown>;
    check(
      "the audit carries the metric and the day, never the value",
      Object.keys(metadata).sort().join(",") === "date,metricKey" && metadata.metricKey === "waist" && metadata.date === today,
      metadata
    );

    console.info("2. The same waist again, same day");
    const again = await post(A, { metricKey: "waist", value: 86.7, recordedOn: today });
    check("→ 200, answering the reading that stands", again.status === 200 && again.body.data?.id === waist.body.data?.id, again);
    const waistsToday = (await readingsOf(A)).filter((r) => r.metric_key === "waist" && r.source === "coach_entry" && r.recorded_on === today);
    check("nothing new written — one coach waist today", waistsToday.length === 1, waistsToday);
    // The audit is fire-and-forget: give a second row time to land before judging none did.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const auditAfterRepeat = await auditRowsFor(A, waist.body.data?.id ?? "", 1);
    check("…and audits nothing — the waist still has its one measurement.create", auditAfterRepeat.length === 1, auditAfterRepeat);

    console.info('3. The Overview\'s "Since your last visit"');
    const brief = await send(session, "GET", `/api/clients/${A}/overview-brief`);
    const activity = ((brief.json as { data?: { activity?: ActivityItem[] } })?.data?.activity ?? []);
    const measured = activity.filter(
      (item): item is Extract<ActivityItem, { type: "measurement" }> => item.type === "measurement"
    );
    const feedWaist = measured.find((item) => item.metricKey === "waist");
    const feedWeight = measured.find((item) => item.metricKey === "weight");
    check("→ 200, two readings listed (the repeat wrote nothing to list)", brief.status === 200 && measured.length === 2, measured);
    check("the waist, with the reading before it", feedWaist?.value === 86.7 && feedWaist.previousValue === 88.2, feedWaist);
    check("the weight, with the reading before it", feedWeight?.value === 78.6 && feedWeight.previousValue === 79.4, feedWeight);

    console.info("4. Refusals");
    const countBefore = (await readingsOf(A)).length;
    const mood = await post(A, { metricKey: "mood", value: 3, recordedOn: today });
    check("a key that is not a body measurement → 400", mood.status === 400, mood);
    const heavy = await post(A, { metricKey: "weight", value: 300, recordedOn: today });
    check("a weight out of range → 400", heavy.status === 400, heavy);
    const tomorrow = await post(A, { metricKey: "weight", value: 77.9, recordedOn: day(1) });
    check("the coach's tomorrow → 400, saying so", tomorrow.status === 400 && tomorrow.body.error === "Entry date cannot be in the future", tomorrow);
    check("nothing written by the three", (await readingsOf(A)).length === countBefore);

    console.info("5. Ownership, session and CSRF");
    const { data: foreignClient } = await supabaseAdmin
      .from("clients")
      .select("id")
      .neq("coach_id", coach.id)
      .limit(1)
      .single();
    if (!foreignClient) throw new Error("Setup: no client of another coach to try");
    const foreignBefore = (await readingsOf(foreignClient.id)).length;
    const foreign = await post(foreignClient.id, { metricKey: "weight", value: 81.2, recordedOn: today });
    check("another coach's client → 404", foreign.status === 404, foreign);
    check("…and nothing written to it", (await readingsOf(foreignClient.id)).length === foreignBefore);
    // Without a session the middleware answers before the route runs: the
    // sign-in redirect, which fetch would otherwise follow to the login page.
    const anonymous = await fetch(`${PROOF_BASE}${url(A)}`, {
      method: "POST",
      redirect: "manual",
      headers: { Origin: PROOF_BASE, "Content-Type": "application/json" },
      body: JSON.stringify({ metricKey: "weight", value: 80.9, recordedOn: today }),
    });
    check(
      "no session → the sign-in redirect",
      anonymous.status === 307 && (anonymous.headers.get("location") ?? "").endsWith("/login"),
      { status: anonymous.status, location: anonymous.headers.get("location") }
    );
    const noOrigin = await fetch(`${PROOF_BASE}${url(A)}`, {
      method: "POST",
      headers: { Cookie: session.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ metricKey: "weight", value: 80.3, recordedOn: today }),
    });
    check("a write without the Origin → 403", noOrigin.status === 403, noOrigin.status);
    check("nothing written by either", (await readingsOf(A)).length === countBefore);

    console.info("6. The old address and its table");
    const oldRoute = await send(session, "POST", `/api/clients/${A}/metric-entries`, { metricKey: "weight", value: 76.4, entryDate: today });
    check("the old address → 404", oldRoute.status === 404, oldRoute.status);
    const restUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!restUrl || !serviceKey) throw new Error("Missing the Supabase URL or service key in .env.local");
    const table = await fetch(`${restUrl}/rest/v1/client_metric_entries?select=id&limit=1`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    const tableBody = await table.text();
    check("the table is gone from the database", table.status === 404 && tableBody.includes("client_metric_entries"), { status: table.status, body: tableBody.slice(0, 200) });
  } finally {
    if (made.length > 0) {
      const { error: auditError } = await supabaseAdmin.from("audit_logs").delete().in("client_id", made);
      const { error: clientError } = await supabaseAdmin.from("clients").delete().in("id", made);
      if (auditError || clientError) console.error("Cleanup failed:", auditError?.message, clientError?.message);
      else console.info(`Cleanup: ${made.length} throwaway client removed with its readings, anchor and audit rows.`);
      const { count } = await supabaseAdmin
        .from("client_measurements")
        .select("id", { count: "exact", head: true })
        .in("client_id", made);
      check("the throwaway readings went with their client", count === 0, count);
    }
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
