import { StrictMode, useEffect, useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { SWRConfig, type Cache } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import { useVisitRead } from "./use-visit-read";

// Real SWR: what this pins is SWR's own cache and dedupe behaviour across two
// visits, which a mocked hook cannot show.

vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

const URL = "/api/client/daily-logs/2026-09-17/wellness";

type Seen = { data: string | undefined; isLoading: boolean };

function Reader({ url, seen }: { url: string | null; seen: Seen[] }) {
  const { data, error, isLoading } = useVisitRead<string>(url);
  seen.push({ data, isLoading });
  return <p data-testid="read">{error ? "failed" : (data ?? "loading")}</p>;
}

// One SWR cache for the whole test, kept across the screen closing and opening.
function tree(cache: Cache, open: boolean, seen: Seen[] = []) {
  return (
    <SWRConfig value={{ provider: () => cache }}>
      {open ? <Reader url={URL} seen={seen} /> : null}
    </SWRConfig>
  );
}

const keysFor = (cache: Cache, url: string) =>
  [...cache.keys()].filter((key) => key.includes(url));

describe("useVisitRead", () => {
  let cache: Cache;

  beforeEach(() => {
    cache = new Map() as unknown as Cache;
    vi.mocked(swrFetcher).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads again when the screen reopens inside the dedupe window, never showing the last visit's copy", async () => {
    vi.mocked(swrFetcher)
      .mockResolvedValueOnce("first visit")
      .mockResolvedValueOnce("second visit");

    const { rerender } = render(tree(cache, true));
    expect(await screen.findByText("first visit")).toBeInTheDocument();

    rerender(tree(cache, false));
    rerender(tree(cache, true));
    // The reopened screen's first render has nothing to show but loading.
    expect(screen.getByTestId("read")).toHaveTextContent("loading");
    expect(await screen.findByText("second visit")).toBeInTheDocument();
    expect(swrFetcher).toHaveBeenCalledTimes(2);
    expect(swrFetcher).toHaveBeenNthCalledWith(2, URL);
  });

  it("drops a loaded visit's entry when the screen closes", async () => {
    vi.mocked(swrFetcher).mockResolvedValue("loaded");

    const { rerender } = render(tree(cache, true));
    expect(await screen.findByText("loaded")).toBeInTheDocument();
    expect(keysFor(cache, URL)).toHaveLength(1);

    rerender(tree(cache, false));
    expect(keysFor(cache, URL)).toHaveLength(0);
  });

  it("stays loading through React's development double-mount, then shows what that load returns", async () => {
    let land!: (value: string) => void;
    const load = new Promise<string>((resolve) => (land = resolve));
    vi.mocked(swrFetcher).mockImplementation(() => load);
    const seen: Seen[] = [];

    // A re-render after the double-mount, while the load is still in flight.
    function Rerendering() {
      const [, bump] = useState(0);
      useEffect(() => bump((n) => n + 1), []);
      return <Reader url={URL} seen={seen} />;
    }

    render(
      <StrictMode>
        <SWRConfig value={{ provider: () => cache }}>
          <Rerendering />
        </SWRConfig>
      </StrictMode>,
    );
    await act(async () => {});
    expect(seen.length).toBeGreaterThan(2);
    expect(seen.every((render) => render.isLoading)).toBe(true);

    await act(async () => {
      land("loaded");
      await load;
    });
    expect(screen.getByTestId("read")).toHaveTextContent("loaded");
    expect(swrFetcher).toHaveBeenCalledTimes(1);
  });

  it("reads nothing without a url", () => {
    render(
      <SWRConfig value={{ provider: () => cache }}>
        <Reader url={null} seen={[]} />
      </SWRConfig>,
    );
    expect(screen.getByTestId("read")).toHaveTextContent("loading");
    expect(swrFetcher).not.toHaveBeenCalled();
    expect([...cache.keys()]).toHaveLength(0);
  });
});
