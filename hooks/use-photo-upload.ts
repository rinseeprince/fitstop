import { useState } from "react";
import { validateImageFile, compressImage } from "@/lib/image-utils";

type PhotoType = "front" | "side" | "back";

export const usePhotoUpload = () => {
  const [uploadedPhotos, setUploadedPhotos] = useState<
    Partial<Record<PhotoType, string>>
  >({});
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<
    Partial<Record<PhotoType, number>>
  >({});
  const [errors, setErrors] = useState<Partial<Record<PhotoType, string>>>({});

  const uploadPhoto = async (file: File, type: PhotoType) => {
    setIsUploading(true);
    setErrors((prev) => ({ ...prev, [type]: undefined }));
    setUploadProgress((prev) => ({ ...prev, [type]: 0 }));

    try {
      // Validate file
      const validation = validateImageFile(file);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // Compress image
      setUploadProgress((prev) => ({ ...prev, [type]: 30 }));
      const compressed = await compressImage(file);

      setUploadProgress((prev) => ({ ...prev, [type]: 100 }));

      // Store compressed base64
      setUploadedPhotos((prev) => ({ ...prev, [type]: compressed }));

      return compressed;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to upload photo";
      setErrors((prev) => ({ ...prev, [type]: errorMessage }));
      throw error;
    } finally {
      setIsUploading(false);
      setTimeout(() => {
        setUploadProgress((prev) => ({ ...prev, [type]: 0 }));
      }, 1000);
    }
  };

  const removePhoto = (type: PhotoType) => {
    setUploadedPhotos((prev) => {
      const updated = { ...prev };
      delete updated[type];
      return updated;
    });
    setErrors((prev) => {
      const updated = { ...prev };
      delete updated[type];
      return updated;
    });
  };

  const clearAll = () => {
    setUploadedPhotos({});
    setErrors({});
    setUploadProgress({});
  };

  return {
    uploadedPhotos,
    isUploading,
    uploadProgress,
    errors,
    uploadPhoto,
    removePhoto,
    clearAll,
  };
};
