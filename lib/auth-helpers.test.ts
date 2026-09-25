import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
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
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/services/supabase-admin";
import {
  getCachedClientId,
  getCachedCoachId,
} from "@/lib/auth-cache";

type MaybeSingleResult = { data: unknown; error: unknown };

/**
 * The session client: `auth.getUser()` resolves to `user`, and its `from` is
 * a spy that must never be called — the session validates the session and
 * reads nothing.
 */
function makeSession(opts: { user: { id: string } | null; userError?: unknown }) {
  const getUser = vi.fn().mockResolvedValue({
    data: { user: opts.user },
    error: opts.userError ?? null,
  });
  const from = vi.fn();
  const supabase = { auth: { getUser }, from };
  vi.mocked(createServerSupabaseClient).mockResolvedValue(supabase as never);
  return { getUser, sessionFrom: from };
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

describe("getAuthenticatedClientId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns null and reads nothing when there is no user", async () => {
    const { getUser, sessionFrom } = makeSession({ user: null });
    const admin = makeAdmin();

    const result = await getAuthenticatedClientId();

    expect(result).toBeNull();
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(getCachedClientId).not.toHaveBeenCalled();
    expect(admin.from).not.toHaveBeenCalled();
    expect(sessionFrom).not.toHaveBeenCalled();
  });

  it("returns null and reads nothing when the session is invalid", async () => {
    makeSession({ user: null, userError: new Error("bad jwt") });
    const admin = makeAdmin();

    expect(await getAuthenticatedClientId()).toBeNull();
    expect(getCachedClientId).not.toHaveBeenCalled();
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("returns the cached client id on the happy path", async () => {
    makeSession({ user: { id: "user-31" } });
    vi.mocked(getCachedClientId).mockResolvedValue("client-52");

    const result = await getAuthenticatedClientId();

    expect(result).toBe("client-52");
    expect(getCachedClientId).toHaveBeenCalledWith("user-31", expect.any(Function));
  });

  it("the cache loader reads the clients row through the server, keyed on the verified user id and active", async () => {
    const { sessionFrom } = makeSession({ user: { id: "user-31" } });
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
    // The session client validated the session and read nothing.
    expect(sessionFrom).not.toHaveBeenCalled();
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

  it("returns null and reads nothing when there is no user", async () => {
    const { getUser, sessionFrom } = makeSession({ user: null });
    const admin = makeAdmin();

    const result = await getAuthenticatedCoachId();

    expect(result).toBeNull();
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(getCachedCoachId).not.toHaveBeenCalled();
    expect(admin.from).not.toHaveBeenCalled();
    expect(sessionFrom).not.toHaveBeenCalled();
  });

  it("returns null and reads nothing when the session is invalid", async () => {
    makeSession({ user: null, userError: new Error("bad jwt") });
    const admin = makeAdmin();

    expect(await getAuthenticatedCoachId()).toBeNull();
    expect(getCachedCoachId).not.toHaveBeenCalled();
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("returns the cached coach id on the happy path", async () => {
    makeSession({ user: { id: "user-64" } });
    vi.mocked(getCachedCoachId).mockResolvedValue("coach-77");

    const result = await getAuthenticatedCoachId();

    expect(result).toBe("coach-77");
    expect(getCachedCoachId).toHaveBeenCalledWith("user-64", expect.any(Function));
  });

  it("the cache loader reads the coaches row through the server, keyed on the verified user id alone", async () => {
    const { sessionFrom } = makeSession({ user: { id: "user-64" } });
    const admin = makeAdmin({ data: { id: "coach-77" }, error: null });
    const captured = captureLoader(getCachedCoachId);

    expect(await getAuthenticatedCoachId()).toBe("coach-77");

    expect(captured.loader).toBeDefined();
    expect(admin.from).toHaveBeenCalledWith("coaches");
    expect(admin.select).toHaveBeenCalledWith("id");
    expect(admin.eq).toHaveBeenCalledWith("user_id", "user-64");
    expect(admin.eq).toHaveBeenCalledTimes(1); // the one filter, and no active one
    expect(admin.maybeSingle).toHaveBeenCalledTimes(1);
    expect(sessionFrom).not.toHaveBeenCalled();
  });

  it("resolves null when the coach row is missing, so nothing is cached", async () => {
    makeSession({ user: { id: "user-96" } });
    makeAdmin({ data: null, error: null });
    captureLoader(getCachedCoachId);

    // A freshly-signed-up coach has no row until /api/auth/me bootstraps one.
    // getCachedAuthValue never caches null, so the next call re-reads the DB.
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
