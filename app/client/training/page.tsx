"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { SetTracker } from "@/components/client-portal/training/set-tracker";
import { SessionPicker } from "@/components/client-portal/training/session-picker";

export default function ClientTrainingDetailPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const eventId = searchParams.get("eventId");
  const date = searchParams.get("date") ?? undefined;
  const [pickedSessionId, setPickedSessionId] = useState<string | null>(null);

  // Event-keyed: the client tapped a scheduled event card.
  if (eventId) {
    return <SetTracker eventId={eventId} date={date} />;
  }

  // Event-less (rest-day training): pick a session, then log it for `date`.
  if (date) {
    if (pickedSessionId) {
      return (
        <SetTracker
          date={date}
          sessionId={pickedSessionId}
          onChangeSession={() => setPickedSessionId(null)}
        />
      );
    }
    return (
      <SessionPicker
        title="Log a session"
        onSelect={setPickedSessionId}
        onCancel={() => router.back()}
      />
    );
  }

  return (
    <Card>
      <CardContent className="py-12 text-center">
        <p className="font-medium text-[#0c1a1e]">No workout selected</p>
        <p className="mt-2 text-[13px] text-[#5a7d82]">
          Pick a session from your day view to see its details.
        </p>
      </CardContent>
    </Card>
  );
}
