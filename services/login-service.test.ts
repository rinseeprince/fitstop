import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: { api: { createUser: vi.fn(), signInEmail: vi.fn(), requestPasswordReset: vi.fn() } },
  authPool: { query: vi.fn() },
}));
vi.mock("@/lib/error-handler", () => ({ captureApiError: vi.fn() }));
vi.mock("@/services/email-service", () => ({ sendInvitationEmail: vi.fn(), generateInviteToken: vi.fn() }));
vi.mock("@/services/supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("@/services/invitation-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/invitation-service")>()),
  findLiveInvitation: vi.fn(),
}));

import { APIError } from "better-auth/api";
import { acceptClientInvitation, createCoachLogin } from "./login-service";
import { auth, authPool } from "@/lib/auth";
import { captureApiError } from "@/lib/error-handler";
import { supabaseAdmin } from "@/services/supabase-admin";
import { findLiveInvitation, type LiveInvitation } from "@/services/invitation-service";

/**
 * services/login-service.ts's orchestration: Better Auth's calls and the pool
 * are stubbed (lib/auth.test.ts proves what Better Auth itself answers), and
 * supabaseAdmin records every write, in order, with its filters.
 */
type Write = { table: string; verb: "insert" | "update"; row: unknown; filters: unknown[][] };
type Answer = { data?: unknown; error?: { message: string } | null };

let writes: Write[] = [];
let answers: Record<string, Answer> = {};

function stubSupabase() {
  writes = [];
  answers = {};
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
    const write = (verb: Write["verb"]) => (row: unknown) => {
      const record: Write = { table, verb, row, filters: [] };
      writes.push(record);
      const builder = {
        eq: (...args: unknown[]) => (record.filters.push(["eq", ...args]), builder),
        is: (...args: unknown[]) => (record.filters.push(["is", ...args]), builder),
        neq: (...args: unknown[]) => (record.filters.push(["neq", ...args]), builder),
        select: (...args: unknown[]) => (record.filters.push(["select", ...args]), builder),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null, ...answers[`${table}.${verb}`] }).then(resolve, reject),
      };
      return builder;
    };
    return { insert: write("insert"), update: write("update") };
  }) as never);
}

const INVITATION: LiveInvitation = {
  id: "invitation-1",
  clientId: "client-1",
  email: "Invited@Example.com",
  clientName: "Invited Client",
  coachName: "Coach",
  expiresAt: null,
};
const USER = { id: "user-1", email: "invited@example.com" };
const SET_COOKIES = ["better-auth.session_token=abc.sig; Path=/; HttpOnly; SameSite=Lax"];
const PASSWORD = "a strong password";

const api = vi.mocked(auth.api);
const query = vi.mocked(authPool.query);
const DELETE_BY_ID = expect.stringMatching(/^DELETE FROM better_auth\."user" WHERE id = \$1$/);

/** The happy path's answers, each test then breaking one. */
function stubAccept() {
  stubSupabase();
  vi.mocked(findLiveInvitation).mockResolvedValue({ invitation: INVITATION });
  api.createUser.mockResolvedValue({ user: USER } as never);
  api.signInEmail.mockResolvedValue({
    headers: new Headers(SET_COOKIES.map((c): [string, string] => ["set-cookie", c])),
    response: {},
  } as never);
  answers["clients.update"] = { data: [{ id: INVITATION.clientId }] };
  answers["client_invitations.update"] = { data: [{ id: INVITATION.id }] };
  query.mockResolvedValue({ rows: [] } as never);
}

const accept = () => acceptClientInvitation({ token: "a".repeat(64), password: PASSWORD });

