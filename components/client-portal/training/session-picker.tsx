"use client";

import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ClientTrainingPlan } from "@/types/client-training-plan";

type PlanResponse = { success: boolean; data: ClientTrainingPlan | null };

type Props = {
  onSelect: (sessionId: string) => void;
  onCancel: () => void;
  title?: string;
};

/**
 * Mobile-first session picker (Session 5.4). Lists the client's active-plan
 * training sessions (rest entries excluded) for the rest-day-trained and
 * planned-day-swap flows. Reimplemented — does NOT reuse the deleted Daily
 * Pulse picker.
 */
export function SessionPicker({
  onSelect,
  onCancel,
  title = "Pick a session",
}: Props) {
  const { data, isLoading, error } = useSWR<PlanResponse>(
    "/api/client/training-plan",
    swrFetcher,
    { revalidateOnFocus: false },
  );

  const sessions = (data?.data?.sessions ?? []).filter((s) => !s.isRest);

  return (
    <div className="space-y-4" data-testid="session-picker">
      <header className="space-y-1">
        <h1 className="text-[18px] font-semibold text-[#0c1a1e]">{title}</h1>
        <p className="text-[13px] text-[#5a7d82]">
          Choose the session you trained.
        </p>
      </header>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-[6px]" />
          ))}
        </div>
      ) : error || !data?.data ? (
        <p className="text-[13px] text-[#5a7d82]">
          Couldn&apos;t load your plan. Please try again.
        </p>
      ) : sessions.length === 0 ? (
        <p className="text-[13px] text-[#5a7d82]">
          No sessions in your active plan.
        </p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                className="flex w-full items-center justify-between gap-3 rounded-[6px] bg-white px-4 py-3 text-left transition-colors hover:bg-[rgba(13,148,136,0.04)]"
              >
                <span className="font-medium text-[#0c1a1e]">{s.name}</span>
                {s.focus && (
                  <span className="shrink-0 rounded-[6px] bg-[rgba(13,148,136,0.05)] px-2 py-0.5 text-[12px] text-[#0d9488]">
                    {s.focus}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex justify-start">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
