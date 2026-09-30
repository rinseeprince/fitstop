import { describe, it, expect, vi, beforeEach } from "vitest";

const { insert } = vi.hoisted(() => ({ insert: vi.fn() }));
vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn(() => ({ insert })) } }));
vi.mock("@/lib/error-handler", () => ({ captureApiError: vi.fn() }));

import { supabaseAdmin } from "./supabase-admin";
import { captureApiError } from "@/lib/error-handler";
import { recordAuditEvent, recordAuditEvents } from "./audit-log-service";

beforeEach(() => {
  vi.clearAllMocks();
  insert.mockResolvedValue({ error: null });
});

describe("recordAuditEvents", () => {
  it("writes one row per record touched, in ONE statement", async () => {
    await recordAuditEvents([
      { actorId: "coach-1", actorRole: "trainer", action: "habit.create", targetTable: "client_habits", targetId: "h1", clientId: "c1" },
      { actorId: "coach-1", actorRole: "trainer", action: "habit.create", targetTable: "client_habits", targetId: "h2", clientId: "c1" },
    ]);

    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1);
    expect(supabaseAdmin.from).toHaveBeenCalledWith("audit_logs");
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toEqual([
      expect.objectContaining({ action: "habit.create", target_id: "h1", client_id: "c1", actor_role: "trainer", metadata: {}, ip_hash: null }),
      expect.objectContaining({ action: "habit.create", target_id: "h2", client_id: "c1" }),
    ]);
  });

  it("writes nothing for no records", async () => {
    await recordAuditEvents([]);
    expect(insert).not.toHaveBeenCalled();
  });

  it("never throws into the request: a failed write goes to Sentry", async () => {
    insert.mockResolvedValue({ error: { message: "boom" } });
    await expect(recordAuditEvents([{ action: "habit.create", clientId: "c1" }])).resolves.toBeUndefined();
    expect(captureApiError).toHaveBeenCalledWith({ message: "boom" }, { action: "audit-log-write", auditAction: "habit.create" });

    insert.mockRejectedValue(new Error("network"));
    await expect(recordAuditEvents([{ action: "habit.create", clientId: "c1" }])).resolves.toBeUndefined();
    expect(captureApiError).toHaveBeenCalledTimes(2);
  });
});

describe("recordAuditEvent", () => {
  it("writes the one row it is given", async () => {
    await recordAuditEvent({ action: "habit.stop", targetId: "h1", clientId: "c1" });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ action: "habit.stop", target_id: "h1", client_id: "c1" }));
  });
});
