import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  readSessionUserId: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

vi.mock("@/services/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("@/lib/auth-cache", () => ({
  getCachedClientId: vi.fn(),
  getCachedCoachId: vi.fn(),
}));

import {
  getAuthenticatedClientId,
  getAuthenticatedCoachId,
} from "./auth-helpers";
import { readSessionUserId } from "@/lib/auth";
import { headers } from "next/headers";
import { supabaseAdmin } from "@/services/supabase-admin";
import {
  getCachedClientId,
  getCachedCoachId,
} from "@/lib/auth-cache";

type MaybeSingleResult = { data: unknown; error: unknown };

/** The headers of the incoming request, as next/headers hands them to a route that passes none. */
const INCOMING = new Headers({ cookie: "better-auth.session_token=incoming" });

/**
 * The session Better Auth reads from the request: `user` is whose it is,
 * null for none; `userError` makes the read itself fail (a database fault).
 */
function makeSession(opts: { user: { id: string } | null; userError?: unknown }) {
  vi.mocked(headers).mockResolvedValue(INCOMING as never);
  if (opts.userError) vi.mocked(readSessionUserId).mockRejectedValue(opts.userError);
  else vi.mocked(readSessionUserId).mockResolvedValue(opts.user?.id ?? null);
}

/**
 * The service role's query chain (.from().select().eq()[.eq()].maybeSingle())
 * resolving to `result`, with every spy exposed so the loaders can assert
 * exactly which table, columns and filters were used.
 */
function makeAdmin(result: MaybeSingleResult = { data: null, error: null }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eqReturn: { eq?: unknown; maybeSingle: typeof maybeSingle } = { maybeSingle };
  const eq = vi.fn().mockReturnValue(eqReturn);
  eqReturn.eq = eq;
  const select = vi.fn().mockReturnValue({ eq });
  vi.mocked(supabaseAdmin.from).mockReturnValue({ select } as never);
  return { from: vi.mocked(supabaseAdmin.from), select, eq, maybeSingle };
}

/** Runs the loader the implementation hands the cache, and returns what it loaded. */
function captureLoader(cache: typeof getCachedClientId | typeof getCachedCoachId) {
  const captured: { loader?: () => Promise<string | null> } = {};
  vi.mocked(cache).mockImplementation(async (_userId, loader) => {
    captured.loader = loader;
    return loader();
  });
  return captured;
}

const routeRequest = (init: Record<string, string>) =>
  new NextRequest("http://localhost:3000/api/client/me", { headers: init });

describe.each([
  ["getAuthenticatedClientId", getAuthenticatedClientId, getCachedClientId, "client"],
  ["getAuthenticatedCoachId", getAuthenticatedCoachId, getCachedCoachId, "coach"],
] as const)("%s reads Better Auth's session", (_name, getAuthenticated, cache, role) => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("from the request's own headers when the route passes it, a bearer token's included", async () => {
    makeSession({ user: { id: "user-1" } });
    vi.mocked(cache).mockResolvedValue("row-1");

    const withBearer = routeRequest({ authorization: "Bearer app-token" });
    expect(await getAuthenticated(withBearer)).toBe("row-1");
    expect(readSessionUserId).toHaveBeenCalledWith(withBearer.headers);
    expect(vi.mocked(readSessionUserId).mock.calls[0][0].get("authorization")).toBe("Bearer app-token");
    expect(headers).not.toHaveBeenCalled();
  });

  it("from the incoming request's headers when the route passes none", async () => {
    makeSession({ user: { id: "user-1" } });
    vi.mocked(cache).mockResolvedValue("row-1");

    expect(await getAuthenticated()).toBe("row-1");
    expect(readSessionUserId).toHaveBeenCalledWith(INCOMING);
  });

  it("no session: null, the reason logged with the route, and the cache never consulted", async () => {
    makeSession({ user: null });
    const admin = makeAdmin();

    expect(await getAuthenticated(routeRequest({}))).toBeNull();
    expect(cache).not.toHaveBeenCalled();
    expect(admin.from).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      "auth_failure",
      expect.objectContaining({ role, reason: "missing_session", route: "/api/client/me" })
    );
  });

  it("a session that cannot be read: null, logged as an invalid session, nothing read", async () => {
    makeSession({ user: null, userError: new Error("database unreachable") });
    const admin = makeAdmin();

    expect(await getAuthenticated()).toBeNull();
    expect(cache).not.toHaveBeenCalled();
    expect(admin.from).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      "auth_failure",
      expect.objectContaining({ role, reason: "invalid_session" })
    );
  });
});

