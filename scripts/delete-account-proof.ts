/**
 * Proof of docs/BETTER-AUTH-PLAN.md section 6 commit 6 (section 5, proof 6):
 * delete account, the client's and the coach's, over HTTP as the Delete
 * account dialog and the emailed link send them, against the linked DEV
 * database and a next dev this script starts on a free port (never :3000),
 * its email landing in this script's own mailbox (scripts/proof-mailbox.ts).
 *
 *   npx tsx --tsconfig ./tsconfig.json scripts/delete-account-proof.ts
 *
 * The throwaways: a coach with two clients, each with a login. Client A holds
 * a check-in carrying a photo object of their own and the key of client B's
 * photo (a value only the client could have written), with an answer to the
 * coach's question, and a photo in their folder that no check-in names. Client
 * B holds a check-in with a photo of their own and an answer to the coach's
 * question, and a content file the coach assigned them
 * (content_assignments.assigned_by is the coach's NO ACTION key). The coach's
 * folder also holds a file no content item names.
 *   1  asking: no password, and a wrong one, are refused with no email and no
 *      link; the password sends "Confirm deleting your account" in the
 *      client's words, its link stored for a day, and deletes nothing
 *   2  a forced object-removal failure: the link is refused with the
 *      sentence, every row, object and login intact, and the link spent
 *   3  client A's link: their client row and every row pointing at it gone,
 *      their photo gone, B's photo kept, their login gone, the deleted notice;
 *      B and the coach intact
 *   4  the coach's link, in the coach's words: every row pointing at the coach
 *      or at B in every table gone, both buckets hold none of the keys, B's
 *      login and the coach's gone
 * Cleanup removes whatever a failed check left. No token, link, cookie or
 * password is printed.
 */
import "./env-bootstrap";

import { createHmac } from "node:crypto";
import { isAPIError } from "better-auth/api";
import { ACCOUNT_NOT_DELETED, auth, authPool } from "@/lib/auth";
import { ACCOUNT_DELETED_PAGE, ACCOUNT_DELETION_TAKES, type DeletedAccount } from "@/lib/constants";
import { assignContentToClient } from "@/services/content-assignment-service";
import { createContentItem } from "@/services/content-item-service";
import { CONTENT_BUCKET, uploadContentFile } from "@/services/content-storage-service";
import { PROGRESS_PHOTOS_BUCKET, removeObjects, uploadProgressPhotoFromBase64, type StorageBucket } from "@/services/storage-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { createThrowawayLogin, deleteThrowawayLogin, loginIdFor } from "./auth-fixtures";
import { DEV_REF, projectEnv, refuseUnlessProject } from "./project-ref";
import { startProofMailbox, type MailboxEmail, type ProofMailbox } from "./proof-mailbox";
import { startProofServer, stopProofServer, type ProofServer } from "./proof-server";
import { endMintedSessions, signInOverHttp, type ProofSession } from "./proof-session";

const STAMP = Date.now();
const COACH_ADDRESS = `delete-proof-${STAMP}@fixture.local`;
const CLIENT_A_ADDRESS = `delete-proof-${STAMP}-a@fixture.local`;
const CLIENT_B_ADDRESS = `delete-proof-${STAMP}-b@fixture.local`;
const ADDRESSES = [CLIENT_A_ADDRESS, CLIENT_B_ADDRESS, COACH_ADDRESS];
const ADDRESS_PATTERN = "delete-proof-%@fixture.local";
const REQUEST_TIMEOUT_MS = 60_000;
const SUBJECT = "Confirm deleting your account";
const DAY_MS = 24 * 60 * 60 * 1000;
/** The smallest JPEG header: storage keeps the bytes, and nothing here reads them as an image. */
const PHOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z";

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
  return createHmac("sha256", secret).update(`${COACH_ADDRESS}:${label}`).digest("base64url").slice(0, 32);
}

/** What this run made, for the checks and for the cleanup. */
const made = {
  coachId: null as string | null,
  clientA: null as string | null,
  clientB: null as string | null,
  objects: [] as { bucket: StorageBucket; key: string }[],
  checkIns: [] as string[],
  answers: [] as string[],
  questionId: null as string | null,
  contentId: null as string | null,
};

let devServer: ProofServer | null = null;
let mailbox: ProofMailbox | null = null;

// ---------------------------------------------------------------------------
// Requests, rows and objects
// ---------------------------------------------------------------------------

type Answer = { status: number; json: unknown; text: string; headers: Headers };

