import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/supabase-admin", () => ({ supabaseAdmin: { from: vi.fn(), rpc: vi.fn() } }));
// A deleted account's objects: services/storage-service.test.ts proves the removal itself.
vi.mock("@/services/storage-service", () => ({ PROGRESS_PHOTOS_BUCKET: "progress-photos", listObjects: vi.fn(), removeObjects: vi.fn() }));
vi.mock("@/services/content-storage-service", () => ({ CONTENT_BUCKET: "content-library" }));
vi.mock("@/lib/error-handler", () => ({ captureApiError: vi.fn() }));
// Better Auth's adapter and endpoint, as moveLoginEmail reaches them; lib/auth.test.ts proves what Better Auth itself does.
const adapter = vi.hoisted(() => ({
  findUserByEmail: vi.fn(),
  updateUser: vi.fn(),
  listSessions: vi.fn(),
  deleteUserSessions: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  auth: { $context: Promise.resolve({ internalAdapter: adapter }), api: { requestPasswordReset: vi.fn() } },
}));

import { deleteAccountRecords, isAddressHeldElsewhere, moveLoginEmail, MovedLoginUnfinishedError, readLoginRole } from "./account-service";
import { auth } from "@/lib/auth";
import { captureApiError } from "@/lib/error-handler";
import { listObjects, removeObjects } from "@/services/storage-service";
import { supabaseAdmin } from "@/services/supabase-admin";

/**
 * services/account-service.ts: the reads behind a change of email's new
 * address, and the owner's move of a login. Each statement on the app's rows
 * is recorded with its table and every filter, and answers what the test
 * gives its table.
 */
type Statement = { table: string; calls: unknown[][] };
let statements: Statement[] = [];
let answers: Record<string, { data?: unknown; error?: { message: string } | null }> = {};

function stubSupabase() {
  statements = [];
  answers = {};
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
    const statement: Statement = { table, calls: [] };
    statements.push(statement);
    const builder: Record<string, unknown> = {
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null, ...answers[table] }).then(resolve, reject),
    };
    for (const verb of ["select", "eq", "or", "not", "order", "range", "maybeSingle"]) {
      builder[verb] = (...args: unknown[]) => (statement.calls.push([verb, ...args]), builder);
    }
    return builder;
  }) as never);
}

const ASKER = "user-asker";

describe("isAddressHeldElsewhere: a change of email's new address is no one else's (rule 17)", () => {
  beforeEach(stubSupabase);

  it("reads the coach rows and the client rows holding the address, each by its email, at once", async () => {
    await isAddressHeldElsewhere("new@example.com", ASKER);
    expect(statements).toEqual([
      { table: "coaches", calls: [["select", "user_id"], ["eq", "email", "new@example.com"]] },
      { table: "clients", calls: [["select", "user_id"], ["eq", "email", "new@example.com"]] },
    ]);
  });

  it.each([
    ["a coach row of another login", { coaches: { data: [{ user_id: "user-other" }] } }],
    ["a coach row of no login", { coaches: { data: [{ user_id: null }] } }],
    ["a client row of another login", { clients: { data: [{ user_id: "user-other" }] } }],
    ["a client row of no login, an invited client", { clients: { data: [{ user_id: null }] } }],
  ])("is held when %s holds it", async (_label, given) => {
    answers = given;
    await expect(isAddressHeldElsewhere("new@example.com", ASKER)).resolves.toBe(true);
  });

  it("is not held when no row holds it", async () => {
    await expect(isAddressHeldElsewhere("new@example.com", ASKER)).resolves.toBe(false);
  });

  it("counts the asker's own rows for nothing: alone they don't hold it, and beside another holder they don't hide it", async () => {
    answers = { clients: { data: [{ user_id: ASKER }] } };
    await expect(isAddressHeldElsewhere("mine@example.com", ASKER)).resolves.toBe(false);
    answers = { clients: { data: [{ user_id: ASKER }, { user_id: null }] } };
    await expect(isAddressHeldElsewhere("mine@example.com", ASKER)).resolves.toBe(true);
  });

  it.each(["coaches", "clients"])("throws when the %s read fails, so a fault refuses rather than guesses", async (table) => {
    answers = { [table]: { error: { message: "timeout" } } };
    await expect(isAddressHeldElsewhere("new@example.com", ASKER)).rejects.toThrow(`Failed to read the ${table === "coaches" ? "coach" : "client"} rows holding the address: timeout`);
  });
});

