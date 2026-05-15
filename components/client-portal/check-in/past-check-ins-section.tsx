"use client";

import useSWR from "swr";
import { ClipboardCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { CheckIn } from "@/types/check-in";
import { CheckInCard } from "./check-in-card";

export const PAST_CHECK_INS_SWR_KEY = "/api/client/check-ins?limit=10";

type PastCheckInsResponse = { success: boolean; data: CheckIn[] };

export function PastCheckInsSection() {
  const { data, error, isLoading } = useSWR<PastCheckInsResponse>(
    PAST_CHECK_INS_SWR_KEY,
    swrFetcher,
    { revalidateOnFocus: false, errorRetryCount: 3, errorRetryInterval: 1000 },
  );

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Past check-ins</h2>
      <PastCheckInsBody data={data} error={error} isLoading={isLoading} />
    </div>
  );
}

function PastCheckInsBody({
  data,
  error,
  isLoading,
}: {
  data: PastCheckInsResponse | undefined;
  error: unknown;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Couldn&apos;t load past check-ins.
        </CardContent>
      </Card>
    );
  }

  const checkIns = data?.data ?? [];

  if (checkIns.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <ClipboardCheck className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-medium">No check-ins yet</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Your submitted check-ins will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {checkIns.map((checkIn) => (
        <CheckInCard key={checkIn.id} checkIn={checkIn} />
      ))}
    </div>
  );
}
