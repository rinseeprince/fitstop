import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const READ = { hasAccount: false, invitation: { sentOn: "2026-10-08", expiresOn: "2026-10-15", linkWorks: true } };

const { mutate, boundMutate, swr, fetcher } = vi.hoisted(() => {
  const boundMutate = vi.fn();
  return {
    mutate: vi.fn(),
    // The mutate SWR binds to the key the reader subscribed with.
    boundMutate,
    swr: vi.fn((..._args: unknown[]): Record<string, unknown> => ({
      data: undefined,
      error: undefined,
      isValidating: false,
      mutate: boundMutate,
    })),
    fetcher: vi.fn(),
  };
});
vi.mock("swr", () => ({ __esModule: true, default: (...args: unknown[]) => swr(...args), useSWRConfig: () => ({ mutate }) }));
vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: fetcher }));

import { clientInvitationKey, useClearClientInvitation, useClientInvitation } from "./use-client-invitation";

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("the Invite box's read", () => {
  it("is read under one key, the box's route", () => {
    expect(clientInvitationKey("c1")).toBe("/api/clients/c1/invitation");
  });

  // The repo's coach read: no refetch on focus, three retries a second apart,
  // and a failure logged.
  it("is read with the coach reads' options, only once enabled", () => {
    swr.mockReturnValueOnce({ data: { success: true, data: READ }, error: undefined, isValidating: false, mutate: boundMutate });
    const { result } = renderHook(() => useClientInvitation("c1", true));
    const [key, readFn, options] = swr.mock.calls[0] as [unknown, unknown, Record<string, unknown>];
    expect(key).toBe("/api/clients/c1/invitation");
    expect(readFn).toBe(fetcher);
    expect(options).toMatchObject({ revalidateOnFocus: false, errorRetryCount: 3, errorRetryInterval: 1000 });
    expect(result.current).toMatchObject({ invitation: READ, failed: false, retrying: false });

    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("API request failed");
    (options.onError as (error: unknown) => void)(failure);
    expect(logged).toHaveBeenCalledWith("Failed to load the invitation:", failure);

    renderHook(() => useClientInvitation("c1", false));
    renderHook(() => useClientInvitation("", true));
    expect(swr.mock.calls.slice(1).map((call) => call[0])).toEqual([null, null]);
  });

  it("is pending until it lands: no invitation, and not failed", () => {
    const { result } = renderHook(() => useClientInvitation("c1", true));
    expect(result.current).toMatchObject({ invitation: null, failed: false });
  });

  it("is failed when the read failed and nothing landed, and retries on asking", () => {
    swr.mockReturnValue({ data: undefined, error: new Error("API request failed"), isValidating: true, mutate: boundMutate });
    const { result } = renderHook(() => useClientInvitation("c1", true));
    expect(result.current).toMatchObject({ invitation: null, failed: true, retrying: true });

    result.current.retry();
    expect(boundMutate).toHaveBeenCalledTimes(1);
    expect(boundMutate).toHaveBeenCalledWith();
  });

  it("is cleared, then refetched: the box's sentence is a definite answer", () => {
    void renderHook(() => useClearClientInvitation()).result.current("c1");
    expect(mutate).toHaveBeenCalledWith("/api/clients/c1/invitation", undefined, { revalidate: true });
  });

  // Derived from the browser's tree (every screen, the route handlers aside):
  // a screen that spells the route itself reads or writes it past the key
  // builder, where the clear can't be proved to reach.
  describe("the tree", () => {
    const ROOT = join(__dirname, "..");
    const HOOK = "hooks/use-client-invitation.ts";
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (relative(ROOT, full) !== join("app", "api")) walk(full);
        } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(full);
      }
    };
    ["app", "components", "contexts", "hooks", "lib"].forEach((dir) => walk(join(ROOT, dir)));
    const sources = files.map((file) => ({ rel: relative(ROOT, file), src: readFileSync(file, "utf8") }));
    const others = sources.filter(({ rel }) => rel !== HOOK);
    const OWN_READ = /\buseSWR\s*[<(]/;

    it("spells the box's route in the key builder alone", () => {
      const spelled = sources.filter(({ src }) => /\/invitation[`"']/.test(src)).map(({ rel }) => rel);
      expect(spelled).toEqual([HOOK]);
    });

    it("reads it through useClientInvitation alone, and the box does", () => {
      const ownReaders = sources
        .filter(({ src }) => src.includes("clientInvitationKey(") && OWN_READ.test(src))
        .map(({ rel }) => rel);
      expect(ownReaders).toEqual([HOOK]);
      const readers = others.filter(({ src }) => src.includes("useClientInvitation(")).map(({ rel }) => rel);
      expect(readers).toEqual(["components/clients/invite-client-dialog.tsx"]);
    });

    it("clears it from the box, as it opens, and from activation, which can send an invitation", () => {
      const clearers = others.filter(({ src }) => src.includes("useClearClientInvitation()")).map(({ rel }) => rel);
      expect(clearers.sort()).toEqual(["components/clients/invite-client-dialog.tsx", "components/coach/client-activation-dialog.tsx"]);
    });
  });
});