/** One request as a browser on the app's origin sends it, redirects not followed. */
async function request(base: string, method: "GET" | "POST", path: string, options: { session?: ProofSession; body?: unknown } = {}): Promise<Answer> {
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
  return { status: res.status, json, text, headers: res.headers };
}

const evidence = (answer: Answer) => ({ status: answer.status, text: answer.text.slice(0, 160) });

/** A sign-in's status, as the login page posts one. */
async function signIn(base: string, email: string, password: string): Promise<number> {
  return (await request(base, "POST", "/api/auth/sign-in/email", { body: { email, password } })).status;
}

/** What the dialog sends: the password, and the deleted notice as the link's landing. */
const askToDelete = (base: string, session: ProofSession, body: Record<string, unknown> = {}) =>
  request(base, "POST", "/api/auth/delete-user", { session, body: { callbackURL: ACCOUNT_DELETED_PAGE, ...body } });

/** The first email to `to` with the subject after the first `seen` emails, waiting for it to arrive. */
async function nextEmail(box: ProofMailbox, to: string, seen: number): Promise<MailboxEmail | null> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const email = box.emails.slice(seen).find((sent) => sent.to.includes(to) && sent.subject === SUBJECT);
    if (email) return email;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

/** The delete link in an email's text, and its token: Better Auth's callback, landing on the deleted notice. */
function deleteLink(base: string, email: MailboxEmail | null): { path: string; token: string } {
  const link = email?.text.match(/https?:\/\/\S+\/api\/auth\/delete-user\/callback\?\S+/)?.[0] ?? "";
  if (!link.startsWith(`${base}/api/auth/delete-user/callback?token=`)) return { path: "", token: "" };
  const url = new URL(link);
  if (url.searchParams.get("callbackURL") !== ACCOUNT_DELETED_PAGE) return { path: "", token: "" };
  return { path: `${url.pathname}${url.search}`, token: url.searchParams.get("token") ?? "" };
}

/** Whether Better Auth holds the link's token for the login. */
async function linkStored(token: string, userId: string): Promise<{ stored: boolean; expiresInMs: number }> {
  const { rows } = await authPool.query<{ expiresAt: Date }>(
    `SELECT "expiresAt" FROM better_auth.verification WHERE identifier = $1 AND value = $2`,
    [`delete-account-${token}`, userId]
  );
  return { stored: rows.length === 1, expiresInMs: rows[0] ? rows[0].expiresAt.getTime() - Date.now() : 0 };
}

/** The delete-account links Better Auth holds for a login. */
async function linksHeld(userId: string): Promise<number> {
  const { rows } = await authPool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM better_auth.verification WHERE identifier LIKE 'delete-account-%' AND value = $1`,
    [userId]
  );
  return rows[0].n;
}

/** Every one-column key to clients and to coaches, read from the catalog, so a table added later is swept too. */
let keyColumns: { tbl: string; col: string; parent: "clients" | "coaches" }[] = [];

async function readKeyColumns(): Promise<void> {
  const { rows } = await authPool.query<{ tbl: string; col: string; parent: "clients" | "coaches" }>(
    `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, c.confrelid::regclass::text AS parent
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND cardinality(c.conkey) = 1
        AND c.confrelid IN ('public.clients'::regclass, 'public.coaches'::regclass)
      ORDER BY 1, 2`
  );
  keyColumns = rows;
}

/** The rows pointing at a client or a coach, table by table, through every key to it; the total too. */
async function pointingAt(parent: "clients" | "coaches", id: string): Promise<{ total: number; byTable: Record<string, number> }> {
  const byTable: Record<string, number> = {};
  for (const { tbl, col } of keyColumns.filter((key) => key.parent === parent)) {
    const { rows } = await authPool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${tbl} WHERE "${col.replace(/"/g, '""')}" = $1`, [id]);
    if (rows[0].n > 0) byTable[`${tbl}.${col}`] = rows[0].n;
  }
  return { total: Object.values(byTable).reduce((sum, n) => sum + n, 0), byTable };
}

/** A login and what hangs off it: the login, its sessions, its password and Google rows, its profile. */
async function loginRows(userId: string): Promise<number> {
  const { rows } = await authPool.query<{ n: number }>(
    `SELECT ((SELECT count(*) FROM better_auth."user" WHERE id = $1)
           + (SELECT count(*) FROM better_auth.session WHERE "userId" = $1)
           + (SELECT count(*) FROM better_auth.account WHERE "userId" = $1)
           + (SELECT count(*) FROM public.profiles WHERE user_id = $1))::int AS n`,
    [userId]
  );
  return rows[0].n;
}

