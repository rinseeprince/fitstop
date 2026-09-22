import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GOAL_UNDO_WINDOW_MS } from "@/lib/constants";
import { readGoalUndo, signGoalUndo } from "./goal-undo-token";

const COPY = {
  goal: { id: "goal-4", client_id: "client-9", target_weight: 73.4, starts_on: "2026-08-17" },
  deadlines: [{ goal_id: "goal-4", effective_on: "2026-08-17", deadline: "2026-11-22" }],
};
const SIGNED_AT = Date.UTC(2026, 8, 22, 14, 5, 0);

describe("the undo of a goal's delete", () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-secret-6d1f";
  });
  afterEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
  });

  it("gives back the copy it signed, for the same client, in time", () => {
    const { token, expiresAt } = signGoalUndo("client-9", COPY, SIGNED_AT);
    expect(expiresAt).toBe(new Date(SIGNED_AT + GOAL_UNDO_WINDOW_MS).toISOString());
    expect(readGoalUndo(token, "client-9", SIGNED_AT + 1_500)).toEqual({ ok: true, copy: COPY });
  });

  it("refuses a copy changed after signing", () => {
    const { token } = signGoalUndo("client-9", COPY, SIGNED_AT);
    const [payload, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
        copy: { ...COPY, goal: { ...COPY.goal, starts_on: "2025-01-06" } },
      })
    ).toString("base64url");
    expect(readGoalUndo(`${forged}.${signature}`, "client-9", SIGNED_AT)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("refuses a signature it did not make", () => {
    const { token } = signGoalUndo("client-9", COPY, SIGNED_AT);
    const [payload] = token.split(".");
    process.env.SUPABASE_SERVICE_ROLE_KEY = "another-secret-83c2";
    const other = signGoalUndo("client-9", COPY, SIGNED_AT).token.split(".")[1];
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-secret-6d1f";
    expect(readGoalUndo(`${payload}.${other}`, "client-9", SIGNED_AT)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("refuses another client's copy", () => {
    const { token } = signGoalUndo("client-9", COPY, SIGNED_AT);
    expect(readGoalUndo(token, "client-12", SIGNED_AT)).toEqual({ ok: false, reason: "foreign" });
  });

  it("refuses a copy once its window has passed", () => {
    const { token } = signGoalUndo("client-9", COPY, SIGNED_AT);
    expect(readGoalUndo(token, "client-9", SIGNED_AT + GOAL_UNDO_WINDOW_MS + 1)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("refuses what is not a token at all", () => {
    expect(readGoalUndo("not-a-token", "client-9", SIGNED_AT)).toEqual({ ok: false, reason: "invalid" });
    expect(readGoalUndo("a.b.c", "client-9", SIGNED_AT)).toEqual({ ok: false, reason: "invalid" });
  });

  it("will not sign without the server's secret", () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => signGoalUndo("client-9", COPY, SIGNED_AT)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});
