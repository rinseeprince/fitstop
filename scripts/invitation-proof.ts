/**
 * Proof of docs/BETTER-AUTH-PLAN.md section 6 commit 10 (section 5, proof 10):
 * the Invite box always lets a coach send while the client has no account,
 * says what is true, and a failed email changes nothing; activation sends an
 * invitation only when one is needed. Against the linked DEV database and a
 * next dev this script starts on a free port (never :3000), its email landing
 * in this script's own mailbox (scripts/proof-mailbox.ts), which refuses the
 * addresses the proof chooses as Resend's sandbox refuses one.
 *
 *   npx tsx --tsconfig ./tsconfig.json scripts/invitation-proof.ts
 *
 * The throwaways: a coach (on a timezone far from UTC, so the box's dates are
 * the coach's calendar days), pending clients of theirs, and another coach
 * with a pending client.
 *   1  the box's read of a client never invited: { hasAccount: false,
 *      invitation: null }
 *   2  a send the mailbox refuses: the plain sentence, never Resend's words,
 *      and no row
 *   3  a send it takes: the row, its dates on the coach's calendar, and the
 *      email's link opens the invite page
 *   4  a resend refused: the earlier link still opens, the row unchanged
 *   5  a resend taken: the earlier link refused, the new one opens
 *   6  a row expired through the pool: linkWorks false, and a send works
 *   7  another coach's client: 404 from both routes, nothing sent
 *   8  activation of a client whose link works: no invitation email, the
 *      link unchanged; with none: one email; with the mailbox refusing: the
 *      client active and invitation "failed"; of a client whose address the
 *      coach corrected after inviting them: one email, to the corrected
 *      address, and the earlier link no longer opens
 *   9  the questionnaire add refused: inviteSent false, no row
 *  10  an acceptance: accepted_at set, the read hasAccount true, the link
 *      refused as used
 *  11  ten reads of the box in a row: none refused
 * And no answer of the box or of activation carries a link's token. The
 * invite link's own routes are on the auth tier, five a quarter hour per
 * caller, so the proof opens a link over HTTP once and accepts one; every
 * other look at a link is getInvitationByToken in this process, the lookup
 * that route answers with. Cleanup removes every throwaway login, coach row,
 * client row, invitation and audit row. No token, link, cookie or password
 * is printed.
 */
import "./env-bootstrap";

import { createHmac } from "node:crypto";
import { authPool } from "@/lib/auth";
import { getTodayDateStringInTimezone } from "@/lib/date-helpers";
import { PRODUCT_NAME } from "@/lib/constants";
import { supabaseAdmin } from "@/services/supabase-admin";
import { createThrowawayLogin, deleteThrowawayLogin } from "./auth-fixtures";
import { appendMeasurements } from "@/services/measurements-service";
import { getInvitationByToken } from "@/services/invitation-service";
import { DEV_REF, projectEnv, refuseUnlessProject } from "./project-ref";
import { REFUSAL_MESSAGE, startProofMailbox, type ProofMailbox } from "./proof-mailbox";
import { startProofServer, stopProofServer, type ProofServer } from "./proof-server";
import { signInOverHttp, type ProofSession } from "./proof-session";

const STAMP = Date.now();
const at = (label: string) => `invitation-proof-${STAMP}-${label}@fixture.local`;
/** Every throwaway address any run of this proof makes. */
const ADDRESS_PATTERN = "invitation-proof-%@fixture.local";
const COACH = at("coach");
const OTHER_COACH = at("other-coach");
const COACH_NAME = "Invitation proof coach";
/** Fourteen hours ahead of UTC: the coach's calendar day is UTC's next for most of the day. */
const COACH_TIMEZONE = "Pacific/Kiritimati";
const REQUEST_TIMEOUT_MS = 60_000;
/** A link's token is 64 hex characters. */
const TOKEN_SHAPE = /[a-f0-9]{64}/i;
const INVITE_SUBJECT = `You're invited to join ${PRODUCT_NAME} by ${COACH_NAME}`;
const EMAIL_FAILED = "The email couldn't be sent. Try again.";
/** The coach tier's window: the ten reads start a fresh one. */
const COACH_TIER_WINDOW_MS = 10_000;

