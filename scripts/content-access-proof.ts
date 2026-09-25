/**
 * Request-level proof of docs/DATA-ACCESS-LOCKDOWN-PLAN.md §6 commit 4: the
 * content library reads through the server, and the download's access check is
 * code — against the linked DEV database through a running `next dev`.
 *
 *   WIRE_PROOF_DIR=<scratchpad> npx tsx scripts/content-access-proof.ts record before
 *   WIRE_PROOF_DIR=<scratchpad> npx tsx scripts/content-access-proof.ts record after
 *   WIRE_PROOF_DIR=<scratchpad> npx tsx scripts/content-access-proof.ts diff before after
 *   npx tsx scripts/content-access-proof.ts access before|after
 *
 * `record` writes every content list response whole — its status,
 * Cache-Control, content type and body — for the owner's coach (GET
 * /api/content/library, /items and /folders, and /assignments/<id> for each of
 * their items) and for the client-app smoke account (GET /api/client/resources,
 * which this commit leaves alone). `diff` holds every file byte-identical. The
 * recordings go to WIRE_PROOF_DIR, outside the tree, and are never committed.
 *
 * `access` proves the decisions with real sessions, on throwaways made for the
 * run and removed at the end: logins, clients of the owner's coach, another
 * coach with a client of their own, and three files of the owner's coach — one
 * in the library, one assigned to the active client, one neither.
 *   1  the download, case by case: the owning coach ✓; another coach ✗; the
 *      coach's active client — the library file ✓, the assigned file ✓, the
 *      other file ✗; another coach's client ✗; a deactivated client ✗; a login
 *      that is neither a coach nor a client ✗; no session → the login page
 *   2  a signed-in client on the coach's routes: before, the routes' own
 *      answers (404 "Coach profile not found", upload 403); after, the auth
 *      seam's 401 (CONVENTIONS §8, owner 2026-09-25). This also shows which
 *      code the dev server is serving.
 *   3  the coach's own flows work end to end — a folder made, renamed and
 *      deleted; a file uploaded, assigned, listed, unassigned and deleted — and
 *      another coach's reach into them is refused, each read scoped to the
 *      verified coach
 */
import "./env-bootstrap";

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { supabaseAdmin } from "@/services/supabase-admin";
import { mintSession, send, PROOF_BASE, type ProofResponse, type ProofSession } from "./proof-session";

const COACH_EMAIL = "samuel.k@taboola.com";
// "Test intake form bug": the account every client-app smoke signs in as.
const SMOKE_CLIENT_EMAIL = "s.kalepa91+intake@gmail.com";
const BUCKET = "content-library";

async function ownerCoachId(): Promise<string> {
  const { data, error } = await supabaseAdmin.from("coaches").select("id").eq("email", COACH_EMAIL).single();
  if (error || !data) throw new Error(`Coach not found: ${error?.message}`);
  return data.id;
}

// ---------------------------------------------------------------------------
// record / diff
// ---------------------------------------------------------------------------

function proofDir(label: string): string {
  const root = process.env.WIRE_PROOF_DIR;
  if (!root) throw new Error("Set WIRE_PROOF_DIR to a folder outside the tree (the scratchpad)");
  return join(root, "content-lists", label);
}

/** The whole response a browser receives, as one text: status, headers that matter, body. */
async function capture(session: ProofSession, path: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`${PROOF_BASE}${path}`, {
    headers: { Cookie: session.cookie, Origin: PROOF_BASE, Accept: "application/json" },
    redirect: "manual",
  });
  const body = await res.text();
  const text = [
    `status: ${res.status}`,
    `cache-control: ${res.headers.get("cache-control") ?? ""}`,
    `content-type: ${res.headers.get("content-type") ?? ""}`,
    "",
    body,
  ].join("\n");
  return { status: res.status, text };
}

