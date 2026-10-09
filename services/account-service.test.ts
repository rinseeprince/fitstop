import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
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

import { isAddressHeldElsewhere, moveLoginEmail, MovedLoginUnfinishedError } from "./account-service";
import { auth } from "@/lib/auth";
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
    for (const verb of ["select", "eq"]) {
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
