import { supabaseAdmin } from "./supabase-admin";

const CONTENT_BUCKET = "content-library";

export const uploadContentFile = async (
  file: File,
  coachId: string,
  contentId: string,
): Promise<string> => {
  const fileName = `${coachId}/${contentId}/${Date.now()}-${file.name}`;

  const { data, error } = await supabaseAdmin.storage
    .from(CONTENT_BUCKET)
    .upload(fileName, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (error) {
    throw new Error("Failed to upload file");
  }

  return data.path;
};

export const getContentFileSignedUrl = async (
  filePath: string,
  expiresIn: number = 3600,
): Promise<string> => {
  const { data, error } = await supabaseAdmin.storage
    .from(CONTENT_BUCKET)
    .createSignedUrl(filePath, expiresIn);

  if (error) {
    throw new Error("Failed to get signed URL");
  }

  return data.signedUrl;
};

export const deleteContentFile = async (filePath: string): Promise<void> => {
  const { error } = await supabaseAdmin.storage
    .from(CONTENT_BUCKET)
    .remove([filePath]);

  if (error) {
    throw new Error("Failed to delete file");
  }
};