async function recordOne(dir: string, name: string, session: ProofSession, path: string): Promise<void> {
  const { status, text } = await capture(session, path);
  if (status !== 200) throw new Error(`${session.label} ${path} → ${status}: ${text.slice(0, 300)}`);
  writeFileSync(join(dir, `${name}.txt`), text);
  console.info(`  ${name}  ←  ${path}`);
}

async function record(label: string): Promise<void> {
  const dir = proofDir(label);
  mkdirSync(dir, { recursive: true });
  console.info(`Recording "${label}" into ${dir} against ${PROOF_BASE}`);

  const coachId = await ownerCoachId();
  const coach = await mintSession(COACH_EMAIL, "coach");
  await recordOne(dir, "coach-library", coach, "/api/content/library");
  await recordOne(dir, "coach-items", coach, "/api/content/items");
  await recordOne(dir, "coach-folders", coach, "/api/content/folders");
  const { data: items, error } = await supabaseAdmin.from("content_items").select("id").eq("coach_id", coachId);
  if (error || !items) throw new Error(`items read: ${error?.message}`);
  for (const { id } of items) {
    await recordOne(dir, `coach-assignments-${id}`, coach, `/api/content/assignments/${id}`);
  }
  const client = await mintSession(SMOKE_CLIENT_EMAIL, "smoke");
  await recordOne(dir, "client-resources", client, "/api/client/resources");
  console.info("Done.");
}

function diff(before: string, after: string): void {
  const a = proofDir(before);
  const b = proofDir(after);
  const names = [...new Set([...readdirSync(a), ...readdirSync(b)])].sort();
  let failures = 0;
  for (const name of names) {
    const pa = join(a, name);
    const pb = join(b, name);
    if (!existsSync(pa) || !existsSync(pb)) {
      failures += 1;
      console.error(`✗ ${name}: recorded in ${existsSync(pa) ? before : after} only`);
      continue;
    }
    const ta = readFileSync(pa, "utf8");
    const tb = readFileSync(pb, "utf8");
    if (ta === tb) {
      console.info(`= ${name}: byte-identical (${Buffer.byteLength(ta)} bytes)`);
      continue;
    }
    failures += 1;
    let at = 0;
    while (at < ta.length && ta[at] === tb[at]) at += 1;
    console.error(`✗ ${name}: differs at byte ${at}`);
    console.error(`    ${before}: …${ta.slice(Math.max(0, at - 60), at + 60)}…`);
    console.error(`    ${after}:  …${tb.slice(Math.max(0, at - 60), at + 60)}…`);
  }
  if (failures > 0) {
    console.error(`${failures} of ${names.length} response(s) differ`);
    process.exitCode = 1;
  } else {
    console.info(`Every response holds: ${names.length} byte-identical.`);
  }
}

// ---------------------------------------------------------------------------
// access
// ---------------------------------------------------------------------------

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.info(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 600));
  }
}

function answers(res: ProofResponse, status: number, body: unknown): boolean {
  return res.status === status && res.text === JSON.stringify(body);
}

const seen = (res: ProofResponse) => ({ status: res.status, text: res.text.slice(0, 300) });

