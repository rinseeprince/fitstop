import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

const session = vi.hoisted(() => ({ value: { data: null as unknown, isPending: false } }));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => session.value,
    signIn: { email: vi.fn() },
    signOut: vi.fn(),
  },
}));
vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));
// A full page load jsdom cannot make: recorded instead.
vi.mock("@/lib/load-fresh-page", () => ({ loadFreshPage: vi.fn() }));

import { AuthProvider, useAuth } from "./auth-context";
import { authClient } from "@/lib/auth-client";
import { swrFetcher } from "@/lib/swr-fetcher";
import { AuthRefusal } from "@/lib/auth-error-messages";
import { loadFreshPage } from "@/lib/load-fresh-page";

const ME = { success: true, data: { profile: { role: "trainer" }, coach: { name: "Sam" } } };
const USER = { id: "user-1", email: "coach@example.com", name: "Sam" };

let auth: ReturnType<typeof useAuth>;
function Probe() {
  auth = useAuth();
  return <span data-testid="state">{`${auth.loading}:${auth.user?.id ?? "none"}:${auth.role ?? "no-role"}`}</span>;
}

const mount = () =>
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </SWRConfig>
  );

describe("AuthProvider on Better Auth's session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.value = { data: null, isPending: false };
  });

  it("is loading while the session is first read, and signed out with none", () => {
    session.value = { data: null, isPending: true };
    const { rerender } = mount();
    expect(screen.getByTestId("state")).toHaveTextContent("true:none:no-role");
    session.value = { data: null, isPending: false };
    rerender(
      <SWRConfig value={{ provider: () => new Map() }}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </SWRConfig>
    );
    expect(screen.getByTestId("state")).toHaveTextContent("false:none:no-role");
    expect(swrFetcher).not.toHaveBeenCalled();
  });

  it("reads the profile from /api/auth/me for the session's user", async () => {
    session.value = { data: { user: USER, session: {} }, isPending: false };
    vi.mocked(swrFetcher).mockResolvedValue(ME);
    mount();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("false:user-1:trainer"));
    expect(swrFetcher).toHaveBeenCalledWith("/api/auth/me");
  });

  it("login signs in with Better Auth, primes /me, and returns the role", async () => {
    vi.mocked(authClient.signIn.email).mockResolvedValue({ data: { user: USER }, error: null } as never);
    vi.mocked(swrFetcher).mockResolvedValue(ME);
    mount();
    let role: unknown;
    await act(async () => {
      role = await auth.login("coach@example.com", "a password");
    });
    expect(role).toBe("trainer");
    expect(authClient.signIn.email).toHaveBeenCalledWith({ email: "coach@example.com", password: "a password" });
  });

  it("a refused login throws Better Auth's status and code, for the page to word", async () => {
    vi.mocked(authClient.signIn.email).mockResolvedValue({
      data: null,
      error: { status: 401, code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" },
    } as never);
    mount();
    await expect(auth.login("coach@example.com", "wrong")).rejects.toMatchObject({
      name: "AuthRefusal",
      status: 401,
      code: "INVALID_EMAIL_OR_PASSWORD",
    });
    await expect(auth.login("coach@example.com", "wrong")).rejects.toBeInstanceOf(AuthRefusal);
    expect(swrFetcher).not.toHaveBeenCalled();
  });

  it("logout signs this device out with Better Auth (D14), asking nothing of the others", async () => {
    vi.mocked(authClient.signOut).mockResolvedValue({ data: { success: true }, error: null } as never);
    mount();
    await act(async () => {
      await auth.logout();
    });
    expect(authClient.signOut).toHaveBeenCalledTimes(1);
    expect(authClient.signOut).toHaveBeenCalledWith();
  });

  it("logout then loads the login page fresh, which says it worked: nothing of the account stays in the browser", async () => {
    vi.mocked(loadFreshPage).mockClear();
    vi.mocked(authClient.signOut).mockResolvedValue({ data: { success: true }, error: null } as never);
    mount();
    await act(async () => {
      await auth.logout();
    });
    expect(loadFreshPage).toHaveBeenCalledTimes(1);
    expect(loadFreshPage).toHaveBeenCalledWith("/login?logged-out=1");
    expect(vi.mocked(authClient.signOut).mock.invocationCallOrder.at(-1)).toBeLessThan(vi.mocked(loadFreshPage).mock.invocationCallOrder[0]);
  });

  it("a refused logout throws Better Auth's refusal for the button to word, and goes nowhere", async () => {
    vi.mocked(loadFreshPage).mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(authClient.signOut).mockResolvedValue({ data: null, error: { status: 403, code: "INVALID_ORIGIN" } } as never);
    mount();
    await expect(auth.logout()).rejects.toBeInstanceOf(AuthRefusal);
    expect(loadFreshPage).not.toHaveBeenCalled();
  });
});
