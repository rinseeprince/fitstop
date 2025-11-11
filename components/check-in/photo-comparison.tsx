"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Image as ImageIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { CheckIn } from "@/types/check-in";
import { formatCheckInDate } from "@/lib/check-in-utils";

type PhotoComparisonProps = {
  checkIns: CheckIn[];
};

export const PhotoComparison = ({ checkIns }: PhotoComparisonProps) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [photoType, setPhotoType] = useState<"front" | "side" | "back">("front");

  // Filter check-ins that have photos
  const checkInsWithPhotos = checkIns.filter(
    (ci) => ci.photoFront || ci.photoSide || ci.photoBack
  );

  if (checkInsWithPhotos.length === 0) {
    return (
      <Card className="p-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
            <ImageIcon className="w-8 h-8 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground">No progress photos yet</p>
          <p className="text-sm text-muted-foreground">
            Photos will appear here when submitted
          </p>
        </div>
      </Card>
    );
  }

  const currentCheckIn = checkInsWithPhotos[currentIndex];
  const currentPhoto =
    photoType === "front"
      ? currentCheckIn.photoFront
      : photoType === "side"
      ? currentCheckIn.photoSide
      : currentCheckIn.photoBack;

  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < checkInsWithPhotos.length - 1;

  return (
    <Card className="p-6 space-y-4">
      {/* Photo Type Selector */}
      <div className="flex items-center justify-center gap-2">
        {["front", "side", "back"].map((type) => (
          <Button
            key={type}
            size="sm"
            variant={photoType === type ? "default" : "outline"}
            onClick={() => setPhotoType(type as "front" | "side" | "back")}
          >
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </Button>
        ))}
      </div>

      {/* Photo Display */}
      <div className="relative aspect-[3/4] bg-muted rounded-lg overflow-hidden">
        {currentPhoto ? (
          <img
            src={currentPhoto}
            alt={`${photoType} view from ${formatCheckInDate(currentCheckIn.createdAt)}`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground text-sm">
              No {photoType} photo for this check-in
            </p>
          </div>
        )}

        {/* Navigation Arrows */}
        {canGoPrev && (
          <Button
            size="icon"
            variant="secondary"
            className="absolute left-2 top-1/2 -translate-y-1/2"
            onClick={() => setCurrentIndex(currentIndex - 1)}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
        )}

        {canGoNext && (
          <Button
            size="icon"
            variant="secondary"
            className="absolute right-2 top-1/2 -translate-y-1/2"
            onClick={() => setCurrentIndex(currentIndex + 1)}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Date and Navigation */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          {formatCheckInDate(currentCheckIn.createdAt)}
        </p>
        <p className="text-xs text-muted-foreground">
          {currentIndex + 1} of {checkInsWithPhotos.length}
        </p>
      </div>

      {/* Metadata */}
      {currentCheckIn.weight && (
        <div className="flex items-center justify-center gap-4 text-sm">
          <span className="text-muted-foreground">
            Weight: <span className="font-medium text-foreground">
              {currentCheckIn.weight} {currentCheckIn.weightUnit || "lbs"}
            </span>
          </span>
          {currentCheckIn.bodyFatPercentage && (
            <span className="text-muted-foreground">
              Body Fat: <span className="font-medium text-foreground">
                {currentCheckIn.bodyFatPercentage}%
              </span>
            </span>
          )}
        </div>
      )}
    </Card>
  );
};