/** A multipart upload as the session, with the Origin the CSRF check reads. */
async function upload(session: ProofSession, title: string, fileName: string, bytes: string): Promise<ProofResponse> {
  const form = new FormData();
  form.append("file", new File([bytes], fileName, { type: "application/pdf" }));
  form.append("title", title);
  form.append("type", "pdf");
  form.append("isLibrary", "false");
  const res = await fetch(`${PROOF_BASE}/api/content/upload`, {
    method: "POST",
    headers: { Cookie: session.cookie, Origin: PROOF_BASE, Accept: "application/json" },
    body: form,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    json = null;
  }
  return { status: res.status, text, json };
}

type Made = { users: string[]; clients: string[]; items: string[]; objects: string[]; folders: string[] };

async function makeClient(
  made: Made,
  coachId: string,
  name: string,
  email: string,
  active: boolean
): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .insert({
      coach_id: coachId,
      name,
      email,
      active,
      onboarding_status: "active",
      timezone: "Europe/London",
      user_id: null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`client insert: ${error?.message}`);
  made.clients.push(data.id);
  return data.id;
}

/** A login. With `inviteFor`, an invitation row first, so the signup trigger makes it a client, not a coach. */
async function makeLogin(made: Made, email: string, stamp: number, inviteFor?: string): Promise<string> {
  if (inviteFor) {
    const { error } = await supabaseAdmin.from("client_invitations").insert({ client_id: inviteFor, email, status: "accepted" });
    if (error) throw new Error(`invitation insert: ${error.message}`);
  }
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    password: `Content-proof-${stamp}-${Math.random().toString(36).slice(2)}`,
  });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  made.users.push(data.user.id);
  return data.user.id;
}

async function link(clientId: string, userId: string): Promise<void> {
  const { error } = await supabaseAdmin.from("clients").update({ user_id: userId }).eq("id", clientId);
  if (error) throw new Error(`client link: ${error.message}`);
}

/** A file of the owner's coach: the object in the bucket, then its item. */
async function makeFile(
  made: Made,
  coachId: string,
  stamp: number,
  name: string,
  isLibrary: boolean
): Promise<{ id: string; path: string; bytes: string }> {
  const path = `${coachId}/content-proof-${stamp}/${name}.pdf`;
  const bytes = `%PDF-1.7\n% content access proof ${name} ${stamp}\n`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, new Blob([bytes], { type: "application/pdf" }), { upsert: false });
  if (uploadError) throw new Error(`storage upload ${path}: ${uploadError.message}`);
  made.objects.push(path);
  const { data, error } = await supabaseAdmin
    .from("content_items")
    .insert({
      coach_id: coachId,
      title: `Content proof · ${name}`,
      type: "pdf",
      storage_path: path,
      file_name: `${name}.pdf`,
      file_size: bytes.length,
      mime_type: "application/pdf",
      is_library: isLibrary,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`item insert: ${error?.message}`);
  made.items.push(data.id);
  return { id: data.id, path, bytes };
}

async function assignmentCount(contentId: string, clientId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("content_assignments")
    .select("id", { count: "exact", head: true })
    .eq("content_id", contentId)
    .eq("client_id", clientId);
  if (error) throw new Error(`assignment count: ${error.message}`);
  return count ?? 0;
}

async function rowExists(table: "content_items" | "content_folders", id: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from(table).select("id").eq("id", id).maybeSingle();
  if (error) throw new Error(`${table} read: ${error.message}`);
  return data !== null;
}

async function objectExists(path: string): Promise<boolean> {
  const { data } = await supabaseAdmin.storage.from(BUCKET).download(path);
  return data !== null;
}