describe("acceptClientInvitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubAccept();
  });

  it("makes the login on the invited address, writes the profile and the link, signs in, then marks the invitation", async () => {
    const result = await accept();

    expect(result).toEqual({ accepted: true, userId: USER.id, clientId: INVITATION.clientId, setCookies: SET_COOKIES });
    // On the server with no headers: no session, so create-user runs as the
    // server's own call (lib/auth.test.ts), and nothing the browser sent decides whose login it is.
    expect(api.createUser).toHaveBeenCalledWith({
      body: { email: INVITATION.email, name: INVITATION.clientName, password: PASSWORD, data: { emailVerified: true } },
    });
    expect(api.signInEmail).toHaveBeenCalledWith({ body: { email: USER.email, password: PASSWORD }, returnHeaders: true });
    expect(writes).toEqual([
      { table: "profiles", verb: "insert", row: { user_id: USER.id, role: "client" }, filters: [] },
      {
        table: "clients",
        verb: "update",
        row: { user_id: USER.id, email: USER.email },
        filters: [["eq", "id", INVITATION.clientId], ["is", "user_id", null], ["select", "id"]],
      },
      {
        table: "client_invitations",
        verb: "update",
        row: { accepted_at: expect.any(String) },
        filters: [["eq", "id", INVITATION.id], ["is", "accepted_at", null], ["select", "id"]],
      },
    ]);
    expect(api.signInEmail.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(supabaseAdmin.from).mock.invocationCallOrder[2]
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("the client row takes the login's address with its link, the invited one as Better Auth stored it, whatever the row said before", async () => {
    // The coach edited the pending row's address after the invite went out:
    // the invitation, and so the login, keep the one the email went to.
    await accept();
    expect(api.createUser).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ email: "Invited@Example.com" }) }));
    const link = writes.find((write) => write.table === "clients");
    expect(link?.row).toEqual({ user_id: USER.id, email: "invited@example.com" });
  });

  it.each(["invalid", "expired", "used"] as const)("a token whose invitation is %s is refused before anything is made", async (refusal) => {
    vi.mocked(findLiveInvitation).mockResolvedValue({ refusal });
    expect(await accept()).toEqual({ accepted: false, refusal });
    expect(api.createUser).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("an address that already has a login is refused, and nothing is written or deleted (rule 11)", async () => {
    api.createUser.mockRejectedValue(
      new APIError("BAD_REQUEST", { code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", message: "User already exists. Use another email." })
    );
    expect(await accept()).toEqual({ accepted: false, refusal: "account_exists" });
    expect(writes).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("a create-user that throws otherwise deletes only a password-less login it made since the call began, and throws", async () => {
    const before = Date.now();
    const fault = new Error("the password's write failed");
    api.createUser.mockRejectedValue(fault);
    await expect(accept()).rejects.toBe(fault);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as unknown as [string, [string, Date]];
    expect(sql).toMatch(/DELETE FROM better_auth\."user" u\s+WHERE u\.email = lower\(\$1\) AND u\."createdAt" >= \$2/);
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM better_auth\.account a WHERE a\."userId" = u\.id AND a\."providerId" = 'credential'\)/);
    expect(params[0]).toBe(INVITATION.email);
    expect(params[1].getTime()).toBeGreaterThanOrEqual(before);
    expect(writes).toEqual([]);
  });

  it.each([
    ["the profile", () => (answers["profiles.insert"] = { error: { message: "insert failed" } }), 1],
    ["the client's link", () => (answers["clients.update"] = { error: { message: "update failed" } }), 2],
    ["the sign-in", () => api.signInEmail.mockRejectedValue(new Error("sign-in failed")), 2],
    ["the invitation's mark", () => (answers["client_invitations.update"] = { error: { message: "update failed" } }), 3],
  ] as const)("when %s fails, the login is deleted (taking what was written for it) and the error stands", async (_label, breakIt, writesBefore) => {
    breakIt();
    await expect(accept()).rejects.toThrow();
    expect(query).toHaveBeenCalledWith(DELETE_BY_ID, [USER.id]);
    expect(writes).toHaveLength(writesBefore);
  });

  it("a client someone already signs in as is never re-pointed: the login is deleted and the invite reads used", async () => {
    answers["clients.update"] = { data: [] };
    expect(await accept()).toEqual({ accepted: false, refusal: "used" });
    expect(query).toHaveBeenCalledWith(DELETE_BY_ID, [USER.id]);
    expect(api.signInEmail).not.toHaveBeenCalled();
  });

  it("marks the invitation used by its accepted_at alone (migration 215), and only while it is empty", async () => {
    await accept();
    const mark = writes.find((write) => write.table === "client_invitations");
    expect(Object.keys(mark?.row as object)).toEqual(["accepted_at"]);
    expect(new Date((mark?.row as { accepted_at: string }).accepted_at).getTime()).toBeGreaterThan(0);
    expect(mark?.filters).toContainEqual(["is", "accepted_at", null]);
  });

  it("of two accepts racing on one token, the one that finds it marked deletes its login and reads used", async () => {
    answers["client_invitations.update"] = { data: [] };
    expect(await accept()).toEqual({ accepted: false, refusal: "used" });
    expect(query).toHaveBeenCalledWith(DELETE_BY_ID, [USER.id]);
  });

  it("a delete that fails is reported with the login's id, and the first error stands", async () => {
    answers["profiles.insert"] = { error: { message: "insert failed" } };
    query.mockRejectedValue(new Error("pool down"));
    await expect(accept()).rejects.toThrow("Failed to create the profile: insert failed");
    expect(captureApiError).toHaveBeenCalledWith(expect.objectContaining({ message: "pool down" }), expect.objectContaining({ userId: USER.id }));
  });
});

describe("createCoachLogin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubSupabase();
    api.createUser.mockResolvedValue({ user: { id: "coach-user-1", email: "coach@example.com" } } as never);
    api.requestPasswordReset.mockResolvedValue({ status: true } as never);
    query.mockResolvedValue({ rows: [] } as never);
  });

  const create = () => createCoachLogin({ email: "Coach@Example.com", name: "New Coach" });

  it("makes a verified login with no password, the trainer profile and the coach row, then emails the set-password link", async () => {
    expect(await create()).toBe("coach-user-1");
    expect(api.createUser).toHaveBeenCalledWith({ body: { email: "Coach@Example.com", name: "New Coach", data: { emailVerified: true } } });
    expect(writes).toEqual([
      { table: "profiles", verb: "insert", row: { user_id: "coach-user-1", role: "trainer" }, filters: [] },
      { table: "coaches", verb: "insert", row: { user_id: "coach-user-1", name: "New Coach", email: "coach@example.com" }, filters: [] },
    ]);
    expect(api.requestPasswordReset).toHaveBeenCalledWith({ body: { email: "coach@example.com", redirectTo: "/set-password" } });
    expect(query).not.toHaveBeenCalled();
  });

  it("an address that already has a login is refused by Better Auth, and nothing is written or deleted", async () => {
    const taken = new APIError("BAD_REQUEST", { code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" });
    api.createUser.mockRejectedValue(taken);
    await expect(create()).rejects.toBe(taken);
    expect(writes).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    ["the profile", () => (answers["profiles.insert"] = { error: { message: "insert failed" } })],
    ["the coach row", () => (answers["coaches.insert"] = { error: { message: "insert failed" } })],
    ["the set-password link", () => api.requestPasswordReset.mockRejectedValue(new Error("verification write failed"))],
  ] as const)("when %s fails, the login is deleted and the error stands", async (_label, breakIt) => {
    breakIt();
    await expect(create()).rejects.toThrow();
    expect(query).toHaveBeenCalledWith(DELETE_BY_ID, ["coach-user-1"]);
  });
});
