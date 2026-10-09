import { supabaseAdmin } from "./supabase-admin";
import type { CONTENT_BUCKET } from "./content-storage-service";
import { chunkIds } from "@/lib/paged-fetch";
import { safeExtensionFromMime } from "@/lib/upload-validation";

/** The progress photos a client's check-ins carry, each under the client's id: `<clientId>/<when>-<pose>.<ext>`. */
export const PROGRESS_PHOTOS_BUCKET = "progress-photos";

/** The app's two buckets: the progress photos, and the coach's content library (services/content-storage-service.ts). */
export type StorageBucket = typeof PROGRESS_PHOTOS_BUCKET | typeof CONTENT_BUCKET;

/** How many objects one removal request names: a bound on each request's work, however many objects an account holds. */
const REMOVE_BATCH = 1000;
/** How many keys one listing page names (the Storage API's flat listing pages on a cursor). */
const LIST_PAGE = 1000;

// Upload a progress photo from base64 (for API route)
export const uploadProgressPhotoFromBase64 = async (
  base64Data: string,
  clientId: string,
  photoType: "front" | "side" | "back",
  mimeType: string = "image/jpeg"
): Promise<string> => {
  const timestamp = Date.now();
  const fileExt = safeExtensionFromMime(mimeType);
  const fileName = `${clientId}/${timestamp}-${photoType}.${fileExt}`;

  // Convert base64 to buffer
  const base64String = base64Data.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64String, "base64");

  const { data, error } = await supabaseAdmin.storage
    .from(PROGRESS_PHOTOS_BUCKET)
    .upload(fileName, buffer, {
      cacheControl: "3600",
      upsert: false,
      contentType: mimeType,
    });

  if (error) {
    throw new Error(`Failed to upload photo: ${error.message}`);
  }

  return data.path;
};

/**
 * Every object's key in one folder of a bucket, its sub-folders' included,
 * for a deleted account (services/account-service.ts): the Storage API's flat
 * listing by prefix, read page by page on its cursor until it says there is no
 * more. Only a key inside the folder is returned, whatever the listing
 * answers. Throws when a page can't be read.
 */
export async function listObjects(bucket: StorageBucket, folder: string): Promise<string[]> {
  const prefix = `${folder}/`;
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const { data, error } = await supabaseAdmin.storage.from(bucket).listV2({ prefix, cursor, limit: LIST_PAGE });
    if (error) throw new Error(`Failed to list ${prefix} in ${bucket}: ${error.message}`);
    keys.push(...data.objects.map((object) => object.name).filter((name) => name.startsWith(prefix) && name.length > prefix.length));
    if (data.hasNext && !data.nextCursor) throw new Error(`The listing of ${prefix} in ${bucket} said there is more and gave no cursor`);
    cursor = data.hasNext ? data.nextCursor : undefined;
  } while (cursor);
  return keys;
}

/**
 * Removes objects from one of the buckets by key, for a deleted account
 * (services/account-service.ts), in batches of REMOVE_BATCH, one after
 * another. A key with no object behind it is no failure: the Storage API
 * removes what exists. Throws on the first batch it refuses, naming the
 * bucket; the batches before it are gone.
 */
export async function removeObjects(bucket: StorageBucket, keys: string[]): Promise<void> {
  for (const batch of chunkIds(keys, REMOVE_BATCH)) {
    const { error } = await supabaseAdmin.storage.from(bucket).remove(batch);
    if (error) throw new Error(`Failed to remove ${batch.length} object(s) from ${bucket}: ${error.message}`);
  }
}
