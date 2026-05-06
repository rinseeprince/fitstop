"use client";

import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { SetTracker } from "@/components/client-portal/training/set-tracker";

export default function ClientTrainingDetailPage() {
  const searchParams = useSearchParams();
  const eventId = searchParams.get("eventId");
  const date = searchParams.get("date") ?? undefined;

  if (!eventId) {
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

  return <SetTracker eventId={eventId} date={date} />;
}