/** Rows of a table by id. */
async function rowsById(table: "clients" | "coaches" | "check_ins" | "check_in_answers" | "check_in_questions" | "content_items", ids: string[]): Promise<number> {
  const { count, error } = await supabaseAdmin.from(table).select("id", { count: "exact", head: true }).in("id", ids);
  if (error) throw new Error(`${table} read: ${error.message}`);
  return count ?? 0;
}

/**
 * Whether a bucket still holds an object: its row in storage.objects, which
 * the Storage API's removal deletes before it answers. A download is no
 * answer: the storage CDN may serve a removed object for a while from its
 * cache (each upload asks it to keep the object an hour).
 */
async function holds(bucket: StorageBucket, key: string): Promise<boolean> {
  const { rows } = await authPool.query<{ n: number }>(`SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id = $1 AND name = $2`, [bucket, key]);
  return rows[0].n === 1;
}

/**
 * Runs `run` with every Storage API removal refused, in this process: the
 * object-removal failure Better Auth's beforeDelete must turn into a refusal.
 * The prototype every bucket's client shares is patched and put back.
 */
async function withRemovalsRefused<T>(run: () => Promise<T>): Promise<T> {
  const proto = Object.getPrototypeOf(supabaseAdmin.storage.from(PROGRESS_PHOTOS_BUCKET)) as { remove: unknown };
  const original = proto.remove;
  proto.remove = () => Promise.resolve({ data: null, error: { name: "StorageApiError", message: "refused by the proof" } });
  try {
    return await run();
  } finally {
    proto.remove = original;
  }
}

// ---------------------------------------------------------------------------
// The throwaways
// ---------------------------------------------------------------------------

async function insertClient(coachId: string, name: string, email: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .insert({ coach_id: coachId, name, email, active: true, onboarding_status: "pending_intake", timezone: "Europe/London", user_id: null })
    .select("id")
    .single();
  if (error || !data) throw new Error(`client insert: ${error?.message}`);
  return data.id;
}

async function insertCheckIn(clientId: string, photos: { photo_front?: string; photo_side?: string }, questionId: string): Promise<void> {
  const { data, error } = await supabaseAdmin.from("check_ins").insert({ client_id: clientId, ...photos }).select("id").single();
  if (error || !data) throw new Error(`check-in insert: ${error?.message}`);
  made.checkIns.push(data.id);
  const { data: answer, error: answerError } = await supabaseAdmin
    .from("check_in_answers")
    .insert({ check_in_id: data.id, question_id: questionId, answer: "Yes" })
    .select("id")
    .single();
  if (answerError || !answer) throw new Error(`answer insert: ${answerError?.message}`);
  made.answers.push(answer.id);
}

async function makeThrowaways(passwords: Record<"coach" | "client", string>): Promise<{ coachUser: string; aUser: string; bUser: string }> {
  const coach = await createThrowawayLogin({ role: "coach", email: COACH_ADDRESS, password: passwords.coach, name: "Delete proof coach" });
  if (!coach.coachId) throw new Error(`No coach row for ${COACH_ADDRESS}`);
  made.coachId = coach.coachId;
  made.clientA = await insertClient(coach.coachId, "Delete proof client A", CLIENT_A_ADDRESS);
  made.clientB = await insertClient(coach.coachId, "Delete proof client B", CLIENT_B_ADDRESS);
  const a = await createThrowawayLogin({ role: "client", email: CLIENT_A_ADDRESS, password: passwords.client, clientId: made.clientA });
  const b = await createThrowawayLogin({ role: "client", email: CLIENT_B_ADDRESS, password: passwords.client, clientId: made.clientB });

  const aPhoto = await uploadProgressPhotoFromBase64(PHOTO, made.clientA, "front");
  const bPhoto = await uploadProgressPhotoFromBase64(PHOTO, made.clientB, "front");
  // An upload no check-in names, as a check-in refused after its photos went leaves one.
  const aOrphan = await uploadProgressPhotoFromBase64(PHOTO, made.clientA, "back");
  made.objects.push(
    { bucket: PROGRESS_PHOTOS_BUCKET, key: aPhoto },
    { bucket: PROGRESS_PHOTOS_BUCKET, key: bPhoto },
    { bucket: PROGRESS_PHOTOS_BUCKET, key: aOrphan }
  );

  const { data: question, error: questionError } = await supabaseAdmin
    .from("check_in_questions")
    .insert({ coach_id: coach.coachId, prompt: "Did you sleep well?" })
    .select("id")
    .single();
  if (questionError || !question) throw new Error(`question insert: ${questionError?.message}`);
  made.questionId = question.id;
  await insertCheckIn(made.clientA, { photo_front: aPhoto, photo_side: bPhoto }, question.id);
  await insertCheckIn(made.clientB, { photo_front: bPhoto }, question.id);

  const contentId = crypto.randomUUID();
  const file = new File([new Uint8Array([37, 80, 68, 70])], "plan.pdf", { type: "application/pdf" });
  const storagePath = await uploadContentFile(file, coach.coachId, contentId);
  made.objects.push({ bucket: CONTENT_BUCKET, key: storagePath });
  const item = await createContentItem({
    coachId: coach.coachId,
    title: "Delete proof plan",
    type: "pdf",
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
    storagePath,
  });
  made.contentId = item.id;
  await assignContentToClient({ contentId: item.id, clientId: made.clientB, assignedBy: coach.coachId });
  // A file no content item names, as an upload whose item was then refused leaves one.
  const contentOrphan = await uploadContentFile(file, coach.coachId, crypto.randomUUID());
  made.objects.push({ bucket: CONTENT_BUCKET, key: contentOrphan });
  return { coachUser: coach.userId, aUser: a.userId, bUser: b.userId };
}

