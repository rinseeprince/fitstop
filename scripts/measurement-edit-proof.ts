/**
 * Request-level proof of the measurement log's three row actions — edit in
 * place, remove, restore — against the linked DEV database through a running
 * `next dev` (docs/MEASUREMENT-LOG-PLAN.md commits 4 and 8).
 *
 *   npx tsx scripts/measurement-edit-proof.ts
 *
 * The belts live in SQL (migration 160: a foreign row, a double void, a
 * restore of a live row, the client's only weight; migration 161: a foreign
 * row, a removed row, an unchanged value) and in the live view's filter and
 * the two derived views' ordering, so a vitest that mocks `supabaseAdmin`
 * proves nothing about them. This script creates two throwaway clients under
 * the owner's coach row — one with an auth user, so the client's own progress
 * read runs under its JWT and meets RLS plus the view — writes readings
 * through the app's own writer, drives the routes as the coach with a minted
 * session, calls the RPCs directly for their refusals, and reads every
 * surface back:
 *
 *   1  removing the newest weight: gone from the series, the current view,
 *      the check-in fold and GET /api/client/progress; the pair recomputed;
 *      the audit row; the coach's list shows it muted with the remover
 *   2  a double remove → 409; the RPC says already_voided
 *   3  another client's row through this client's URL → 404; the RPC says
 *      not_found
 *   4  re-logging the removed value writes a new row (rule 3 reads live rows)
 *   5  restore: back in every read; the pair recomputed; a live row refused
 *   6  editing a check-in's reading IN PLACE: the same row — id, day, source,
 *      stamp and moment kept — with the new value and a later updated_at;
 *      the check-in fold, the day's value, "now" and the client's progress
 *      read all follow it; one live row on the day; the audit row without
 *      the value; an equal edit writes nothing, moves nothing, audits nothing
 *   7  another client's row / a removed row / an out-of-bounds value refused
 *   8  D23 on the database: a reading added after the check-in wins the day;
 *      editing the check-in's row changes its value and nothing else — the
 *      later add keeps the day, the view and the kernel agree, the row keeps
 *      its place; editing the reading written last changes the day's value
 *      in place; a further add wins in turn; the pair recomputes only when
 *      the edited row is the client's current reading
 *   9  the client's only weight cannot be removed — edit it instead
 *  10  the only body fat CAN be removed, and the formula switches
 *
 * Every fixture number is distinct. The throwaway rows go with the clients
 * (ON DELETE CASCADE); the auth user and its audit rows are removed last.
 */
import "./env-bootstrap";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/services/supabase-admin";
import {
  appendMeasurements,
  getCurrentMeasurements,
  getMeasurementReadings,
  getMeasurementSeries,
  getMeasurementsForCheckIns,
} from "@/services/measurements-service";

const BASE = process.env.WIRE_PROOF_BASE ?? "http://localhost:3000";
const COACH_EMAIL = "samuel.k@taboola.com";
// A check-in stamp: source_id carries no foreign key, so a fold needs no row.
const STAMP = "00000000-0000-4000-8000-00000000c401";

