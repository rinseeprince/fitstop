import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({ apiRateLimit: vi.fn() }));
vi.mock("@/lib/csrf-protection", () => ({ requireCSRFProtection: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedCoachId: vi.fn() }));
vi.mock("@/services/client-service", () => ({
  getClientById: vi.fn(),
  updateClient: vi.fn(),
  deleteClient: vi.fn(),
  CLIENT_OWNS_EMAIL: "This client changes their own email.",
  ClientEmailLockedError: class ClientEmailLockedError extends Error {
    constructor() {
      super("This client changes their own email.");
    }
  },
}));
vi.mock("@/services/measurements-service", () => ({
  ReadingRemovalUnavailableError: class ReadingRemovalUnavailableError extends Error {},
}));

import { PATCH } from "./route";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { ClientEmailLockedError, getClientById, updateClient } from "@/services/client-service";
import type { Client } from "@/types/check-in";

/**
 * PATCH /api/clients/[id]'s lock on a client's address (D38, rule 18): a
 * client with an account changes the address they sign in with from their
 * own Settings, so the coach's write may carry it back but not change it. The
 * service is stubbed; services/client-service.test.ts proves it writes an
 * address only to a client with no login.
 */
const COACH_ID = "coach-1";
const CLIENT_ID = "client-1";

const pending: Client = {
  id: CLIENT_ID,
  coachId: COACH_ID,
  name: "Alex Doe",
  email: "alex@example.com",
  active: true,
  timezone: "UTC",
  unitPreference: "metric",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as Client;
const withAccount: Client = { ...pending, userId: "user-1" };

const patch = (body: unknown) =>
  PATCH(
    new NextRequest(`http://localhost:3000/api/clients/${CLIENT_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: CLIENT_ID }) }
  );

describe("PATCH /api/clients/[id]: the coach can't change the address of a client with an account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(null);
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(COACH_ID);
    vi.mocked(updateClient).mockImplementation((_id, data) => Promise.resolve({ ...withAccount, ...data } as Client));
  });

  it("refuses another address with 409, and writes nothing", async () => {
    vi.mocked(getClientById).mockResolvedValue(withAccount);
    const res = await patch({ name: "Alex Doe-Smith", email: "someone.else@example.com" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "This client changes their own email." });
    expect(updateClient).not.toHaveBeenCalled();
  });

  it.each([
    ["the same address", withAccount, "alex@example.com"],
    ["the same address in another case, which the schema lower-cases", withAccount, "Alex@Example.COM"],
    ["the address a row stored in another case", { ...withAccount, email: "Alex@Example.com" }, "alex@example.com"],
  ])("lets %s through with the rest of the save, writing no address", async (_label, owned, email) => {
    vi.mocked(getClientById).mockResolvedValue(owned);
    const res = await patch({ name: "Alex Doe-Smith", email });
    expect(res.status).toBe(200);
    expect(updateClient).toHaveBeenCalledWith(CLIENT_ID, { name: "Alex Doe-Smith" }, COACH_ID);
  });

  it("lets a save that carries no address through", async () => {
    vi.mocked(getClientById).mockResolvedValue(withAccount);
    const res = await patch({ phone: "555" });
    expect(res.status).toBe(200);
    expect(updateClient).toHaveBeenCalledWith(CLIENT_ID, { phone: "555" }, COACH_ID);
  });

  it("leaves a pending client's address the coach's to change", async () => {
    vi.mocked(getClientById).mockResolvedValue(pending);
    const res = await patch({ email: "alex.new@example.com" });
    expect(res.status).toBe(200);
    expect(updateClient).toHaveBeenCalledWith(CLIENT_ID, { email: "alex.new@example.com" }, COACH_ID);
  });

  it("writes no address for a pending client's save that carries theirs unchanged, so it holds if they accept meanwhile", async () => {
    vi.mocked(getClientById).mockResolvedValue(pending);
    const res = await patch({ name: "Alex Doe-Smith", email: "alex@example.com" });
    expect(res.status).toBe(200);
    expect(updateClient).toHaveBeenCalledWith(CLIENT_ID, { name: "Alex Doe-Smith" }, COACH_ID);
  });

  it("answers 409 when the pending client accepted their invite between the read and the write, which the service refuses", async () => {
    vi.mocked(getClientById).mockResolvedValue(pending);
    vi.mocked(updateClient).mockRejectedValue(new ClientEmailLockedError());
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await patch({ email: "alex.new@example.com" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "This client changes their own email." });
  });

  it("checks against the client the ownership check loaded, reading it once: another coach's client is a 404 first", async () => {
    vi.mocked(getClientById).mockResolvedValue({ ...withAccount, coachId: "coach-2" });
    const res = await patch({ email: "someone.else@example.com" });
    expect(res.status).toBe(404);
    expect(getClientById).toHaveBeenCalledTimes(1);
    expect(updateClient).not.toHaveBeenCalled();
  });

  it("an address that is not one is the schema's 400, before the lock", async () => {
    vi.mocked(getClientById).mockResolvedValue(withAccount);
    const res = await patch({ email: "not-an-address" });
    expect(res.status).toBe(400);
    expect(updateClient).not.toHaveBeenCalled();
  });
});
