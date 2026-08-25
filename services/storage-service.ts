import { supabaseAdmin } from "./supabase-admin";
import { safeExtensionFromMime } from "@/lib/upload-validation";

const BUCKET_NAME = "progress-photos";

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
    .from(BUCKET_NAME)
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