describe("getAuthenticatedClientId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns the cached client id on the happy path", async () => {
    makeSession({ user: { id: "user-31" } });
    vi.mocked(getCachedClientId).mockResolvedValue("client-52");

    const result = await getAuthenticatedClientId();

    expect(result).toBe("client-52");
    expect(getCachedClientId).toHaveBeenCalledWith("user-31", expect.any(Function));
  });

  it("the cache loader reads the clients row through the server, keyed on the session's user id and active", async () => {
    makeSession({ user: { id: "user-31" } });
    const admin = makeAdmin({ data: { id: "client-52" }, error: null });
    const captured = captureLoader(getCachedClientId);

    expect(await getAuthenticatedClientId()).toBe("client-52");

    expect(captured.loader).toBeDefined();
    expect(admin.from).toHaveBeenCalledWith("clients");
    expect(admin.select).toHaveBeenCalledWith("id");
    expect(admin.eq).toHaveBeenCalledWith("user_id", "user-31");
    expect(admin.eq).toHaveBeenCalledWith("active", true);
    expect(admin.eq).toHaveBeenCalledTimes(2); // the two filters, and no third
    expect(admin.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("resolves null for a login with no active client row, so nothing is cached", async () => {
    makeSession({ user: { id: "user-85" } });
    makeAdmin({ data: null, error: null });
    captureLoader(getCachedClientId);

    expect(await getAuthenticatedClientId()).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      "auth_failure",
      expect.objectContaining({ role: "client", reason: "client_profile_not_found" })
    );
  });

  it("resolves null and logs when the read fails", async () => {
    makeSession({ user: { id: "user-31" } });
    makeAdmin({ data: null, error: { message: "connection refused" } });
    captureLoader(getCachedClientId);

    expect(await getAuthenticatedClientId()).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      "auth_failure",
      expect.objectContaining({ role: "client", reason: "db_error" })
    );
  });
});

describe("getAuthenticatedCoachId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns the cached coach id on the happy path", async () => {
    makeSession({ user: { id: "user-64" } });
    vi.mocked(getCachedCoachId).mockResolvedValue("coach-77");

    const result = await getAuthenticatedCoachId();

    expect(result).toBe("coach-77");
    expect(getCachedCoachId).toHaveBeenCalledWith("user-64", expect.any(Function));
  });

  it("the cache loader reads the coaches row through the server, keyed on the session's user id alone", async () => {
    makeSession({ user: { id: "user-64" } });
    const admin = makeAdmin({ data: { id: "coach-77" }, error: null });
    const captured = captureLoader(getCachedCoachId);

    expect(await getAuthenticatedCoachId()).toBe("coach-77");

    expect(captured.loader).toBeDefined();
    expect(admin.from).toHaveBeenCalledWith("coaches");
    expect(admin.select).toHaveBeenCalledWith("id");
    expect(admin.eq).toHaveBeenCalledWith("user_id", "user-64");
    expect(admin.eq).toHaveBeenCalledTimes(1); // the one filter, and no active one
    expect(admin.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("resolves null when the coach row is missing, so nothing is cached", async () => {
    makeSession({ user: { id: "user-96" } });
    makeAdmin({ data: null, error: null });
    captureLoader(getCachedCoachId);

    // A client's login has no coach row. getCachedAuthValue never caches
    // null, so the next call re-reads the DB.
    expect(await getAuthenticatedCoachId()).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      "auth_failure",
      expect.objectContaining({ role: "coach", reason: "coach_profile_not_found" })
    );
  });

  it("resolves null and logs when the read fails", async () => {
    makeSession({ user: { id: "user-64" } });
    makeAdmin({ data: null, error: { message: "connection refused" } });
    captureLoader(getCachedCoachId);

    expect(await getAuthenticatedCoachId()).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      "auth_failure",
      expect.objectContaining({ role: "coach", reason: "db_error" })
    );
  });
});