const LOGIN = { user: { id: "user-1", email: "lost@example.com" }, accounts: [] };
const CURRENT = "lost@example.com";
const NEW = "found@example.com";

describe("moveLoginEmail: the owner moves a login to a new address (rule 19, D39)", () => {
  const requestPasswordReset = vi.mocked(auth.api.requestPasswordReset);

  beforeEach(() => {
    vi.clearAllMocks();
    stubSupabase();
    adapter.findUserByEmail.mockImplementation((email: string) => Promise.resolve(email === CURRENT ? LOGIN : null));
    adapter.updateUser.mockResolvedValue({ ...LOGIN.user, email: NEW });
    adapter.listSessions.mockResolvedValue([{ id: "s1" }, { id: "s2" }]);
    adapter.deleteUserSessions.mockResolvedValue(undefined);
    requestPasswordReset.mockResolvedValue({ status: true } as never);
  });

  const move = () => moveLoginEmail({ email: CURRENT, to: NEW });

  it("moves the address, verified, through Better Auth's adapter, then ends every session, then asks for the reset at the new address", async () => {
    await expect(move()).resolves.toEqual({ moved: true, userId: "user-1", sessionsEnded: 2 });
    expect(adapter.updateUser).toHaveBeenCalledWith("user-1", { email: NEW, emailVerified: true });
    expect(adapter.deleteUserSessions).toHaveBeenCalledWith("user-1");
    expect(requestPasswordReset).toHaveBeenCalledWith({ body: { email: NEW, redirectTo: "/reset-password" } });
    const order = (fn: unknown) => vi.mocked(fn as () => void).mock.invocationCallOrder[0];
    expect(order(adapter.updateUser)).toBeLessThan(order(adapter.deleteUserSessions));
    expect(order(adapter.deleteUserSessions)).toBeLessThan(order(requestPasswordReset));
    // The copies are the trigger's: nothing here writes a coach or client row.
    expect(statements.every((statement) => statement.calls.every(([verb]) => verb === "select" || verb === "eq"))).toBe(true);
  });

  it("looks the new address up as a login, a coach row and a client row", async () => {
    await move();
    expect(adapter.findUserByEmail).toHaveBeenCalledWith(NEW);
    expect(statements).toEqual([
      { table: "coaches", calls: [["select", "user_id"], ["eq", "email", NEW]] },
      { table: "clients", calls: [["select", "user_id"], ["eq", "email", NEW]] },
    ]);
  });

  /** Nothing about any login changed: no write through Better Auth, no reset asked. */
  const expectNothingChanged = () => {
    expect(adapter.updateUser).not.toHaveBeenCalled();
    expect(adapter.deleteUserSessions).not.toHaveBeenCalled();
    expect(requestPasswordReset).not.toHaveBeenCalled();
  };

  it("refuses an address with no login, and changes nothing", async () => {
    adapter.findUserByEmail.mockResolvedValue(null);
    await expect(move()).resolves.toEqual({ moved: false, refusal: "no_login" });
    expectNothingChanged();
  });

  it.each([
    ["a login", () => adapter.findUserByEmail.mockImplementation((email: string) => Promise.resolve(email === CURRENT || email === NEW ? LOGIN : null))],
    ["a coach row", () => (answers = { coaches: { data: [{ user_id: null }] } })],
    ["a client row", () => (answers = { clients: { data: [{ user_id: "user-other" }] } })],
  ] as const)("refuses a new address %s holds, and changes nothing", async (holder, holdIt) => {
    holdIt();
    await expect(move()).resolves.toEqual({ moved: false, refusal: "in_use", heldBy: holder });
    expectNothingChanged();
  });

  it("a move that fails throws, and nothing after it runs", async () => {
    const unique = new Error('duplicate key value violates unique constraint "coaches_email_key"');
    adapter.updateUser.mockRejectedValue(unique);
    await expect(move()).rejects.toBe(unique);
    expect(adapter.deleteUserSessions).not.toHaveBeenCalled();
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });

  it("sessions that can't be ended after the move throw, saying the address moved and what finishes it, and no reset is asked", async () => {
    adapter.deleteUserSessions.mockRejectedValue(new Error("pool down"));
    const failed = move();
    await expect(failed).rejects.toBeInstanceOf(MovedLoginUnfinishedError);
    await expect(failed).rejects.toThrow(
      `The login moved to ${NEW} with its coach and client rows, but its sessions could not be ended: pool down. A password reset from "Forgot your password?" at ${NEW} ends every session of it.`
    );
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });

  it("a reset that can't be asked for after the move throws the same way", async () => {
    requestPasswordReset.mockRejectedValue(new Error("verification write failed"));
    await expect(move()).rejects.toThrow(
      `The login moved to ${NEW} with its coach and client rows, but "Reset your password" could not be asked for: verification write failed.`
    );
    expect(adapter.deleteUserSessions).toHaveBeenCalledWith("user-1");
  });
});

