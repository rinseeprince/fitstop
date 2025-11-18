"use client";

import { useRef } from "react";
import { Camera, Upload, X, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePhotoUpload } from "@/hooks/use-photo-upload";
import type { ProgressPhotos } from "@/types/check-in";

type StepPhotosProps = {
  data: Partial<ProgressPhotos>;
  onChange: (data: Partial<ProgressPhotos>) => void;
};

type PhotoSlot = {
  type: "front" | "side" | "back";
  label: string;
  description: string;
};

const photoSlots: PhotoSlot[] = [
  {
    type: "front",
    label: "Front",
    description: "Face camera, arms at sides",
  },
  {
    type: "side",
    label: "Side",
    description: "Profile view, stand straight",
  },
  {
    type: "back",
    label: "Back",
    description: "Face away, arms at sides",
  },
];

export const StepPhotos = ({ data, onChange }: StepPhotosProps) => {
  const { uploadPhoto, isUploading, uploadProgress, errors } = usePhotoUpload();
  const fileInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});

  const handleFileSelect = async (
    e: React.ChangeEvent<HTMLInputElement>,
    type: "front" | "side" | "back"
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const base64 = await uploadPhoto(file, type);
      onChange({
        ...data,
        [`photo${type.charAt(0).toUpperCase() + type.slice(1)}`]: base64,
      } as any);
    } catch (error) {
      console.error("Upload failed:", error);
    }
  };

  const handleRemovePhoto = (type: "front" | "side" | "back") => {
    onChange({
      ...data,
      [`photo${type.charAt(0).toUpperCase() + type.slice(1)}`]: undefined,
    } as any);
  };

  const getPhotoUrl = (type: "front" | "side" | "back") => {
    const key = `photo${type.charAt(0).toUpperCase() + type.slice(1)}` as keyof ProgressPhotos;
    return data[key];
  };

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-semibold mb-1">Progress Photos</h3>
        <p className="text-sm text-muted-foreground">
          Optional but highly recommended for tracking visual progress
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {photoSlots.map(({ type, label, description }) => {
          const photoUrl = getPhotoUrl(type);
          const progress = uploadProgress[type];
          const error = errors[type];

          return (
            <div key={type} className="space-y-2">
              <div className="text-center">
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>

              <div className="relative aspect-[3/4] rounded-lg border-2 border-dashed border-border bg-muted/30 overflow-hidden group">
                {photoUrl ? (
                  <>
                    <img
                      src={photoUrl}
                      alt={`${label} view`}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => fileInputRefs.current[type]?.click()}
                      >
                        <Camera className="w-4 h-4 mr-1" />
                        Retake
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => handleRemovePhoto(type)}
                      >
                        <X className="w-4 h-4 mr-1" />
                        Remove
                      </Button>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRefs.current[type]?.click()}
                    className="w-full h-full flex flex-col items-center justify-center gap-2 hover:bg-muted/50 transition-colors"
                  >
                    {progress && progress > 0 ? (
                      <div className="flex flex-col items-center gap-2">
                        <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                        <span className="text-sm text-muted-foreground">
                          {progress}%
                        </span>
                      </div>
                    ) : (
                      <>
                        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                          <Upload className="w-6 h-6 text-primary" />
                        </div>
                        <p className="text-sm font-medium">Upload Photo</p>
                        <p className="text-xs text-muted-foreground px-4 text-center">
                          Tap to select or take photo
                        </p>
                      </>
                    )}
                  </button>
                )}

                {error && (
                  <div className="absolute bottom-0 inset-x-0 bg-destructive/90 text-destructive-foreground text-xs p-2 text-center">
                    {error}
                  </div>
                )}

                <input
                  ref={(el) => { fileInputRefs.current[type] = el; }}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => handleFileSelect(e, type)}
                  className="hidden"
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="glass-card p-4 space-y-2">
        <div className="flex items-start gap-2">
          <ImageIcon className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-1">Photo Tips:</p>
            <ul className="space-y-1 text-xs">
              <li>• Wear similar clothing each time for consistency</li>
              <li>• Use good lighting (natural light works best)</li>
              <li>• Stand in the same spot for accurate comparisons</li>
              <li>• Relax and stand naturally</li>
            </ul>
          </div>
        </div>
      </div>

      <Button
        type="button"
        variant="ghost"
        className="w-full"
        onClick={() => onChange(data)}
      >
        Skip Photos This Week
      </Button>
    </div>
  );
};
