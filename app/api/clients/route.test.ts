import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({ apiRateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/csrf-protection", () => ({ requireCSRFProtection: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedCoachId: vi.fn() }));
vi.mock("@/services/audit-log-service", () => ({ recordAuditEvent: vi.fn().mockResolvedValue(undefined) }));
// The factory defines the error class, so the route (importing from the mocked
// module) and this test throw and instanceof-check the SAME class object.
vi.mock("@/services/client-service", () => {
  class CreateClientInputError extends Error {}
  return { CreateClientInputError, createClient: vi.fn(), getClientsForCoach: vi.fn() };
});

import { POST } from "./route";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { createClient, CreateClientInputError } from "@/services/client-service";

const BODY = {
  name: "Jo Park",
  email: "jo.park@fixture.local",
  setupMode: "manual",
  currentWeight: 94.2,
  goal: { type: "lose_weight", targetWeight: 86.7, deadline: "2026-09-21" },
};

function post(body: unknown) {
  return new NextRequest("http://localhost:3000/api/clients", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/clients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue("coach-4");
  });

  // The service refuses a value the request carries — a first goal's deadline
  // before the new client's today — before any row is written, so the answer
  // is the coach's to correct, with the sentence that says what.
  it("answers a value the create refuses with a 400 and its sentence", async () => {
    vi.mocked(createClient).mockRejectedValue(
      new CreateClientInputError("The goal's deadline can't be before 22 Sept.")
    );

    const response = await POST(post(BODY));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "The goal's deadline can't be before 22 Sept." });
  });

  it("keeps a duplicate email a 409 and anything else a 500", async () => {
    vi.mocked(createClient).mockRejectedValueOnce(new Error("A client with this email already exists"));
    expect((await POST(post(BODY))).status).toBe(409);

    vi.mocked(createClient).mockRejectedValueOnce(new Error("Failed to create client"));
    const failed = await POST(post(BODY));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "Failed to create client" });
  });
});
