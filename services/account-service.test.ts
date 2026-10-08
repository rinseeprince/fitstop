import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));

import { isCoachLogin, mirrorEmailToCoachRow } from "./account-service";
import { supabaseAdmin } from "@/services/supabase-admin";

/**
 * services/account-service.ts's reads and writes on the app's rows: each
 * statement is recorded with its table, its verb and every filter, and
 * answers what the test gives it.
 */
type Statement = { table: string; calls: unknown[][] };
let statements: Statement[] = [];
let answer: { data?: unknown; error?: { message: string } | null } = {};

function stubSupabase() {
  statements = [];
  answer = {};
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
    const statement: Statement = { table, calls: [] };
    statements.push(statement);
    const builder: Record<string, unknown> = {
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null, ...answer }).then(resolve, reject),
    };
    for (const verb of ["select", "update", "eq", "neq", "maybeSingle"]) {
      builder[verb] = (...args: unknown[]) => (statement.calls.push([verb, ...args]), builder);
    }
    return builder;
  }) as never);
}

describe("isCoachLogin: the role the path that made the login set (D9)", () => {
  beforeEach(stubSupabase);

  it("reads the login's profile by its id, once", async () => {
    answer = { data: { role: "trainer" } };
    await expect(isCoachLogin("user-1")).resolves.toBe(true);
    expect(statements).toEqual([
      { table: "profiles", calls: [["select", "role"], ["eq", "user_id", "user-1"], ["maybeSingle"]] },
    ]);
  });

  it.each([
    ["a client", { data: { role: "client" } }],
    ["a login with no profile", { data: null }],
  ])("is false for %s", async (_label, given) => {
    answer = given;
    await expect(isCoachLogin("user-1")).resolves.toBe(false);
  });

  it("throws when the role cannot be read, so a fault refuses rather than guesses", async () => {
    answer = { error: { message: "connection reset" } };
    await expect(isCoachLogin("user-1")).rejects.toThrow("Failed to read the login's role: connection reset");
  });
});

describe("mirrorEmailToCoachRow: the coach row's email follows the login's address (D18)", () => {
  beforeEach(stubSupabase);

  it("writes the login's address to its coach row alone, in one statement, unless the row already says it", async () => {
    await mirrorEmailToCoachRow({ id: "user-1", email: "new@example.com" });
    expect(statements).toEqual([
      {
        table: "coaches",
        calls: [
          ["update", { email: "new@example.com" }],
          ["eq", "user_id", "user-1"],
          ["neq", "email", "new@example.com"],
        ],
      },
    ]);
  });

  it("throws when the write fails", async () => {
    answer = { error: { message: "timeout" } };
    await expect(mirrorEmailToCoachRow({ id: "user-1", email: "new@example.com" })).rejects.toThrow(
      "Failed to copy the login's email to the coach row: timeout"
    );
  });
});
