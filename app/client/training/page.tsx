"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { SetTracker } from "@/components/client-portal/training/set-tracker";
import { SessionPicker } from "@/components/client-portal/training/session-picker";
import { useApplyClientLayout } from "@/hooks/use-client-training-data";
import { resolveSessionPick } from "@/lib/session-pick";
import type { ClientTrainingWeekSession } from "@/types/client-training-week";

export default function ClientTrainingDetailPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const eventId = searchParams.get("eventId");
  const date = searchParams.get("date") ?? undefined;
  const [pickError, setPickError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const applyLayout = useApplyClientLayout();

  // A pick from the rest-day picker (lib/session-pick): the session MOVES here
  // and opens — one date per workout — or, if it is already on this day, just
  // opens. The picker only offers sessions that can still be done, so every
  // other resolution is a refusal shown in its own words.
  const handlePick = useCallback(
    async (pick: ClientTrainingWeekSession) => {
      if (!date) return;
      const resolution = resolveSessionPick(pick, { kind: "rest-day", date });
      setPickError(null);
      switch (resolution.action) {
        case "open":
          router.replace(`/client/training?eventId=${resolution.eventId}&date=${date}`);
          return;
        case "move":
        case "swap": {
          setBusy(true);
          try {
            await applyLayout(resolution.moves);
            router.replace(`/client/training?eventId=${resolution.openEventId}&date=${date}`);
          } catch (error) {
            setPickError(error instanceof Error ? error.message : "Failed to move session");
          } finally {
            setBusy(false);
          }
          return;
        }
        case "unavailable":
          setPickError(resolution.reason);
          return;
        case "alt":
          // Not a rest-day outcome; the kernel only returns it for a prescribed day.
          setPickError("Pick a session that is still to be done");
      }
    },
    [applyLayout, date, router],
  );

  // Event-keyed: the client tapped a scheduled event card.
  if (eventId) {
    return <SetTracker eventId={eventId} date={date} />;
  }

  // Event-less (a rest day): pick a session from this week; it moves here.
  if (date) {
    return (
      <SessionPicker
        title="Log a session"
        date={date}
        onPick={handlePick}
        onCancel={() => router.back()}
        error={pickError}
        busy={busy}
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
