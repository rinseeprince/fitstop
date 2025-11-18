import { supabaseAdmin } from "./supabase-admin";

const BUCKET_NAME = "progress-photos";

// Upload a progress photo to Supabase Storage
export const uploadProgressPhoto = async (
  file: File,
  clientId: string,
  photoType: "front" | "side" | "back"
): Promise<string> => {
  const timestamp = Date.now();
  const fileExt = file.name.split(".").pop();
  const fileName = `${clientId}/${timestamp}-${photoType}.${fileExt}`;

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .upload(fileName, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (error) {
    throw new Error(`Failed to upload photo: ${error.message}`);
  }

  return data.path;
};

// Upload a progress photo from base64 (for API route)
export const uploadProgressPhotoFromBase64 = async (
  base64Data: string,
  clientId: string,
  photoType: "front" | "side" | "back",
  mimeType: string = "image/jpeg"
): Promise<string> => {
  const timestamp = Date.now();
  const fileExt = mimeType.split("/")[1] || "jpg";
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

// Get a signed URL for a photo (valid for 1 hour)
export const getPhotoSignedUrl = async (
  filePath: string,
  expiresIn: number = 3600
): Promise<string> => {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .createSignedUrl(filePath, expiresIn);

  if (error) {
    throw new Error(`Failed to get signed URL: ${error.message}`);
  }

  return data.signedUrl;
};

// Get multiple signed URLs
export const getMultipleSignedUrls = async (
  filePaths: string[],
  expiresIn: number = 3600
): Promise<Record<string, string>> => {
  const urls: Record<string, string> = {};

  await Promise.all(
    filePaths.map(async (path) => {
      try {
        const signedUrl = await getPhotoSignedUrl(path, expiresIn);
        urls[path] = signedUrl;
      } catch (error) {
        console.error(`Failed to get signed URL for ${path}:`, error);
      }
    })
  );

  return urls;
};

// Delete a photo
export const deletePhoto = async (filePath: string): Promise<void> => {
  const { error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .remove([filePath]);

  if (error) {
    throw new Error(`Failed to delete photo: ${error.message}`);
  }
};

// Delete multiple photos
export const deleteMultiplePhotos = async (
  filePaths: string[]
): Promise<void> => {
  const { error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .remove(filePaths);

  if (error) {
    throw new Error(`Failed to delete photos: ${error.message}`);
  }
};

// Get public URL for a photo (if bucket is public)
export const getPhotoPublicUrl = (filePath: string): string => {
  const { data } = supabaseAdmin.storage
    .from(BUCKET_NAME)
    .getPublicUrl(filePath);

  return data.publicUrl;
};

// List all photos for a client
export const listClientPhotos = async (
  clientId: string
): Promise<string[]> => {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .list(clientId);

  if (error) {
    throw new Error(`Failed to list photos: ${error.message}`);
  }

  return data.map((file) => `${clientId}/${file.name}`);
};
