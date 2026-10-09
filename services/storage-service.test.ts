import { describe, it, expect, vi, beforeEach } from "vitest";

const storage = vi.hoisted(() => ({ from: vi.fn(), remove: vi.fn(), listV2: vi.fn() }));
vi.mock("./supabase-admin", () => ({ supabaseAdmin: { storage: { from: storage.from } } }));

import { listObjects, PROGRESS_PHOTOS_BUCKET, removeObjects } from "./storage-service";
import { CONTENT_BUCKET } from "./content-storage-service";

/**
 * listObjects: every object in one folder of a bucket, sub-folders included,
 * for a deleted account: the Storage API's flat listing, page by page.
 */
describe("listObjects", () => {
  beforeEach(() => {
    storage.from.mockReset().mockReturnValue({ listV2: storage.listV2 });
    storage.listV2.mockReset();
  });

  const page = (names: string[], nextCursor?: string) => ({
    data: { hasNext: nextCursor !== undefined, nextCursor, folders: [], objects: names.map((name) => ({ name })) },
    error: null,
  });

  it("lists the folder by its prefix with the slash, page after page on the cursor, every key once", async () => {
    storage.listV2.mockResolvedValueOnce(page(["coach-1/item-1/a.pdf", "coach-1/item-2/b.pdf"], "c1")).mockResolvedValueOnce(page(["coach-1/orphan/c.pdf"]));
    expect(await listObjects(CONTENT_BUCKET, "coach-1")).toEqual(["coach-1/item-1/a.pdf", "coach-1/item-2/b.pdf", "coach-1/orphan/c.pdf"]);
    expect(storage.from).toHaveBeenCalledWith("content-library");
    expect(storage.listV2.mock.calls).toEqual([
      [{ prefix: "coach-1/", cursor: undefined, limit: 1000 }],
      [{ prefix: "coach-1/", cursor: "c1", limit: 1000 }],
    ]);
  });

  it("returns only keys inside the folder, whatever the listing answers", async () => {
    storage.listV2.mockResolvedValueOnce(page(["client-a/1-front.jpg", "client-ab/2-front.jpg", "client-b/3-front.jpg", "client-a/"]));
    expect(await listObjects(PROGRESS_PHOTOS_BUCKET, "client-a")).toEqual(["client-a/1-front.jpg"]);
  });

  it("throws when a page can't be read, naming the folder and the bucket", async () => {
    storage.listV2.mockResolvedValueOnce({ data: null, error: { message: "Service unavailable" } });
    await expect(listObjects(PROGRESS_PHOTOS_BUCKET, "client-a")).rejects.toThrow("Failed to list client-a/ in progress-photos: Service unavailable");
  });

  it("throws rather than loop when the listing says there is more and gives no cursor", async () => {
    storage.listV2.mockResolvedValueOnce({ data: { hasNext: true, folders: [], objects: [] }, error: null });
    await expect(listObjects(PROGRESS_PHOTOS_BUCKET, "client-a")).rejects.toThrow("said there is more and gave no cursor");
    expect(storage.listV2).toHaveBeenCalledTimes(1);
  });
});

/**
 * removeObjects: a deleted account's objects (services/account-service.ts),
 * removed from a bucket by key, a bounded batch per request.
 */
describe("removeObjects", () => {
  beforeEach(() => {
    storage.from.mockReset().mockReturnValue({ remove: storage.remove });
    storage.remove.mockReset().mockResolvedValue({ data: [], error: null });
  });

  const keys = (n: number) => Array.from({ length: n }, (_, i) => `client-a/${i}-front.jpg`);

  it("removes the keys from the bucket it is named", async () => {
    await removeObjects(PROGRESS_PHOTOS_BUCKET, keys(2));
    expect(storage.from).toHaveBeenCalledWith("progress-photos");
    expect(storage.remove).toHaveBeenCalledWith(keys(2));
    await removeObjects(CONTENT_BUCKET, ["coach-1/item-1/1-plan.pdf"]);
    expect(storage.from).toHaveBeenLastCalledWith("content-library");
  });

  it("names at most a thousand keys a request, one request after another, every key once", async () => {
    await removeObjects(PROGRESS_PHOTOS_BUCKET, keys(2001));
    expect(storage.remove.mock.calls.map(([batch]) => (batch as string[]).length)).toEqual([1000, 1000, 1]);
    expect(storage.remove.mock.calls.flatMap(([batch]) => batch as string[])).toEqual(keys(2001));
  });

  it("asks nothing for no keys", async () => {
    await removeObjects(PROGRESS_PHOTOS_BUCKET, []);
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("throws on the first batch the Storage API refuses, naming the bucket, and asks for no batch after it", async () => {
    storage.remove.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: null, error: { message: "Service unavailable" } });
    await expect(removeObjects(PROGRESS_PHOTOS_BUCKET, keys(2500))).rejects.toThrow(
      "Failed to remove 1000 object(s) from progress-photos: Service unavailable"
    );
    expect(storage.remove).toHaveBeenCalledTimes(2);
  });
});