const SUPABASE_URL = need("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
const ANON_KEY = need("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const SERVICE_KEY = need("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);

function need(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name} in .env.local`);
  return value;
}

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.info(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

type Session = { cookie: string };

async function mintSession(email: string): Promise<Session> {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError || !link?.properties?.email_otp) {
    throw new Error(`generateLink failed for ${email}: ${linkError?.message ?? "no otp"}`);
  }
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
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
  const ssr = createServerClient(SUPABASE_URL, ANON_KEY, {
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
  return { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") };
}

type Reply = { status: number; json: Record<string, unknown> | null };

async function send(
  session: Session,
  method: "POST" | "PATCH",
  path: string,
  body?: unknown
): Promise<Reply> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Cookie: session.cookie,
      Origin: BASE,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

const post = (session: Session, path: string, body?: unknown) => send(session, "POST", path, body);
const patch = (session: Session, path: string, body: unknown) => send(session, "PATCH", path, body);

async function get(session: Session, path: string): Promise<Reply> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Cookie: session.cookie, Origin: BASE, Accept: "application/json" },
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

const dataOf = (reply: Reply) => (reply.json?.data ?? null) as Record<string, unknown> | null;
const errorOf = (reply: Reply) => String(reply.json?.error ?? "");

async function energyPair(clientId: string): Promise<{ bmr: number | null; tdee: number | null }> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("bmr, tdee")
    .eq("id", clientId)
    .single();
  if (error || !data) throw new Error(`energy read failed: ${error?.message}`);
  return { bmr: data.bmr, tdee: data.tdee };
}

async function auditRows(clientId: string, targetId: string) {
  const { data, error } = await supabaseAdmin
    .from("audit_logs")
    .select("action, actor_id, target_id, metadata")
    .eq("client_id", clientId)
    .eq("target_id", targetId);
  if (error) throw new Error(`audit read failed: ${error.message}`);
  return data ?? [];
}

async function rpcMessage(
  fn: "void_measurement" | "restore_measurement" | "update_measurement",
  args: Record<string, string | number>
): Promise<string> {
  const { error } = await supabaseAdmin.rpc(fn, args as never);
  return error?.message ?? "";
}

/** The day's value of one metric, straight from the kernel over the live view. */
async function dayValueOf(clientId: string, metric: "weight" | "bodyFat", date: string) {
  return (await getMeasurementSeries(clientId, { metricKeys: [metric] }))
    .get(metric)
    ?.find((v) => v.date === date);
}

async function main(): Promise<void> {
  const { data: coach, error: coachError } = await supabaseAdmin
    .from("coaches")
    .select("id, name")
    .eq("email", COACH_EMAIL)
    .single();
  if (coachError || !coach) throw new Error(`Coach not found: ${coachError?.message}`);

  const stamp = Date.now();
  const clientEmail = `edit-proof-${stamp}@fixture.local`;
  const adminAuth = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: created, error: userError } = await adminAuth.auth.admin.createUser({
    email: clientEmail,
    email_confirm: true,
    password: `Proof-${stamp}-${Math.random().toString(36).slice(2)}`,
  });
  if (userError || !created.user) throw new Error(`createUser failed: ${userError?.message}`);
  const userId = created.user.id;

  const clientIds: string[] = [];
  const createClientRow = async (name: string, email: string, withUser: boolean) => {
    const { data, error } = await supabaseAdmin
      .from("clients")
      .insert({
        coach_id: coach.id,
        name,
        email,
        active: true,
        user_id: withUser ? userId : null,
        start_date: "2026-04-01",
        timezone: "Europe/London",
        onboarding_status: "active",
        height: 180,
        gender: "male",
        date_of_birth: "1990-06-15",
      } as never)
      .select("id")
      .single();
    if (error || !data) throw new Error(`Client insert failed: ${error?.message}`);
    clientIds.push(data.id);
    return data.id;
  };

  try {
    console.info("Setup: two throwaway clients, one with an auth user");
    const A = await createClientRow("Edit proof A", clientEmail, true);
    const B = await createClientRow("Edit proof B", `edit-proof-b-${stamp}@fixture.local`, false);

    const w1 = (await appendMeasurements({ clientId: A, source: "intake", recordedOn: "2026-04-01", values: { weight: 71.1 } })).rows.weight!;
    const w2 = (await appendMeasurements({ clientId: A, source: "coach_entry", recordedOn: "2026-04-10", values: { weight: 72.2 }, createdBy: coach.id })).rows.weight!;
    const stamped = await appendMeasurements({
      clientId: A,
      source: "check_in",
      sourceId: STAMP,
      recordedOn: "2026-04-20",
      measuredAt: "2026-04-20T07:15:00+01:00",
      values: { weight: 73.3, bodyFat: 20.5 },
    });
    const w3 = stamped.rows.weight!;
    const bf = stamped.rows.bodyFat!;
    await appendMeasurements({ clientId: A, source: "coach_entry", recordedOn: "2026-04-20", values: { waist: 80.4 }, createdBy: coach.id });
    const bWeight = (await appendMeasurements({ clientId: B, source: "intake", recordedOn: "2026-04-05", values: { weight: 60.6 } })).rows.weight!;
    void w1;

    check("setup: a fresh row is touched when it is written — updated_at equals recorded_at", w3.updatedAt === w3.recordedAt, { recordedAt: w3.recordedAt, updatedAt: w3.updatedAt });

    const pair0 = await energyPair(A);
    check("setup: the pair computed from the newest weight and body fat", pair0.bmr != null && pair0.tdee != null, pair0);

    const coachSession = await mintSession(COACH_EMAIL);
    const clientSession = await mintSession(clientEmail);
    const rowUrl = (client: string, row: string) => `/api/clients/${client}/measurements/${row}`;
    const url = (client: string, row: string, action: string) => `${rowUrl(client, row)}/${action}`;

    console.info("1. Remove the newest weight (a check-in's) as the coach");
    const voided = await post(coachSession, url(A, w3.id, "void"));
    check("void → 200", voided.status === 200, voided);
    check("void reports the pair recomputed", dataOf(voided)?.energy === "recomputed", dataOf(voided));
    check("void carries the check-in stamp for the invalidation", dataOf(voided)?.sourceId === STAMP, dataOf(voided));

    const seriesAfterVoid = await getMeasurementSeries(A, { metricKeys: ["weight"] });
    check("the series no longer has 20 Apr", seriesAfterVoid.get("weight")?.map((v) => v.date).join(",") === "2026-04-01,2026-04-10", seriesAfterVoid.get("weight")?.map((v) => v.date));
    const currentAfterVoid = await getCurrentMeasurements(A);
    check("the current view moved to 10 Apr (72.2)", currentAfterVoid.weight?.value === 72.2, currentAfterVoid.weight);
    const foldAfterVoid = await getMeasurementsForCheckIns([STAMP]);
    check("the check-in fold has no weight and still has body fat", foldAfterVoid.get(STAMP)?.weight === undefined && foldAfterVoid.get(STAMP)?.bodyFat === 20.5, foldAfterVoid.get(STAMP));
    const pair1 = await energyPair(A);
    check("the pair recomputed to the next reading", pair1.bmr != null && pair1.bmr !== pair0.bmr, { before: pair0, after: pair1 });

    const progress = await get(clientSession, "/api/client/progress?days=365");
    const weights = ((dataOf(progress)?.weightHistory ?? []) as Array<{ weight?: number }>).map((p) => p.weight);
    check("GET /api/client/progress under the client's JWT → 200", progress.status === 200, progress.status);
    check("…and the removed 73.3 is not in its weight history", progress.status === 200 && !weights.includes(73.3) && weights.includes(72.2), weights);

    const audits = await auditRows(A, w3.id);
    check("audited as measurement.void by the coach, metric only", audits.some((a) => a.action === "measurement.void" && a.actor_id === coach.id && JSON.stringify(a.metadata) === JSON.stringify({ metricKey: "weight" })), audits);

    const list = await getMeasurementReadings(A);
    const listed = list.find((r) => r.id === w3.id);
    check("the coach's list still holds it, muted, with the remover's name", listed?.voided?.byName === coach.name && listed.voided.at != null, listed);
    check("…while the live series does not", (await getMeasurementSeries(A)).get("weight")?.some((v) => v.id === w3.id) === false);

    console.info("2. A double remove");
    const twice = await post(coachSession, url(A, w3.id, "void"));
    check("→ 409 already removed", twice.status === 409 && /already been removed/.test(errorOf(twice)), twice);
    check("the RPC itself says already_voided", (await rpcMessage("void_measurement", { p_id: w3.id, p_client_id: A, p_actor: coach.id })).startsWith("already_voided:"));

    console.info("3. Another client's row through this client's URL");
    const foreign = await post(coachSession, url(A, bWeight.id, "void"));
    check("→ 404, not found", foreign.status === 404, foreign);
    check("the RPC itself says not_found for a row outside p_client_id", (await rpcMessage("void_measurement", { p_id: bWeight.id, p_client_id: A, p_actor: coach.id })).startsWith("not_found:"));
    check("B's row is still live", (await getCurrentMeasurements(B)).weight?.id === bWeight.id);

    console.info("4. Re-log the removed value");
    const relog = await appendMeasurements({ clientId: A, source: "check_in", sourceId: STAMP, recordedOn: "2026-04-20", values: { weight: 73.3 } });
    check("rule 3 reads live rows only: the equal value is written again", relog.inserted.includes("weight") && relog.rows.weight?.id !== w3.id, relog);
    check("…and it is the newest, so the pair recomputed", relog.energy === "recomputed", relog.energy);
    const relogged = relog.rows.weight!;
    const relogVoid = await post(coachSession, url(A, relogged.id, "void"));
    check("(cleanup) the re-logged row removed → 200", relogVoid.status === 200, relogVoid);

    console.info("5. Restore the original");
    const restored = await post(coachSession, url(A, w3.id, "restore"));
    check("restore → 200 and the pair recomputed", restored.status === 200 && dataOf(restored)?.energy === "recomputed", restored);
    check("back in the series on 20 Apr", (await getMeasurementSeries(A, { metricKeys: ["weight"] })).get("weight")?.some((v) => v.id === w3.id && v.date === "2026-04-20") === true);
    check("back in the current view", (await getCurrentMeasurements(A)).weight?.id === w3.id);
    check("back in the check-in fold", (await getMeasurementsForCheckIns([STAMP])).get(STAMP)?.weight === 73.3);
    check("the pair returned to the first computation", (await energyPair(A)).bmr === pair0.bmr, { first: pair0, now: await energyPair(A) });
    const restoreLive = await post(coachSession, url(A, w2.id, "restore"));
    check("restoring a live row → 409", restoreLive.status === 409 && /not been removed/.test(errorOf(restoreLive)), restoreLive);
    check("the RPC itself says not_voided", (await rpcMessage("restore_measurement", { p_id: w2.id, p_client_id: A })).startsWith("not_voided:"));
    check("audited as measurement.restore", (await auditRows(A, w3.id)).some((a) => a.action === "measurement.restore"));

    console.info("6. Edit the check-in's weight in place");
    const before = (await getMeasurementReadings(A)).find((r) => r.id === w3.id)!;
    const edited = await patch(coachSession, rowUrl(A, w3.id), { value: 73.9 });
    check("edit → 200, the same row, written", edited.status === 200 && dataOf(edited)?.updated === true && dataOf(edited)?.id === w3.id, edited);
    check("edit carries the check-in stamp for the invalidation, and the pair recomputed", dataOf(edited)?.sourceId === STAMP && dataOf(edited)?.energy === "recomputed", dataOf(edited));
    const after = (await getMeasurementReadings(A)).find((r) => r.id === w3.id)!;
    check("the row kept its id, day, source, stamp and moment, and changed its value", after.value === 73.9 && after.date === before.date && after.source === "check_in" && after.sourceId === STAMP && after.measuredAt === before.measuredAt, { before, after });
    check("recorded_at is untouched and updated_at moved past it", after.recordedAt === before.recordedAt && after.updatedAt > after.recordedAt && after.updatedAt > before.updatedAt, { before, after });
    const liveOnDay = (await getMeasurementReadings(A)).filter((r) => r.date === "2026-04-20" && r.metricKey === "weight" && !r.voided);
    check("ONE live weight row stands on the day — an edit adds nothing", liveOnDay.length === 1 && liveOnDay[0].id === w3.id, liveOnDay.map((r) => [r.id, r.value]));
    check("the check-in fold reads the edited value", (await getMeasurementsForCheckIns([STAMP])).get(STAMP)?.weight === 73.9);
    const dayAfterEdit = await dayValueOf(A, "weight", "2026-04-20");
    check("the day's value is the edited row", dayAfterEdit?.value === 73.9 && dayAfterEdit.id === w3.id, dayAfterEdit);
    check("'now' is the edited row", (await getCurrentMeasurements(A)).weight?.id === w3.id && (await getCurrentMeasurements(A)).weight?.value === 73.9);
    const progressAfterEdit = await get(clientSession, "/api/client/progress?days=365");
    const weightsAfterEdit = ((dataOf(progressAfterEdit)?.weightHistory ?? []) as Array<{ weight?: number }>).map((p) => p.weight);
    check("GET /api/client/progress under the client's JWT reads 73.9 and no 73.3", progressAfterEdit.status === 200 && weightsAfterEdit.includes(73.9) && !weightsAfterEdit.includes(73.3), weightsAfterEdit);
    check("the pair moved with the edit", (await energyPair(A)).bmr !== pair0.bmr, { first: pair0, now: await energyPair(A) });
    const updateAudits = (await auditRows(A, w3.id)).filter((a) => a.action === "measurement.update");
    const meta = (updateAudits[0]?.metadata ?? {}) as Record<string, unknown>;
    check("audited as measurement.update by the coach with the metric and the date, no value", updateAudits.length === 1 && updateAudits[0].actor_id === coach.id && meta.metricKey === "weight" && meta.date === "2026-04-20" && Object.keys(meta).length === 2, updateAudits);

    const countBefore = (await getMeasurementReadings(A)).length;
    const again = await patch(coachSession, rowUrl(A, w3.id), { value: 73.9 });
    const afterAgain = (await getMeasurementReadings(A)).find((r) => r.id === w3.id)!;
    check("an equal edit answers updated: false and no recompute", again.status === 200 && dataOf(again)?.updated === false && dataOf(again)?.energy === "not_newest", again);
    check("…writes nothing: no row added, updated_at unchanged, no audit row", (await getMeasurementReadings(A)).length === countBefore && afterAgain.updatedAt === after.updatedAt && (await auditRows(A, w3.id)).filter((a) => a.action === "measurement.update").length === 1, { countBefore, afterAgain });

    console.info("7. Refusals on an edit");
    check("another client's row → 404", (await patch(coachSession, rowUrl(A, bWeight.id), { value: 61 })).status === 404);
    check("the RPC itself says not_found for a row outside p_client_id", (await rpcMessage("update_measurement", { p_id: bWeight.id, p_client_id: A, p_value: 61 })).startsWith("not_found:"));
    check("B's row is unchanged", (await getCurrentMeasurements(B)).weight?.value === 60.6);
    const removedEdit = await patch(coachSession, rowUrl(A, relogged.id), { value: 70.7 });
    check("a removed row → 409, restore it first", removedEdit.status === 409 && /Restore/.test(errorOf(removedEdit)), removedEdit);
    check("the RPC itself says voided", (await rpcMessage("update_measurement", { p_id: relogged.id, p_client_id: A, p_value: 70.7 })).startsWith("voided:"));
    const bounds = await patch(coachSession, rowUrl(A, w3.id), { value: 300 });
    check("300 kg → 400", bounds.status === 400, bounds);
    check("a malformed id → 404", (await patch(coachSession, rowUrl(A, "not-a-uuid"), { value: 70 })).status === 404);

    console.info("8. D23 on the database: the reading written last is the day's value, and an edit never moves a reading");
    const added = (await appendMeasurements({ clientId: A, source: "coach_entry", recordedOn: "2026-04-20", values: { weight: 74.4 }, createdBy: coach.id })).rows.weight!;
    check("a coach reading added after the check-in wins the day (kernel)", (await dayValueOf(A, "weight", "2026-04-20"))?.id === added.id);
    check("…and 'now' (the view)", (await getCurrentMeasurements(A)).weight?.id === added.id);
    const reEdit = await patch(coachSession, rowUrl(A, w3.id), { value: 73.5 });
    check("editing the check-in's row changes its value in place, and the check-in reports it", reEdit.status === 200 && dataOf(reEdit)?.updated === true && (await getMeasurementsForCheckIns([STAMP])).get(STAMP)?.weight === 73.5, reEdit);
    check("…but the later add keeps the day — the view and the kernel agree — and the pair does not recompute", dataOf(reEdit)?.energy === "not_newest" && (await dayValueOf(A, "weight", "2026-04-20"))?.id === added.id && (await getCurrentMeasurements(A)).weight?.id === added.id && (await getCurrentMeasurements(A)).weight?.value === 74.4, { reEdit, day: await dayValueOf(A, "weight", "2026-04-20"), now: (await getCurrentMeasurements(A)).weight });
    const dayRows = (await getMeasurementReadings(A)).filter((r) => r.date === "2026-04-20" && r.metricKey === "weight" && !r.voided);
    check("two live rows stand on the day, the one written last listed first — the edit moved nothing", dayRows.length === 2 && dayRows[0].id === added.id && dayRows[1].id === w3.id && dayRows[1].value === 73.5, dayRows.map((r) => [r.id, r.value]));
    const newestEdit1 = await patch(coachSession, rowUrl(A, added.id), { value: 74.5 });
    check("editing the reading written last changes the day's value in place and recomputes the pair", newestEdit1.status === 200 && dataOf(newestEdit1)?.energy === "recomputed" && (await dayValueOf(A, "weight", "2026-04-20"))?.value === 74.5 && (await getCurrentMeasurements(A)).weight?.value === 74.5, newestEdit1);
    const addedAgain = (await appendMeasurements({ clientId: A, source: "coach_entry", recordedOn: "2026-04-20", values: { weight: 74.6 }, createdBy: coach.id })).rows.weight!;
    check("a further add wins in turn", (await dayValueOf(A, "weight", "2026-04-20"))?.id === addedAgain.id && (await getCurrentMeasurements(A)).weight?.value === 74.6);
    const pairBeforeOld = await energyPair(A);
    const oldEdit = await patch(coachSession, rowUrl(A, w2.id), { value: 72.5 });
    check("editing an older day's weight recomputes nothing", oldEdit.status === 200 && dataOf(oldEdit)?.updated === true && dataOf(oldEdit)?.energy === "not_newest" && (await energyPair(A)).bmr === pairBeforeOld.bmr, { oldEdit, before: pairBeforeOld, after: await energyPair(A) });
    check("…and 10 Apr's value is the edit", (await dayValueOf(A, "weight", "2026-04-10"))?.value === 72.5);
    const newestEdit = await patch(coachSession, rowUrl(A, addedAgain.id), { value: 74.8 });
    check("editing the newest reading recomputes the pair", newestEdit.status === 200 && dataOf(newestEdit)?.energy === "recomputed" && (await energyPair(A)).bmr !== pairBeforeOld.bmr, { newestEdit, before: pairBeforeOld, after: await energyPair(A) });

    console.info("9. The client's only weight");
    const lastWeight = await post(coachSession, url(B, bWeight.id, "void"));
    check("→ 409, edit it instead", lastWeight.status === 409 && /Edit it instead/.test(errorOf(lastWeight)), lastWeight);
    check("the RPC itself says last_weight", (await rpcMessage("void_measurement", { p_id: bWeight.id, p_client_id: B, p_actor: coach.id })).startsWith("last_weight:"));

    console.info("10. The only body fat");
    const pairBefore = await energyPair(A);
    const bfVoid = await post(coachSession, url(A, bf.id, "void"));
    check("→ 200 and the pair recomputed (Katch-McArdle → Mifflin-St Jeor)", bfVoid.status === 200 && dataOf(bfVoid)?.energy === "recomputed" && (await energyPair(A)).bmr !== pairBefore.bmr, { reply: bfVoid, before: pairBefore, after: await energyPair(A) });
    check("no body fat stands for the client now", (await getCurrentMeasurements(A)).bodyFat === undefined);
  } finally {
    console.info("Teardown");
    for (const id of clientIds) {
      const { error } = await supabaseAdmin.from("clients").delete().eq("id", id);
      if (error) console.error(`  client ${id} not deleted: ${error.message}`);
      const { error: auditError } = await supabaseAdmin.from("audit_logs").delete().eq("client_id", id);
      if (auditError) console.error(`  audit rows for ${id} not deleted: ${auditError.message}`);
    }
    const { count } = await supabaseAdmin
      .from("client_measurements")
      .select("id", { count: "exact", head: true })
      .in("client_id", clientIds);
    check("the throwaway readings went with their clients", count === 0, count);
    const { error: coachRowError } = await supabaseAdmin.from("coaches").delete().eq("user_id", userId);
    if (coachRowError) console.error(`  trigger-made coach row not deleted: ${coachRowError.message}`);
    const { error: userDeleteError } = await adminAuth.auth.admin.deleteUser(userId);
    if (userDeleteError) console.error(`  auth user not deleted: ${userDeleteError.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.info("\nAll checks passed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
