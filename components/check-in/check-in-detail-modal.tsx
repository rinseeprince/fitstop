"use client";

import { useEffect, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckInDataDisplay } from "./check-in-data-display";
import { AISummaryCard } from "./ai-summary-card";
import { CheckInResponseEditor } from "./check-in-response-editor";
import type { CheckIn } from "@/types/check-in";

type CheckInDetailModalProps = {
  checkInId: string | null;
  clientId: string;
  onClose: () => void;
  onNavigate?: (direction: "prev" | "next") => void;
  canNavigatePrev?: boolean;
  canNavigateNext?: boolean;
};

type CheckInWithClient = {
  checkIn: CheckIn;
  client: {
    id: string;
    name: string;
    email?: string;
    avatar_url?: string;
  } | null;
};

export const CheckInDetailModal = ({
  checkInId,
  clientId,
  onClose,
  onNavigate,
  canNavigatePrev = false,
  canNavigateNext = false,
}: CheckInDetailModalProps) => {
  const [data, setData] = useState<CheckInWithClient | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!checkInId) {
      setData(null);
      return;
    }

    const fetchCheckIn = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/check-in/${checkInId}`);
        if (response.ok) {
          const result = await response.json();
          setData(result);
        }
      } catch (error) {
        console.error("Error fetching check-in:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchCheckIn();
  }, [checkInId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!checkInId) return;

      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft" && canNavigatePrev && onNavigate) {
        onNavigate("prev");
      } else if (e.key === "ArrowRight" && canNavigateNext && onNavigate) {
        onNavigate("next");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [checkInId, canNavigatePrev, canNavigateNext, onNavigate, onClose]);

  const handleResponseSent = () => {
    // Refresh data after response sent
    if (checkInId) {
      fetch(`/api/check-in/${checkInId}`)
        .then((res) => res.json())
        .then((result) => setData(result));
    }
  };

  if (!checkInId) return null;

  return (
    <Dialog open={!!checkInId} onOpenChange={onClose}>
      <DialogContent className="max-w-[90vw] sm:max-w-[90vw] md:max-w-[85vw] lg:max-w-[80vw] w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>
              {data?.client?.name || "Loading..."} - Check-In Review
            </DialogTitle>
            <div className="flex items-center gap-2">
              {onNavigate && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onNavigate("prev")}
                    disabled={!canNavigatePrev}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onNavigate("next")}
                    disabled={!canNavigateNext}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </>
              )}
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
        ) : data ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <h3 className="text-lg font-semibold mb-4">Check-In Data</h3>
                <CheckInDataDisplay checkIn={data.checkIn} />
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-4">AI Analysis</h3>
                <AISummaryCard
                  checkInId={checkInId}
                  onUpdate={handleResponseSent}
                />
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-4">Your Response</h3>
              <CheckInResponseEditor
                checkInId={checkInId}
                clientName={data.client?.name || "Client"}
                onSent={handleResponseSent}
              />
            </div>
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            Failed to load check-in data
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