// ---------------------------------------------------------------------------
// The proof
// ---------------------------------------------------------------------------

/** Asks to delete with the password, waits for the email, and checks it: the account's words, Better Auth's link, its token stored a day. */
async function askAndReadLink(base: string, box: ProofMailbox, session: ProofSession, address: string, userId: string, password: string, account: DeletedAccount) {
  const seen = box.emails.length;
  const asked = await askToDelete(base, session, { password });
  check("the password asks for it: 200, the link emailed instead of anything deleted", asked.status === 200 && (asked.json as { message?: string } | null)?.message === "Verification email sent", evidence(asked));
  const email = await nextEmail(box, address, seen);
  const link = deleteLink(base, email);
  check(`"${SUBJECT}" reaches the address the ${account} signs in with, carrying Better Auth's link to ${ACCOUNT_DELETED_PAGE}`, link.path !== "", {
    subjects: box.emails.slice(seen).map((sent) => `${sent.subject} → ${sent.to.join(",")}`),
  });
  const other: DeletedAccount = account === "coach" ? "client" : "coach";
  check(`it says what goes with a ${account}'s account, and not a ${other}'s`, Boolean(email?.text.includes(ACCOUNT_DELETION_TAKES[account]) && !email.text.includes(ACCOUNT_DELETION_TAKES[other])));
  const stored = link.token ? await linkStored(link.token, userId) : { stored: false, expiresInMs: 0 };
  check("Better Auth holds the link's token for the login, for a day", stored.stored && stored.expiresInMs > DAY_MS - 5 * 60_000 && stored.expiresInMs <= DAY_MS, { stored: stored.stored, hours: stored.expiresInMs / 3_600_000 });
  return link;
}

