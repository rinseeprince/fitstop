// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: {}, authPool: {} }));
vi.mock("@/services/supabase-admin", () => ({ supabaseAdmin: {} }));
vi.mock("@/services/email-service", () => ({ sendInvitationEmail: vi.fn(), generateInviteToken: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ authRateLimit: vi.fn() }));
vi.mock("@/lib/csrf-protection", () => ({ requireCSRFProtection: vi.fn() }));
vi.mock("@/lib/error-handler", () => ({ captureApiError: vi.fn() }));
vi.mock("@/services/login-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/login-service")>()),
  acceptClientInvitation: vi.fn(),
}));

import { POST } from "./route";
import { acceptClientInvitation } from "@/services/login-service";
import { authRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { captureApiError } from "@/lib/error-handler";

const TOKEN = "ab".repeat(32);
const PASSWORD = "a strong password";
const COOKIES = [
  "better-auth.session_token=abc.sig; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax",
  "better-auth.session_data=; Max-Age=0; Path=/",
];

const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost:3000/api/invitations/accept", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );

describe("POST /api/invitations/accept", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(null);
    vi.mocked(acceptClientInvitation).mockResolvedValue({ accepted: true, userId: "user-1", clientId: "client-1", setCookies: COOKIES });
  });

  it("accepts the token and the password, and forwards every cookie Better Auth set", async () => {
    const response = await post({ token: TOKEN, password: PASSWORD });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(response.headers.getSetCookie()).toEqual(COOKIES);
    expect(acceptClientInvitation).toHaveBeenCalledWith({ token: TOKEN, password: PASSWORD });
  });

  it("a body naming a user is accepted as its token and password alone: the extra keys never reach the service", async () => {
    await post({ token: TOKEN, password: PASSWORD, userId: "someone-else", clientId: "client-9", email: "x@example.com" });
    expect(acceptClientInvitation).toHaveBeenCalledWith({ token: TOKEN, password: PASSWORD });
  });

  it.each([
    ["a token that is not 64 hex characters", { token: "not-a-token", password: PASSWORD }, "Invalid invitation link"],
    ["no token", { password: PASSWORD }, "Invalid invitation link"],
    ["a password under 8 characters", { token: TOKEN, password: "short" }, "Choose a password of 8 to 128 characters."],
    ["a password over 128 characters", { token: TOKEN, password: "x".repeat(129) }, "Choose a password of 8 to 128 characters."],
    ["no body at all", "not json", "Invalid request"],
  ])("refuses %s with a 400, and calls nothing", async (_label, body, error) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error });
    expect(acceptClientInvitation).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid", 400, "Invalid invitation link"],
    ["expired", 400, "This invitation has expired"],
    ["used", 400, "This invitation has already been used"],
    ["account_exists", 409, "This email already has an account. Sign in instead."],
  ] as const)("a refusal (%s) answers %i with its sentence, and no cookie", async (refusal, status, error) => {
    vi.mocked(acceptClientInvitation).mockResolvedValue({ accepted: false, refusal });
    const response = await post({ token: TOKEN, password: PASSWORD });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ success: false, error });
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("a failure answers 500 with a plain sentence and reaches Sentry; nothing raw is shown", async () => {
    const fault = new Error('duplicate key value violates unique constraint "profiles_user_id_key"');
    vi.mocked(acceptClientInvitation).mockRejectedValue(fault);
    const response = await post({ token: TOKEN, password: PASSWORD });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: "Couldn't create your account. Try again." });
    expect(captureApiError).toHaveBeenCalledWith(fault, { route: "POST /api/invitations/accept" });
  });

  it("the rate limit runs first and CSRF second; either refusing stops everything", async () => {
    vi.mocked(authRateLimit).mockResolvedValue(NextResponse.json({ error: "Too many requests" }, { status: 429 }));
    expect((await post({ token: TOKEN, password: PASSWORD })).status).toBe(429);
    expect(requireCSRFProtection).not.toHaveBeenCalled();

    vi.mocked(authRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(new Response(null, { status: 403 }));
    expect((await post({ token: TOKEN, password: PASSWORD })).status).toBe(403);
    expect(acceptClientInvitation).not.toHaveBeenCalled();
  });
});