describe("readLoginRole: the app's role of a login", () => {
  beforeEach(stubSupabase);

  it.each([
    ["trainer", "trainer"],
    ["client", "client"],
    ["a role the app doesn't have", null],
  ])("reads profiles.role by the login's id: %s", async (role, expected) => {
    answers.profiles = { data: { role } };
    expect(await readLoginRole("user-1")).toBe(expected);
    expect(statements).toEqual([{ table: "profiles", calls: [["select", "role"], ["eq", "user_id", "user-1"], ["maybeSingle"]] }]);
  });

  it("a login with no profile has no role", async () => {
    answers.profiles = { data: null };
    expect(await readLoginRole("user-1")).toBeNull();
  });

  it("throws when the profile can't be read", async () => {
    answers.profiles = { data: null, error: { message: "connection reset" } };
    await expect(readLoginRole("user-1")).rejects.toThrow("Failed to read the login's role: connection reset");
  });
});

describe("deleteAccountRecords: Better Auth's beforeDelete, objects first, rows second (2.6, D20, D21)", () => {
  const COACH = "coach-1";
  /** Every step of the deletion in the order it began: a read of a table, a folder listed, a removal, a function call. */
  let steps: string[];
  /** What each folder holds, by bucket and folder: what the listing answers. */
  let folders: Record<string, string[]>;

  beforeEach(() => {
    stubSupabase();
    steps = [];
    folders = {};
    vi.mocked(captureApiError).mockClear();
    const from = vi.mocked(supabaseAdmin.from).getMockImplementation()!;
    vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => (steps.push(`read ${table}`), from(table as never))) as never);
    vi.mocked(listObjects).mockReset().mockImplementation((bucket, folder) => {
      steps.push(`list ${bucket} ${folder}`);
      return Promise.resolve(folders[`${bucket} ${folder}`] ?? []);
    });
    vi.mocked(removeObjects).mockReset().mockImplementation((bucket) => {
      steps.push(`remove ${bucket}`);
      return Promise.resolve();
    });
    vi.mocked(supabaseAdmin.rpc).mockReset().mockImplementation(((name: string) => {
      steps.push(`call ${name}`);
      return Promise.resolve({ data: 1, error: null });
    }) as never);
  });

  it("a client: the role, their client rows, every object in their photo folder, then delete_client_records, in that order", async () => {
    answers.profiles = { data: { role: "client" } };
    answers.clients = { data: [{ id: "client-a" }] };
    folders["progress-photos client-a"] = ["client-a/1-front.jpg", "client-a/2-side.jpg", "client-a/3-back.png"];
    await deleteAccountRecords({ id: "user-a" });
    expect(steps).toEqual([
      "read profiles",
      "read clients",
      "list progress-photos client-a",
      "remove progress-photos",
      "call delete_client_records",
    ]);
    expect(removeObjects).toHaveBeenCalledWith("progress-photos", ["client-a/1-front.jpg", "client-a/2-side.jpg", "client-a/3-back.png"]);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("delete_client_records", { p_user_id: "user-a" });
  });

  it("a client's folders are the client rows the login signs in as, read whole past the row cap; no check-in is read", async () => {
    answers.profiles = { data: { role: "client" } };
    answers.clients = { data: [{ id: "client-a" }] };
    await deleteAccountRecords({ id: "user-a" });
    expect(statements.find((statement) => statement.table === "clients")?.calls).toEqual([
      ["select", "id"],
      ["eq", "user_id", "user-a"],
      ["order", "id"],
      ["range", 0, 999],
    ]);
    expect(steps).not.toContain("read check_ins");
  });

  it("only the account's own folders are listed: a check-in naming another client's photo can't reach it", async () => {
    answers.profiles = { data: { role: "client" } };
    answers.clients = { data: [{ id: "client-a" }] };
    answers.check_ins = { data: [{ client_id: "client-a", photo_front: "client-b/9-front.jpg" }] };
    folders["progress-photos client-b"] = ["client-b/9-front.jpg"];
    await deleteAccountRecords({ id: "user-a" });
    expect(vi.mocked(listObjects).mock.calls).toEqual([["progress-photos", "client-a"]]);
    expect(removeObjects).toHaveBeenCalledWith("progress-photos", []);
  });

  it("a coach: the role, the coach row, their clients and their content folder at once, each client's photo folder, the objects, then delete_coach_records", async () => {
    answers.profiles = { data: { role: "trainer" } };
    answers.coaches = { data: { id: COACH } };
    answers.clients = { data: [{ id: "client-a" }, { id: "client-b" }] };
    folders["progress-photos client-a"] = ["client-a/1-front.jpg"];
    folders["progress-photos client-b"] = ["client-b/2-side.jpg"];
    folders[`content-library ${COACH}`] = [`${COACH}/item-1/1-plan.pdf`, `${COACH}/orphan/2-upload.pdf`];
    await deleteAccountRecords({ id: "user-coach" });
    expect(steps).toEqual([
      "read profiles",
      "read coaches",
      "read clients",
      `list content-library ${COACH}`,
      "list progress-photos client-a",
      "list progress-photos client-b",
      "remove progress-photos",
      "remove content-library",
      "call delete_coach_records",
    ]);
    expect(statements.find((statement) => statement.table === "clients")?.calls.slice(0, 2)).toEqual([
      ["select", "id"],
      ["eq", "coach_id", COACH],
    ]);
    expect(removeObjects).toHaveBeenCalledWith("progress-photos", ["client-a/1-front.jpg", "client-b/2-side.jpg"]);
    expect(removeObjects).toHaveBeenCalledWith("content-library", [`${COACH}/item-1/1-plan.pdf`, `${COACH}/orphan/2-upload.pdf`]);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("delete_coach_records", { p_user_id: "user-coach" });
  });

  it("a coach's clients' folders are listed a few at a time, never all at once", async () => {
    answers.profiles = { data: { role: "trainer" } };
    answers.coaches = { data: { id: COACH } };
    answers.clients = { data: Array.from({ length: 20 }, (_, i) => ({ id: `client-${i}` })) };
    let inFlight = 0;
    let most = 0;
    vi.mocked(listObjects).mockImplementation(async (bucket) => {
      if (bucket === "content-library") return [];
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return [];
    });
    await deleteAccountRecords({ id: "user-coach" });
    expect(vi.mocked(listObjects).mock.calls.filter(([bucket]) => bucket === "progress-photos")).toHaveLength(20);
    expect(most).toBe(8);
  });

  it("a coach whose coach row is already gone (a retry) lists nothing, removes nothing, and the function still runs", async () => {
    answers.profiles = { data: { role: "trainer" } };
    answers.coaches = { data: null };
    await deleteAccountRecords({ id: "user-coach" });
    expect(steps).toEqual(["read profiles", "read coaches", "call delete_coach_records"]);
  });

  it("a login with no role holds nothing of the app's: nothing is removed and no function runs", async () => {
    answers.profiles = { data: null };
    await deleteAccountRecords({ id: "user-x" });
    expect(steps).toEqual(["read profiles"]);
    expect(captureApiError).not.toHaveBeenCalled();
  });

  it("a role that can't be read refuses before anything is listed or removed", async () => {
    answers.profiles = { data: null, error: { message: "connection reset" } };
    await expect(deleteAccountRecords({ id: "user-a" })).rejects.toThrow("Failed to read the login's role");
    expect(steps).toEqual(["read profiles"]);
    expect(captureApiError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ userId: "user-a", removed: {} }));
  });

  it("a folder that can't be listed refuses before any object is removed", async () => {
    answers.profiles = { data: { role: "client" } };
    answers.clients = { data: [{ id: "client-a" }] };
    vi.mocked(listObjects).mockRejectedValue(new Error("Failed to list client-a/ in progress-photos: timeout"));
    await expect(deleteAccountRecords({ id: "user-a" })).rejects.toThrow("timeout");
    expect(removeObjects).not.toHaveBeenCalled();
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it("an object removal that fails refuses before any row is deleted", async () => {
    answers.profiles = { data: { role: "client" } };
    answers.clients = { data: [{ id: "client-a" }] };
    folders["progress-photos client-a"] = ["client-a/1-front.jpg"];
    vi.mocked(removeObjects).mockRejectedValue(new Error("Failed to remove 1 object(s) from progress-photos: 503"));
    await expect(deleteAccountRecords({ id: "user-a" })).rejects.toThrow("503");
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
    expect(captureApiError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ userId: "user-a", removed: {} }));
  });

  it("a coach's content removal that fails after the photos went refuses before any row, reporting the photos that went", async () => {
    answers.profiles = { data: { role: "trainer" } };
    answers.coaches = { data: { id: COACH } };
    answers.clients = { data: [{ id: "client-a" }] };
    folders["progress-photos client-a"] = ["client-a/1-front.jpg"];
    folders[`content-library ${COACH}`] = [`${COACH}/item-1/1-plan.pdf`];
    vi.mocked(removeObjects).mockImplementation((bucket) => {
      steps.push(`remove ${bucket}`);
      return bucket === "content-library" ? Promise.reject(new Error("Failed to remove 1 object(s) from content-library: 500")) : Promise.resolve();
    });
    await expect(deleteAccountRecords({ id: "user-coach" })).rejects.toThrow("content-library");
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
    expect(captureApiError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ removed: { "progress-photos": ["client-a/1-front.jpg"] } })
    );
  });

  it("a function that fails after the objects went refuses, reporting every key that went, so a retry can finish it", async () => {
    answers.profiles = { data: { role: "client" } };
    answers.clients = { data: [{ id: "client-a" }] };
    folders["progress-photos client-a"] = ["client-a/1-front.jpg"];
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { message: "deadlock detected" } } as never);
    await expect(deleteAccountRecords({ id: "user-a" })).rejects.toThrow("delete_client_records failed: deadlock detected");
    expect(captureApiError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ userId: "user-a", removed: { "progress-photos": ["client-a/1-front.jpg"] } })
    );
  });
});

