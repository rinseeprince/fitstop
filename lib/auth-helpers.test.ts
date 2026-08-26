import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
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
import {
  getCachedClientId,
  getCachedCoachId,
} from "@/lib/auth-cache";

type MaybeSingleResult = { data: unknown; error: unknown };

/**
 * Builds a supabase stub whose clients query chain
 * (.from().select().eq().maybeSingle()) resolves to `result`, and whose
 * auth.getUser() resolves to `user`. Exposes the spies so loaders can assert
 * exactly which columns/filters were used.
 */
function makeSupabase(opts: {
  user: { id: string } | null;
  userError?: unknown;
  result?: MaybeSingleResult;
}) {
  const maybeSingle = vi.fn().mockResolvedValue(opts.result ?? { data: null, error: null });
  // eq is chainable (the loaders now chain .eq("user_id", …).eq("active", true)).
  const eqReturn: { eq?: unknown; maybeSingle: typeof maybeSingle } = { maybeSingle };
  const eq = vi.fn().mockReturnValue(eqReturn);
  eqReturn.eq = eq;
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  const getUser = vi.fn().mockResolvedValue({
    data: { user: opts.user },
    error: opts.userError ?? null,
  });

  const supabase = { auth: { getUser }, from };
  return { supabase, from, select, eq, maybeSingle, getUser };
}

describe("getAuthenticatedClientId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null and never touches the cache when there is no user", async () => {
    const { supabase, getUser } = makeSupabase({ user: null });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(supabase as never);

    const result = await getAuthenticatedClientId();

    expect(result).toBeNull();
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(getCachedClientId).not.toHaveBeenCalled();
  });

  it("returns the cached client id on the happy path", async () => {
    const { supabase } = makeSupabase({ user: { id: "user-9" } });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(supabase as never);
    vi.mocked(getCachedClientId).mockResolvedValue("client-9");

    const result = await getAuthenticatedClientId();

    expect(result).toBe("client-9");
    expect(getCachedClientId).toHaveBeenCalledWith("user-9", expect.any(Function));
  });

  it("the cache loader runs the clients lookup keyed on user_id", async () => {
    const { supabase, from, select, eq, maybeSingle } = makeSupabase({
      user: { id: "user-9" },
      result: { data: { id: "client-9" }, error: null },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(supabase as never);
    // Capture and invoke the loader the implementation passes to the cache.
    let captured: (() => Promise<string | null>) | undefined;
    vi.mocked(getCachedClientId).mockImplementation(async (_userId, loader) => {
      captured = loader;
      return loader();
    });

    await getAuthenticatedClientId();

    expect(captured).toBeDefined();
    const loaded = await captured!();
    expect(loaded).toBe("client-9");
    expect(from).toHaveBeenCalledWith("clients");
    expect(select).toHaveBeenCalledWith("id");
    expect(eq).toHaveBeenCalledWith("user_id", "user-9");
    expect(eq).toHaveBeenCalledWith("active", true);
    expect(maybeSingle).toHaveBeenCalled();
  });
});

describe("getAuthenticatedCoachId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null and never touches the cache when there is no user", async () => {
    const { supabase, getUser } = makeSupabase({ user: null });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(supabase as never);

    const result = await getAuthenticatedCoachId();

    expect(result).toBeNull();
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(getCachedCoachId).not.toHaveBeenCalled();
  });

  it("returns null and never touches the cache when the session is invalid", async () => {
    const { supabase } = makeSupabase({
      user: null,
      userError: new Error("bad jwt"),
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(supabase as never);

    const result = await getAuthenticatedCoachId();

    expect(result).toBeNull();
    expect(getCachedCoachId).not.toHaveBeenCalled();
  });

  it("returns the cached coach id on the happy path", async () => {
    const { supabase } = makeSupabase({ user: { id: "user-9" } });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(supabase as never);
    vi.mocked(getCachedCoachId).mockResolvedValue("coach-9");

    const result = await getAuthenticatedCoachId();

    expect(result).toBe("coach-9");
    expect(getCachedCoachId).toHaveBeenCalledWith("user-9", expect.any(Function));
  });

  it("the cache loader selects the coach id scoped to user_id", async () => {
    const { supabase, from, select, eq, maybeSingle } = makeSupabase({
      user: { id: "user-9" },
      result: { data: { id: "coach-9" }, error: null },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(supabase as never);
    let captured: (() => Promise<string | null>) | undefined;
    vi.mocked(getCachedCoachId).mockImplementation(async (_userId, loader) => {
      captured = loader;
      return loader();
    });

    await getAuthenticatedCoachId();

    expect(captured).toBeDefined();
    expect(await captured!()).toBe("coach-9");
    expect(from).toHaveBeenCalledWith("coaches");
    expect(select).toHaveBeenCalledWith("id");
    expect(eq).toHaveBeenCalledWith("user_id", "user-9");
    expect(maybeSingle).toHaveBeenCalled();
  });

  it("resolves null when the coach row is missing, so nothing is cached", async () => {
    const { supabase } = makeSupabase({
      user: { id: "user-new" },
      result: { data: null, error: null },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(supabase as never);
    vi.mocked(getCachedCoachId).mockImplementation(async (_userId, loader) => loader());

    // A freshly-signed-up coach has no row until /api/auth/me bootstraps one.
    // getCachedAuthValue never caches null, so the next call re-reads the DB.
    expect(await getAuthenticatedCoachId()).toBeNull();
  });
});
