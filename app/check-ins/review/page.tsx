"use client";

import { useState } from "react";
import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckInDetailModal } from "@/components/check-in/check-in-detail-modal";
import { useUnreviewedCheckIns } from "@/hooks/use-check-in-data";
import { ArrowLeft, AlertCircle, CheckCircle } from "lucide-react";
import Link from "next/link";
import { format } from "date-fns";

export default function ReviewCheckInsPage() {
  const { checkIns: unreviewedCheckIns, isLoading, mutate } = useUnreviewedCheckIns();
  const [selectedCheckInId, setSelectedCheckInId] = useState<string | null>(null);
  const selectedIndex = selectedCheckInId
    ? unreviewedCheckIns.findIndex((ci) => ci.id === selectedCheckInId)
    : -1;

  const handleNavigate = (direction: "prev" | "next") => {
    if (!selectedCheckInId) return;

    const currentIndex = unreviewedCheckIns.findIndex((ci) => ci.id === selectedCheckInId);
    if (currentIndex === -1) return;

    const newIndex = direction === "prev" ? currentIndex - 1 : currentIndex + 1;
    if (newIndex >= 0 && newIndex < unreviewedCheckIns.length) {
      setSelectedCheckInId(unreviewedCheckIns[newIndex].id);
    }
  };

  const handleReviewComplete = () => {
    mutate();
    setSelectedCheckInId(null);
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase();
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <Button variant="ghost" asChild>
          <Link href="/">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Link>
        </Button>

        <div>
          <h1 className="text-3xl font-bold">Review Check-Ins</h1>
          <p className="text-muted-foreground mt-2">
            Review and provide feedback on client check-ins
          </p>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col items-center justify-center py-12 space-y-3">
                <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                <p className="text-sm text-muted-foreground">Loading check-ins...</p>
              </div>
            </CardContent>
          </Card>
        ) : unreviewedCheckIns.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col items-center justify-center py-12 space-y-3">
                <CheckCircle className="w-12 h-12 text-success" />
                <div className="text-center space-y-1">
                  <p className="font-medium">All caught up!</p>
                  <p className="text-sm text-muted-foreground">
                    No check-ins pending review at the moment.
                  </p>
                </div>
                <Button asChild>
                  <Link href="/">Back to Dashboard</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-primary" />
                Pending Review ({unreviewedCheckIns.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {unreviewedCheckIns.map((checkIn) => (
                  <div
                    key={checkIn.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => setSelectedCheckInId(checkIn.id)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold">
                        {getInitials(checkIn.clientName || "Client")}
                      </div>
                      <div>
                        <p className="font-medium">{checkIn.clientName || "Unknown Client"}</p>
                        <p className="text-sm text-muted-foreground">
                          Submitted {format(new Date(checkIn.createdAt), "MMM d, yyyy 'at' h:mm a")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary" className="bg-primary/10 text-primary">
                        AI Processed
                      </Badge>
                      <Button size="sm">
                        Review
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <CheckInDetailModal
          checkInId={selectedCheckInId}
          clientId={selectedCheckInId ? unreviewedCheckIns.find((ci) => ci.id === selectedCheckInId)?.clientId : null}
          onClose={handleReviewComplete}
          onNavigate={handleNavigate}
          canNavigatePrev={selectedIndex > 0}
          canNavigateNext={selectedIndex < unreviewedCheckIns.length - 1 && selectedIndex !== -1}
        />
      </div>
    </AppLayout>
  );
}
