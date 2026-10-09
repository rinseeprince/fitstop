// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchLinkMetadata } from "./content-metadata-service";
import { PRODUCT_NAME } from "@/lib/constants";

describe("the link-preview fetcher", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("names itself for the product in its User-Agent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("<title>A video</title>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchLinkMetadata("https://www.youtube.com/watch?v=abc");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=abc",
      expect.objectContaining({ headers: { "User-Agent": `${PRODUCT_NAME}-MetadataBot/1.0` } })
    );
  });
});