async function access(mode: "before" | "after"): Promise<void> {
  console.info(`Access proof, ${mode} the change, against ${PROOF_BASE}`);
  const AFTER = mode === "after";
  const coachId = await ownerCoachId();
  const stamp = Date.now();
  const email = (who: string) => `content-proof-${who}-${stamp}@fixture.local`;
  const made: Made = { users: [], clients: [], items: [], objects: [], folders: [] };
  const DENIED = { success: false, error: "Access denied" };
  const UNAUTHORIZED = { success: false, error: "Unauthorized" };

  try {
    console.info("Setup: another coach and their client; three clients of the owner's coach; three files");
    const otherCoachUser = await makeLogin(made, email("coach"), stamp);
    const { data: otherCoach, error: otherCoachError } = await supabaseAdmin
      .from("coaches")
      .select("id")
      .eq("user_id", otherCoachUser)
      .single();
    if (otherCoachError || !otherCoach) throw new Error(`the other coach's row: ${otherCoachError?.message}`);

    const active = await makeClient(made, coachId, "Content proof · active client", email("active"), true);
    await link(active, await makeLogin(made, email("active"), stamp, active));
    const deactivated = await makeClient(made, coachId, "Content proof · deactivated client", email("deactivated"), false);
    await link(deactivated, await makeLogin(made, email("deactivated"), stamp, deactivated));
    // Invited, so the login is a client's, but never linked: neither a coach nor a client.
    const unlinked = await makeClient(made, coachId, "Content proof · never linked", email("neither"), true);
    await makeLogin(made, email("neither"), stamp, unlinked);
    const foreign = await makeClient(made, otherCoach.id, "Content proof · other coach's client", email("foreign"), true);
    await link(foreign, await makeLogin(made, email("foreign"), stamp, foreign));

    const library = await makeFile(made, coachId, stamp, "library-guide", true);
    const assigned = await makeFile(made, coachId, stamp, "assigned-plan", false);
    const other = await makeFile(made, coachId, stamp, "private-notes", false);
    const { error: assignError } = await supabaseAdmin
      .from("content_assignments")
      .insert({ content_id: assigned.id, client_id: active, assigned_by: coachId });
    if (assignError) throw new Error(`assignment insert: ${assignError.message}`);

    const coach = await mintSession(COACH_EMAIL, "coach");
    const otherCoachSession = await mintSession(email("coach"), "other coach");
    const activeSession = await mintSession(email("active"), "active client");
    const deactivatedSession = await mintSession(email("deactivated"), "deactivated client");
    const neitherSession = await mintSession(email("neither"), "neither");
    const foreignSession = await mintSession(email("foreign"), "other coach's client");
    const download = (session: ProofSession, id: string) => send(session, "GET", `/api/content/download/${id}`);

    console.info("1. The download, case by case");
    const own = await download(coach, library.id);
    const ownUrl = (own.json as { data?: { url?: string } } | null)?.data?.url ?? "";
    check(
      "the owning coach → 200, a signed URL to the file",
      own.status === 200 &&
        ownUrl.includes(`/object/sign/${BUCKET}/${library.path}?token=`) &&
        (own.json as { data?: { fileName?: string; mimeType?: string } }).data?.fileName === "library-guide.pdf",
      seen(own)
    );
    const fetched = ownUrl ? await fetch(ownUrl) : null;
    check("…which serves the file's own bytes", fetched?.status === 200 && (await fetched.text()) === library.bytes, {
      status: fetched?.status,
    });
    check("another coach → 403", answers(await download(otherCoachSession, library.id), 403, DENIED));
    const libraryOpen = await download(activeSession, library.id);
    check("the coach's active client, the library file → 200", libraryOpen.status === 200, seen(libraryOpen));
    const assignedOpen = await download(activeSession, assigned.id);
    check("the coach's active client, the file assigned to them → 200", assignedOpen.status === 200, seen(assignedOpen));
    check("the coach's active client, a file neither in the library nor theirs → 403", answers(await download(activeSession, other.id), 403, DENIED));
    check("another coach's client → 403", answers(await download(foreignSession, library.id), 403, DENIED));
    const deactivatedOpen = await download(deactivatedSession, library.id);
    check(
      AFTER ? "a deactivated client → 401, the auth seam's answer" : "a deactivated client → 403",
      AFTER ? answers(deactivatedOpen, 401, UNAUTHORIZED) : answers(deactivatedOpen, 403, DENIED),
      seen(deactivatedOpen)
    );
    const neitherOpen = await download(neitherSession, library.id);
    check(
      AFTER ? "a login that is neither a coach nor a client → 401, the auth seam's answer" : "a login that is neither → 403",
      AFTER ? answers(neitherOpen, 401, UNAUTHORIZED) : answers(neitherOpen, 403, DENIED),
      seen(neitherOpen)
    );
    const anonymous = await fetch(`${PROOF_BASE}/api/content/download/${library.id}`, { redirect: "manual" });
    check(
      "no session → 307 to the login page, before any route runs",
      anonymous.status === 307 && (anonymous.headers.get("location") ?? "").endsWith("/login"),
      { status: anonymous.status, location: anonymous.headers.get("location") }
    );

    console.info("2. A signed-in client on the coach's routes");
    const clientLibrary = await send(activeSession, "GET", "/api/content/library");
    check(
      AFTER ? "the library → 401 Unauthorized (the auth seam)" : "the library → 404 Coach profile not found (the route's own lookup)",
      AFTER
        ? answers(clientLibrary, 401, UNAUTHORIZED)
        : answers(clientLibrary, 404, { success: false, error: "Coach profile not found" }),
      seen(clientLibrary)
    );
    const clientUpload = await upload(activeSession, "Content proof · client upload", "client-upload.pdf", `%PDF-1.7\n% client ${stamp}\n`);
    check(
      AFTER
        ? "an upload → 401 Authentication required (the auth seam)"
        : "an upload → 403 Coach profile required for uploads (the route's own lookup)",
      AFTER
        ? answers(clientUpload, 401, { success: false, error: "Authentication required" })
        : answers(clientUpload, 403, { success: false, error: "Coach profile required for uploads" }),
      seen(clientUpload)
    );

    console.info("3. The coach's own flows, and another coach's reach into them");
    const folderName = `Content proof ${stamp}`;
    const madeFolder = await send(coach, "POST", "/api/content/folders", { name: folderName });
    const folderId = (madeFolder.json as { data?: { id?: string } } | null)?.data?.id ?? "";
    if (folderId) made.folders.push(folderId);
    check("the coach makes a folder → 200", madeFolder.status === 200 && folderId !== "", seen(madeFolder));
    const renamed = await send(coach, "PATCH", `/api/content/folders/${folderId}`, { name: `${folderName} renamed` });
    check(
      "…renames it → 200",
      renamed.status === 200 && (renamed.json as { data?: { name?: string } }).data?.name === `${folderName} renamed`,
      seen(renamed)
    );
    check(
      "another coach renaming it → 404",
      answers(await send(otherCoachSession, "PATCH", `/api/content/folders/${folderId}`, { name: "Taken over" }), 404, {
        success: false,
        error: "Folder not found",
      })
    );
    const folderGone = await send(coach, "DELETE", `/api/content/folders/${folderId}`);
    check("…and deletes it → 200, the folder gone", folderGone.status === 200 && !(await rowExists("content_folders", folderId)), seen(folderGone));

    const uploaded = await upload(coach, `Content proof upload ${stamp}`, "uploaded-sheet.pdf", `%PDF-1.7\n% upload ${stamp}\n`);
    const uploadedItem = (uploaded.json as { data?: { id?: string; storagePath?: string } } | null)?.data;
    if (uploadedItem?.id) made.items.push(uploadedItem.id);
    if (uploadedItem?.storagePath) made.objects.push(uploadedItem.storagePath);
    check(
      "the coach uploads a file → 200, stored under their folder",
      uploaded.status === 200 && (uploadedItem?.storagePath ?? "").startsWith(`${coachId}/`),
      seen(uploaded)
    );
    const uploadedId = uploadedItem?.id ?? "";
    const assignedNow = await send(coach, "POST", "/api/content/assignments", { contentId: uploadedId, clientId: active });
    check("…assigns it to their client → 200", assignedNow.status === 200 && (await assignmentCount(uploadedId, active)) === 1, seen(assignedNow));
    const listed = await send(coach, "GET", `/api/content/assignments/${uploadedId}`);
    const listedRows = (listed.json as { data?: Array<{ clientId: string }> } | null)?.data ?? [];
    check("…lists its assignments → 200, the one client", listed.status === 200 && listedRows.length === 1 && listedRows[0].clientId === active, seen(listed));
    check(
      "…to another coach's client → 404",
      answers(await send(coach, "POST", "/api/content/assignments", { contentId: uploadedId, clientId: foreign }), 404, {
        success: false,
        error: "Client not found",
      })
    );
    const unassigned = await send(coach, "DELETE", `/api/content/assignments/${uploadedId}/${active}`);
    check("…unassigns it → 200, the assignment gone", unassigned.status === 200 && (await assignmentCount(uploadedId, active)) === 0, seen(unassigned));
    const deleted = await send(coach, "DELETE", `/api/content/items/${uploadedId}`);
    check(
      "…and deletes it → 200, the item and its file gone",
      deleted.status === 200 &&
        !(await rowExists("content_items", uploadedId)) &&
        !(await objectExists(uploadedItem?.storagePath ?? "")),
      seen(deleted)
    );

    const NOT_FOUND = { success: false, error: "Content not found" };
    check("another coach listing the owner's assignments → 404", answers(await send(otherCoachSession, "GET", `/api/content/assignments/${assigned.id}`), 404, NOT_FOUND));
    check(
      "another coach assigning the owner's file to their own client → 404",
      answers(await send(otherCoachSession, "POST", "/api/content/assignments", { contentId: assigned.id, clientId: foreign }), 404, NOT_FOUND)
    );
    check(
      "another coach unassigning the owner's file → 404, the assignment standing",
      answers(await send(otherCoachSession, "DELETE", `/api/content/assignments/${assigned.id}/${active}`), 404, NOT_FOUND) &&
        (await assignmentCount(assigned.id, active)) === 1
    );
    check(
      "another coach deleting the owner's file → 404, the file standing",
      answers(await send(otherCoachSession, "DELETE", `/api/content/items/${library.id}`), 404, NOT_FOUND) &&
        (await rowExists("content_items", library.id))
    );
  } finally {
    console.info("Cleanup");
    // Every delete first, so a failed read below cannot leave a row behind.
    for (const id of made.items) {
      const { error } = await supabaseAdmin.from("content_items").delete().eq("id", id);
      if (error) console.error(`  item not deleted: ${error.message}`);
    }
    if (made.objects.length > 0) {
      const { error } = await supabaseAdmin.storage.from(BUCKET).remove(made.objects);
      if (error) console.error(`  files not removed: ${error.message}`);
    }
    for (const id of made.folders) {
      const { error } = await supabaseAdmin.from("content_folders").delete().eq("id", id);
      if (error) console.error(`  folder not deleted: ${error.message}`);
    }
    for (const id of made.clients) {
      const { error } = await supabaseAdmin.from("clients").delete().eq("id", id);
      if (error) console.error(`  client not deleted: ${error.message}`);
    }
    // The other coach's login takes their coach row, and with it their client.
    for (const id of made.users) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
      if (error) console.error(`  login not deleted: ${error.message}`);
    }

    let left = 0;
    for (const id of made.items) left += (await rowExists("content_items", id)) ? 1 : 0;
    for (const id of made.folders) left += (await rowExists("content_folders", id)) ? 1 : 0;
    for (const path of made.objects) left += (await objectExists(path)) ? 1 : 0;
    for (const id of made.clients) {
      const { data } = await supabaseAdmin.from("clients").select("id").eq("id", id).maybeSingle();
      left += data ? 1 : 0;
    }
    for (const id of made.users) {
      const { data } = await supabaseAdmin.from("profiles").select("user_id").eq("user_id", id).maybeSingle();
      const { data: user } = await supabaseAdmin.auth.admin.getUserById(id);
      left += data || user?.user ? 1 : 0;
    }
    check(
      `cleanup: ${made.items.length} files, ${made.folders.length} folder, ${made.clients.length} clients and ${made.users.length} logins are gone`,
      left === 0,
      { left }
    );
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
  if (mode === "access" && (first === "before" || first === "after")) return access(first);
  throw new Error("usage: record <label> | diff <before> <after> | access before|after");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
