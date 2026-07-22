import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("@/lib/auth-cache", () => ({
  getCachedClientId: vi.fn(),
  getCachedClientWithCheckInDay: vi.fn(),
}));

import {
  getAuthenticatedClientId,
  getAuthenticatedClientWithCheckInDay,
} from "./auth-helpers";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  getCachedClientId,
  getCachedClientWithCheckInDay,
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

describe("getAuthenticatedClientWithCheckInDay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null and never touches the cache when there is no user", async () => {
    const { supabase } = makeSupabase({ user: null });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(supabase as never);

    const result = await getAuthenticatedClientWithCheckInDay();

    expect(result).toBeNull();
    expect(getCachedClientWithCheckInDay).not.toHaveBeenCalled();
  });

  it("returns the cached object on the happy path", async () => {
    const { supabase } = makeSupabase({ user: { id: "user-9" } });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(supabase as never);
    vi.mocked(getCachedClientWithCheckInDay).mockResolvedValue({
      clientId: "client-9",
      checkInDay: "monday",
    });

    const result = await getAuthenticatedClientWithCheckInDay();

    expect(result).toEqual({ clientId: "client-9", checkInDay: "monday" });
    expect(getCachedClientWithCheckInDay).toHaveBeenCalledWith(
      "user-9",
      expect.any(Function),
    );
  });

  it("the cache loader selects id + expected_check_in_day", async () => {
    const { supabase, from, select, eq, maybeSingle } = makeSupabase({
      user: { id: "user-9" },
      result: { data: { id: "client-9", expected_check_in_day: "friday" }, error: null },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(supabase as never);
    let captured:
      | (() => Promise<{ clientId: string; checkInDay: string | null } | null>)
      | undefined;
    vi.mocked(getCachedClientWithCheckInDay).mockImplementation(
      async (_userId, loader) => {
        captured = loader;
        return loader();
      },
    );

    await getAuthenticatedClientWithCheckInDay();

    expect(captured).toBeDefined();
    const loaded = await captured!();
    expect(loaded).toEqual({ clientId: "client-9", checkInDay: "friday" });
    expect(from).toHaveBeenCalledWith("clients");
    expect(select).toHaveBeenCalledWith("id, expected_check_in_day");
    expect(eq).toHaveBeenCalledWith("user_id", "user-9");
    expect(eq).toHaveBeenCalledWith("active", true);
    expect(maybeSingle).toHaveBeenCalled();
  });
});