let failures = 0;
/** One check. Its detail is the evidence printed on failure: never a token, a link, a cookie or a password. */
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.info(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 600));
  }
}

/** A throwaway's password, derived so that nothing writes it down. */
function passwordFor(label: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("Missing BETTER_AUTH_SECRET in .env.local");
  return createHmac("sha256", secret).update(`${COACH}:${label}`).digest("base64url").slice(0, 32);
}

let devServer: ProofServer | null = null;
let mailbox: ProofMailbox | null = null;
/** Every login this run made, by address, and every client row: the cleanup's list. */
const madeLogins: string[] = [];
const madeClients: string[] = [];
const madeCoaches: string[] = [];
/** Every answer of the box, activation and the add, for the no-token check; and every token a row held. */
const answers: string[] = [];
const tokensSeen = new Set<string>();

// ---------------------------------------------------------------------------
// Requests and rows
// ---------------------------------------------------------------------------

type Answer = { status: number; json: unknown; text: string };

/** One request as a browser on the app's origin sends it, redirects not followed. */
async function request(
  base: string,
  method: "GET" | "POST" | "PATCH",
  path: string,
  options: { session?: ProofSession; body?: unknown } = {}
): Promise<Answer> {
  const res = await fetch(`${base}${path}`, {
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Accept: "application/json",
      Origin: base,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...options.session?.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

/** The box's read or send, its answer kept for the no-token check. */
async function invitationRoute(base: string, coach: ProofSession, method: "GET" | "POST", clientId: string): Promise<Answer> {
  const answer = await request(base, method, `/api/clients/${clientId}/invitation`, { session: coach });
  answers.push(answer.text);
  return answer;
}

/** An answer's evidence: its status and its text, any token hidden. */
const evidence = (answer: Answer) => ({ status: answer.status, text: answer.text.replace(/[a-f0-9]{64}/gi, "<token>").slice(0, 200) });

type Row = { token: string | null; email: string; invited_at: string | null; expires_at: string | null; accepted_at: string | null };

/** A client's invitation row, or null; its token remembered for the no-token check. */
async function invitationOf(clientId: string): Promise<Row | null> {
  const { data, error } = await supabaseAdmin
    .from("client_invitations")
    .select("token, email, invited_at, expires_at, accepted_at")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new Error(`invitation read: ${error.message}`);
  if (data?.token) tokensSeen.add(data.token);
  return data;
}

/** A pending client of a coach, as the add-client form's manual path makes one, with a weight so it can be activated. */
async function pendingClient(coachId: string, label: string): Promise<{ id: string; email: string }> {
  const email = at(label);
  const { data, error } = await supabaseAdmin
    .from("clients")
    .insert({ coach_id: coachId, name: `Invitation proof · ${label}`, email, active: true, onboarding_status: "setup_in_progress", timezone: "Europe/London", user_id: null })
    .select("id")
    .single();
  if (error || !data) throw new Error(`client insert (${label}): ${error?.message}`);
  madeClients.push(data.id);
  await appendMeasurements({ clientId: data.id, source: "intake", recordedOn: getTodayDateStringInTimezone("Europe/London"), values: { weight: 80 } });
  return { id: data.id, email };
}

/** How many invitation emails reached an address. */
const invitationEmailsTo = (box: ProofMailbox, address: string) =>
  box.emails.filter((email) => email.subject === INVITE_SUBJECT && email.to.includes(address.toLowerCase())).length;

/** The newest invitation email's link to an address, when it opens this run's app; else "". */
function linkTo(base: string, box: ProofMailbox, address: string): string {
  const email = [...box.emails].reverse().find((sent) => sent.subject === INVITE_SUBJECT && sent.to.includes(address.toLowerCase()));
  const link = email?.text.match(/https?:\/\/\S+\/invite\/[a-f0-9]{64}/i)?.[0] ?? "";
  return link.startsWith(`${base}/invite/`) ? link : "";
}

/** Whether a token's link opens the invite page (what its lookup answers): the coach's name, or the refusal. */
async function linkOpens(token: string): Promise<{ opens: boolean; error?: string }> {
  const found = await getInvitationByToken(token);
  return found.success ? { opens: found.invitation?.coachName === COACH_NAME } : { opens: false, error: found.error };
}

const read = (answer: Answer) => (answer.json as { data?: unknown } | null)?.data;
const coachDay = (stamp: string | null) => (stamp ? getTodayDateStringInTimezone(COACH_TIMEZONE, new Date(stamp)) : null);

// ---------------------------------------------------------------------------
// The proof
// ---------------------------------------------------------------------------

async function prove(base: string, box: ProofMailbox): Promise<void> {
  console.info("Setup: two throwaway coaches and pending clients");
  const coachLogin = await createThrowawayLogin({ role: "coach", email: COACH, password: passwordFor("coach"), name: COACH_NAME });
  madeLogins.push(COACH);
  const otherLogin = await createThrowawayLogin({ role: "coach", email: OTHER_COACH, password: passwordFor("other"), name: "Invitation proof other coach" });
  madeLogins.push(OTHER_COACH);
  if (!coachLogin.coachId || !otherLogin.coachId) throw new Error("No coach row for a throwaway coach");
  madeCoaches.push(coachLogin.coachId, otherLogin.coachId);
  const { error: zoneError } = await supabaseAdmin.from("coaches").update({ timezone: COACH_TIMEZONE }).eq("id", coachLogin.coachId);
  if (zoneError) throw new Error(`coach timezone: ${zoneError.message}`);
  const coach = await signInOverHttp(base, COACH, passwordFor("coach"), "coach");

  const fresh = await pendingClient(coachLogin.coachId, "fresh");
  const foreign = await pendingClient(otherLogin.coachId, "foreign");

  console.info("1. The box's read of a client never invited");
  const first = await invitationRoute(base, coach, "GET", fresh.id);
  check("→ 200 { hasAccount: false, invitation: null }", first.status === 200 && JSON.stringify(read(first)) === JSON.stringify({ hasAccount: false, invitation: null }), evidence(first));

  console.info("2. A send the mailbox refuses");
  box.refuse(fresh.email);
  const refused = await invitationRoute(base, coach, "POST", fresh.id);
  check(
    `→ 502 "${EMAIL_FAILED}", never Resend's words`,
    refused.status === 502 && JSON.stringify(refused.json) === JSON.stringify({ success: false, error: EMAIL_FAILED }) && !refused.text.includes(REFUSAL_MESSAGE.slice(0, 30)),
    evidence(refused)
  );
  check("…the email was tried and refused", box.refused.some((email) => email.to.includes(fresh.email.toLowerCase())), { refused: box.refused.length });
  check("…and nothing was written", (await invitationOf(fresh.id)) === null);

  console.info("3. A send the mailbox takes");
  box.accept(fresh.email);
  const sent = await invitationRoute(base, coach, "POST", fresh.id);
  const sentRow = await invitationOf(fresh.id);
  check("→ 200", sent.status === 200 && (sent.json as { success?: boolean } | null)?.success === true, evidence(sent));
  check(
    "…the row: a token, the address, sent now, a link for seven days, unused",
    !!sentRow?.token && sentRow.email === fresh.email && !!sentRow.invited_at && !!sentRow.expires_at && sentRow.accepted_at === null &&
      Math.abs(new Date(sentRow.expires_at).getTime() - new Date(sentRow.invited_at).getTime() - 7 * 86_400_000) < 1000,
    sentRow ? { ...sentRow, token: sentRow.token ? "<token>" : null } : null
  );
  check(
    "…its answer is the box's read: the dates on the coach's calendar, the link working",
    JSON.stringify(read(sent)) === JSON.stringify({ hasAccount: false, invitation: { sentOn: coachDay(sentRow?.invited_at ?? null), expiresOn: coachDay(sentRow?.expires_at ?? null), linkWorks: true } }),
    { answer: read(sent), utcDay: sentRow?.invited_at?.slice(0, 10) }
  );
  const link = linkTo(base, box, fresh.email);
  check("…the email reached the client, its link the invite page with the row's token", link !== "" && sentRow?.token !== null && link.endsWith(`/invite/${sentRow?.token}`), { emails: invitationEmailsTo(box, fresh.email) });
  const lookup = await request(base, "GET", `/api/invitations/${sentRow?.token}`);
  check(
    "…and opening it, the invite page's lookup answers the coach's name and the address masked",
    lookup.status === 200 && (lookup.json as { invitation?: { coachName?: string; emailMasked?: string } } | null)?.invitation?.coachName === COACH_NAME &&
      !lookup.text.includes(fresh.email),
    { status: lookup.status }
  );

  console.info("4. A resend the mailbox refuses");
  box.refuse(fresh.email);
  const resendRefused = await invitationRoute(base, coach, "POST", fresh.id);
  const afterRefusal = await invitationOf(fresh.id);
  check(`→ 502 "${EMAIL_FAILED}"`, resendRefused.status === 502 && (resendRefused.json as { error?: string } | null)?.error === EMAIL_FAILED, evidence(resendRefused));
  check("…the row unchanged", JSON.stringify(afterRefusal) === JSON.stringify(sentRow));
  check("…and the earlier link still opens", (await linkOpens(sentRow?.token ?? "")).opens);

  console.info("5. A resend the mailbox takes");
  box.accept(fresh.email);
  const resent = await invitationRoute(base, coach, "POST", fresh.id);
  const resentRow = await invitationOf(fresh.id);
  check("→ 200, a new token on the row", resent.status === 200 && !!resentRow?.token && resentRow.token !== sentRow?.token, evidence(resent));
  const earlier = await linkOpens(sentRow?.token ?? "");
  check("…the earlier link no longer opens", !earlier.opens && earlier.error === "Invalid invitation link", earlier);
  check("…the new one opens", (await linkOpens(resentRow?.token ?? "")).opens);
  check("…and the newest email carries the new one", linkTo(base, box, fresh.email).endsWith(`/invite/${resentRow?.token}`));

  console.info("6. A link that expired (its expiry put in the past through the pool)");
  await authPool.query(`UPDATE public.client_invitations SET expires_at = now() - interval '1 day' WHERE client_id = $1`, [fresh.id]);
  const expiredRead = await invitationRoute(base, coach, "GET", fresh.id);
  const expiredData = read(expiredRead) as { hasAccount?: boolean; invitation?: { linkWorks?: boolean } | null } | undefined;
  check("→ the read says the link doesn't work", expiredRead.status === 200 && expiredData?.hasAccount === false && expiredData.invitation?.linkWorks === false, evidence(expiredRead));
  const afterExpiry = await invitationRoute(base, coach, "POST", fresh.id);
  const afterExpiryRow = await invitationOf(fresh.id);
  check(
    "…and a send works: a new link that works",
    afterExpiry.status === 200 && (read(afterExpiry) as { invitation?: { linkWorks?: boolean } } | undefined)?.invitation?.linkWorks === true &&
      (await linkOpens(afterExpiryRow?.token ?? "")).opens,
    evidence(afterExpiry)
  );

  console.info("7. Another coach's client");
  const foreignRead = await invitationRoute(base, coach, "GET", foreign.id);
  const foreignSend = await invitationRoute(base, coach, "POST", foreign.id);
  check("→ 404 from the read", foreignRead.status === 404 && JSON.stringify(foreignRead.json) === JSON.stringify({ success: false, error: "Client not found" }), evidence(foreignRead));
  check("→ 404 from the send, and nothing sent or written", foreignSend.status === 404 && invitationEmailsTo(box, foreign.email) === 0 && (await invitationOf(foreign.id)) === null, evidence(foreignSend));

  console.info("8. Activation");
  const linked = await pendingClient(coachLogin.coachId, "activate-linked");
  const sentLinked = await invitationRoute(base, coach, "POST", linked.id);
  const linkedRow = await invitationOf(linked.id);
  check("(a client invited before activation)", sentLinked.status === 200 && invitationEmailsTo(box, linked.email) === 1, evidence(sentLinked));
  const activateBody = { startDate: getTodayDateStringInTimezone("Europe/London"), welcomeMessage: "Invitation proof welcome" };
  const activatedLinked = await request(base, "POST", `/api/clients/${linked.id}/activate`, { session: coach, body: activateBody });
  answers.push(activatedLinked.text);
  check(
    "…a client whose link works: invitation not_needed",
    activatedLinked.status === 200 && JSON.stringify(activatedLinked.json) === JSON.stringify({ success: true, data: { activated: true, invitation: "not_needed" } }),
    evidence(activatedLinked)
  );
  check("…no second invitation email, and the link unchanged", invitationEmailsTo(box, linked.email) === 1 && JSON.stringify(await invitationOf(linked.id)) === JSON.stringify(linkedRow));

  const none = await pendingClient(coachLogin.coachId, "activate-none");
  const activatedNone = await request(base, "POST", `/api/clients/${none.id}/activate`, { session: coach, body: activateBody });
  answers.push(activatedNone.text);
  const noneRow = await invitationOf(none.id);
  check(
    "…a client with no invitation: invitation sent, one email, its row there",
    activatedNone.status === 200 && JSON.stringify(activatedNone.json) === JSON.stringify({ success: true, data: { activated: true, invitation: "sent" } }) &&
      invitationEmailsTo(box, none.email) === 1 && !!noneRow?.token && linkTo(base, box, none.email).endsWith(`/invite/${noneRow.token}`),
    evidence(activatedNone)
  );

  const refusing = await pendingClient(coachLogin.coachId, "activate-refused");
  box.refuse(refusing.email);
  const activatedRefused = await request(base, "POST", `/api/clients/${refusing.id}/activate`, { session: coach, body: activateBody });
  answers.push(activatedRefused.text);
  const { data: refusedClient } = await supabaseAdmin.from("clients").select("onboarding_status").eq("id", refusing.id).single();
  check(
    "…the mailbox refusing: the client active, invitation failed, no row",
    activatedRefused.status === 200 && JSON.stringify(activatedRefused.json) === JSON.stringify({ success: true, data: { activated: true, invitation: "failed" } }) &&
      refusedClient?.onboarding_status === "active" && (await invitationOf(refusing.id)) === null,
    evidence(activatedRefused)
  );

  box.accept(refusing.email);
  const moved = await pendingClient(coachLogin.coachId, "activate-moved");
  const sentMoved = await invitationRoute(base, coach, "POST", moved.id);
  const movedRow = await invitationOf(moved.id);
  const correctedEmail = at("activate-moved-corrected");
  const corrected = await request(base, "PATCH", `/api/clients/${moved.id}`, { session: coach, body: { email: correctedEmail } });
  answers.push(corrected.text);
  check("(a client invited, then the address corrected by the coach)", sentMoved.status === 200 && corrected.status === 200, { sent: evidence(sentMoved), corrected: evidence(corrected) });
  const activatedMoved = await request(base, "POST", `/api/clients/${moved.id}/activate`, { session: coach, body: activateBody });
  answers.push(activatedMoved.text);
  const movedAfter = await invitationOf(moved.id);
  const movedEarlier = await linkOpens(movedRow?.token ?? "");
  check(
    "…activated: invitation sent, one email at the corrected address, the row on it with a new link, the earlier link no longer opening",
    JSON.stringify(activatedMoved.json) === JSON.stringify({ success: true, data: { activated: true, invitation: "sent" } }) &&
      invitationEmailsTo(box, correctedEmail) === 1 && invitationEmailsTo(box, moved.email) === 1 &&
      movedAfter?.email === correctedEmail && !!movedAfter.token && movedAfter.token !== movedRow?.token &&
      !movedEarlier.opens && movedEarlier.error === "Invalid invitation link",
    { activated: evidence(activatedMoved), earlier: movedEarlier, rowEmail: movedAfter?.email }
  );

  console.info("9. The questionnaire add, its invitation refused");
  const addedEmail = at("added");
  box.refuse(addedEmail);
  const added = await request(base, "POST", "/api/clients", { session: coach, body: { name: "Invitation proof · added", email: addedEmail, setupMode: "intake" } });
  answers.push(added.text);
  const addedId = (added.json as { client?: { id?: string } } | null)?.client?.id;
  if (addedId) madeClients.push(addedId);
  check(
    "→ 201, the client added, inviteSent false, and no row",
    added.status === 201 && !!addedId && (added.json as { inviteSent?: boolean }).inviteSent === false && (await invitationOf(addedId ?? "")) === null,
    evidence(added)
  );

  console.info("10. An acceptance");
  const token = afterExpiryRow?.token ?? "";
  const accepted = await request(base, "POST", "/api/invitations/accept", { body: { token, password: passwordFor("fresh") } });
  madeLogins.push(fresh.email);
  const acceptedRow = await invitationOf(fresh.id);
  check("→ 200", accepted.status === 200, evidence(accepted));
  check("…accepted_at set", !!acceptedRow?.accepted_at, acceptedRow ? { accepted_at: acceptedRow.accepted_at } : null);
  const afterAccept = await invitationRoute(base, coach, "GET", fresh.id);
  check("…the box's read: hasAccount true", afterAccept.status === 200 && (read(afterAccept) as { hasAccount?: boolean } | undefined)?.hasAccount === true, evidence(afterAccept));
  const used = await linkOpens(token);
  check("…and the link refused as used", !used.opens && used.error === "This invitation has already been used", used);

  console.info("11. Ten reads of the box in a row");
  await new Promise((resolve) => setTimeout(resolve, COACH_TIER_WINDOW_MS + 500));
  const statuses: number[] = [];
  for (let i = 0; i < 10; i += 1) statuses.push((await invitationRoute(base, coach, "GET", fresh.id)).status);
  check("→ none refused", statuses.every((status) => status === 200), statuses);

  console.info("No answer carries a link's token");
  const leaked = answers.filter((text) => TOKEN_SHAPE.test(text) || [...tokensSeen].some((seen) => text.includes(seen)));
  check(`none of ${answers.length} answers of the box, activation or the add carries one (${tokensSeen.size} tokens written)`, leaked.length === 0 && tokensSeen.size >= 5, { leaked: leaked.length });
}

async function cleanup(): Promise<void> {
  console.info("Cleanup");
  try {
    // The clients' and coaches' audit rows: no key cascades them.
    if (madeClients.length > 0 || madeCoaches.length > 0) {
      const ids = [...madeClients, ...madeCoaches];
      const { error } = await supabaseAdmin.from("audit_logs").delete().or(`client_id.in.(${ids.join(",")}),actor_id.in.(${ids.join(",")})`);
      if (error) throw new Error(`audit rows: ${error.message}`);
    }
    // The client's login first, then the coaches', which take their coach rows
    // and every client row (and its invitation) with them.
    for (const address of [...madeLogins].reverse()) await deleteThrowawayLogin(address);
    if (madeClients.length > 0) {
      const { error } = await supabaseAdmin.from("clients").delete().in("id", madeClients);
      if (error) throw new Error(`client rows: ${error.message}`);
    }
    const ids = [...madeClients, ...madeCoaches];
    const { rows: left } = await authPool.query<{ n: number }>(
      `SELECT ((SELECT count(*) FROM better_auth."user" WHERE email LIKE $1)
             + (SELECT count(*) FROM public.coaches WHERE email LIKE $1)
             + (SELECT count(*) FROM public.clients WHERE email LIKE $1)
             + (SELECT count(*) FROM public.client_invitations WHERE email LIKE $1)
             + (SELECT count(*) FROM public.audit_logs WHERE client_id = ANY($2::uuid[]) OR actor_id = ANY($2::uuid[])))::int AS n`,
      [ADDRESS_PATTERN, ids]
    );
    check("cleanup: no throwaway login, coach row, client row, invitation or audit row is left", left[0]?.n === 0, left[0]);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  refuseUnlessProject(DEV_REF, projectEnv());
  try {
    mailbox = await startProofMailbox();
    devServer = await startProofServer({ emailTo: mailbox.url });
    await prove(devServer.base, mailbox);
  } finally {
    try {
      await cleanup();
    } finally {
      await stopProofServer();
      await mailbox?.stop();
      await authPool.end();
    }
  }
  if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    // The server logs the paths it answered, links' tokens among them.
    if (devServer) console.error(devServer.output.join("").replace(/[a-f0-9]{64}/gi, "<token>").slice(-2000));
    process.exitCode = 1;
  } else {
    console.info("Every check of the Invite box and of activation's invitation holds.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