async function prove(base: string, box: ProofMailbox): Promise<void> {
  const passwords = { coach: passwordFor("coach"), client: passwordFor("client") };
  await readKeyColumns();
  check("the catalog names the keys to clients and to coaches", keyColumns.some((key) => key.parent === "clients") && keyColumns.some((key) => key.parent === "coaches"), keyColumns.length);
  const { coachUser, aUser, bUser } = await makeThrowaways(passwords);
  const [aPhoto, bPhoto, aOrphan, contentFile, contentOrphan] = made.objects;
  const clientA = made.clientA!;
  const clientB = made.clientB!;
  const coachId = made.coachId!;
  const aBefore = await pointingAt("clients", clientA);
  check("before: rows point at client A (their check-in, their invitation)", aBefore.total >= 2, aBefore.byTable);
  let allThere = true;
  for (const object of made.objects) allThere = allThere && (await holds(object.bucket, object.key));
  check("before: all five objects are in their buckets, the two no row names among them", allThere && made.objects.length === 5);

  console.info("1. Asking: the password, then an emailed link, and nothing deleted");
  const a = await signInOverHttp(base, CLIENT_A_ADDRESS, passwords.client, "client A");
  const sentBefore = box.emails.length;
  const noPassword = await askToDelete(base, a);
  check("no password: refused with 400", noPassword.status === 400, evidence(noPassword));
  const wrongPassword = await askToDelete(base, a, { password: `${passwords.client}!` });
  check("a wrong password: 400 INVALID_PASSWORD", wrongPassword.status === 400 && (wrongPassword.json as { code?: string } | null)?.code === "INVALID_PASSWORD", evidence(wrongPassword));
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  check("neither sends an email or makes a link", box.emails.length === sentBefore && (await linksHeld(aUser)) === 0, { sent: box.emails.length - sentBefore });
  const firstLink = await askAndReadLink(base, box, a, CLIENT_A_ADDRESS, aUser, passwords.client, "client");
  check("nothing is deleted by asking: client A's rows and login are all there", (await pointingAt("clients", clientA)).total === aBefore.total && (await loginRows(aUser)) >= 3);

  console.info("2. An object that can't be removed refuses the deletion, and leaves everything");
  const refused = await withRemovalsRefused(() =>
    auth.api.deleteUserCallback({ query: { token: firstLink.token, callbackURL: ACCOUNT_DELETED_PAGE }, headers: new Headers(a.headers) }).then(
      () => null,
      (error: unknown) => error
    )
  );
  check(
    `the link is refused with "${ACCOUNT_NOT_DELETED}"`,
    isAPIError(refused) && refused.statusCode === 500 && (refused.body as { message?: string } | undefined)?.message === ACCOUNT_NOT_DELETED,
    isAPIError(refused) ? { status: refused.statusCode, body: refused.body } : String(refused)
  );
  check("every row pointing at client A is still there", (await pointingAt("clients", clientA)).total === aBefore.total);
  check("their login, its session and its profile are there, and the session still opens the app", (await loginRows(aUser)) >= 3 && (await request(base, "GET", "/api/auth/me", { session: a })).status === 200);
  check("their photo, and B's, are still in the bucket", (await holds(aPhoto.bucket, aPhoto.key)) && (await holds(bPhoto.bucket, bPhoto.key)));
  check("the link is spent: asking again from Settings makes a new one", (await linkStored(firstLink.token, aUser)).stored === false);

  console.info("3. Client A's link: everything recorded about them goes, and nothing of anyone else's");
  const secondLink = await askAndReadLink(base, box, a, CLIENT_A_ADDRESS, aUser, passwords.client, "client");
  const followed = secondLink.path ? await request(base, "GET", secondLink.path, { session: a }) : null;
  const lands = (followed?.headers.get("location") ?? "").replace(base, "");
  check(`following it lands on ${ACCOUNT_DELETED_PAGE}`, followed?.status === 302 && lands === ACCOUNT_DELETED_PAGE, followed ? { status: followed.status, lands } : "no link");
  const aAfter = await pointingAt("clients", clientA);
  check("client A's client row is gone, and every row pointing at it, in every table", (await rowsById("clients", [clientA])) === 0 && aAfter.total === 0, aAfter.byTable);
  check("their check-in and its answer are gone", (await rowsById("check_ins", [made.checkIns[0]])) === 0 && (await rowsById("check_in_answers", [made.answers[0]])) === 0);
  check("their photo is gone from the bucket, and the upload no check-in named", !(await holds(aPhoto.bucket, aPhoto.key)) && !(await holds(aOrphan.bucket, aOrphan.key)));
  check("B's photo, whose key their check-in carried, is kept: only a key in their own folder is removed", await holds(bPhoto.bucket, bPhoto.key));
  check("their login is gone, with its sessions, its password and its profile", (await loginRows(aUser)) === 0);
  check("they can no longer sign in: 401", (await signIn(base, CLIENT_A_ADDRESS, passwords.client)) === 401);
  check("the session that opened the link opens nothing", (await request(base, "GET", "/api/auth/me", { session: a })).status === 401);
  check(
    "client B, their login and their assignment, and the coach, their question and their file, are all intact",
    (await rowsById("clients", [clientB])) === 1 &&
      (await loginRows(bUser)) >= 3 &&
      (await pointingAt("clients", clientB)).byTable["content_assignments.client_id"] === 1 &&
      (await rowsById("coaches", [coachId])) === 1 &&
      (await rowsById("check_in_questions", [made.questionId!])) === 1 &&
      (await rowsById("content_items", [made.contentId!])) === 1 &&
      (await holds(contentFile.bucket, contentFile.key))
  );

  console.info("4. The coach's link: the coach, every client of theirs and the clients' logins go, and every object");
  const coach = await signInOverHttp(base, COACH_ADDRESS, passwords.coach, "coach");
  const coachBefore = await pointingAt("coaches", coachId);
  check("before: rows point at the coach (the client, the question, the file, the assignment, the coach's own)", coachBefore.total >= 4, coachBefore.byTable);
  const coachLink = await askAndReadLink(base, box, coach, COACH_ADDRESS, coachUser, passwords.coach, "coach");
  const coachFollowed = coachLink.path ? await request(base, "GET", coachLink.path, { session: coach }) : null;
  const coachLands = (coachFollowed?.headers.get("location") ?? "").replace(base, "");
  check(`following it lands on ${ACCOUNT_DELETED_PAGE}`, coachFollowed?.status === 302 && coachLands === ACCOUNT_DELETED_PAGE, coachFollowed ? { status: coachFollowed.status, lands: coachLands, text: coachFollowed.text.slice(0, 200) } : "no link");
  const coachAfter = await pointingAt("coaches", coachId);
  const bAfter = await pointingAt("clients", clientB);
  check("every row pointing at the coach, in every table, is gone", coachAfter.total === 0 && (await rowsById("coaches", [coachId])) === 0, coachAfter.byTable);
  check("client B's row is gone, and every row pointing at it, in every table", (await rowsById("clients", [clientB])) === 0 && bAfter.total === 0, bAfter.byTable);
  check(
    "the question, both answers, B's check-in and the content item are gone",
    (await rowsById("check_in_questions", [made.questionId!])) === 0 &&
      (await rowsById("check_in_answers", made.answers)) === 0 &&
      (await rowsById("check_ins", made.checkIns)) === 0 &&
      (await rowsById("content_items", [made.contentId!])) === 0
  );
  let noneLeft = true;
  for (const object of made.objects) noneLeft = noneLeft && !(await holds(object.bucket, object.key));
  check("both buckets hold none of the keys: B's photo, the content file, and the file no item named", noneLeft && !(await holds(contentOrphan.bucket, contentOrphan.key)));
  check("client B's login is gone, with its sessions, its password and its profile", (await loginRows(bUser)) === 0);
  check("the coach's login is gone, with its sessions, its password and its profile", (await loginRows(coachUser)) === 0);
  check("neither can sign in: 401 and 401", (await signIn(base, COACH_ADDRESS, passwords.coach)) === 401 && (await signIn(base, CLIENT_B_ADDRESS, passwords.client)) === 401);
}

async function cleanup(): Promise<void> {
  console.info("Cleanup");
  try {
    console.info(`  minted sessions ended: ${await endMintedSessions()}`);
    // The client rows first, then the coach's: deleting a coach row whose client holds an assignment fails on its NO ACTION key.
    const clientIds = [made.clientA, made.clientB].filter((id): id is string => id !== null);
    if (clientIds.length > 0) {
      const { error } = await supabaseAdmin.from("clients").delete().in("id", clientIds);
      if (error) throw new Error(`client rows: ${error.message}`);
    }
    for (const bucket of [PROGRESS_PHOTOS_BUCKET, CONTENT_BUCKET] as const) {
      const keys = made.objects.filter((object) => object.bucket === bucket).map((object) => object.key);
      if (keys.length > 0) await removeObjects(bucket, keys);
    }
    for (const address of ADDRESSES) {
      if (await loginIdFor(address)) await deleteThrowawayLogin(address);
    }
    const { rows } = await authPool.query<{ n: number }>(
      `SELECT ((SELECT count(*) FROM better_auth."user" WHERE email LIKE $1)
             + (SELECT count(*) FROM public.coaches WHERE email LIKE $1)
             + (SELECT count(*) FROM public.clients WHERE email LIKE $1))::int AS n`,
      [ADDRESS_PATTERN]
    );
    let objectsLeft = 0;
    for (const object of made.objects) if (await holds(object.bucket, object.key)) objectsLeft += 1;
    check("cleanup: no throwaway login, coach row, client row or object is left", rows[0]?.n === 0 && objectsLeft === 0, { rows: rows[0]?.n, objectsLeft });
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
    // The server logs the addresses it answered, links' tokens among them.
    if (devServer) console.error(devServer.output.join("").replace(/token=[^&\s]+/g, "token=<token>").slice(-2000));
    process.exitCode = 1;
  } else {
    console.info("Every delete-account check holds.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
