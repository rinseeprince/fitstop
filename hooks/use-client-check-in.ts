"use client";

import { useState, useEffect } from "react";
import { useSWRConfig } from "swr";
import { useAuth } from "@/contexts/auth-context";
import { checkInHabitWeekKey } from "@/hooks/use-check-in-habit-week";
import { useReadAfterHabitEntries } from "@/hooks/use-client-habit-entries";
import type {
  CheckInFormData,
  CheckInClientInfo,
  CheckInContextResponse,
} from "@/types/check-in";

const fetchUrl = (url: string) => fetch(url);

/**
 * The route's payload, typed off the shared contract rather than a private
 * copy of it. This hook used to declare a THIRD spelling of the same shape
 * (the domain type and the route each had one), which is how a key can exist
 * on the wire with no type describing it. `clientInfo` is narrowed to required
 * because every success response sets it; everything else stays as the
 * contract has it.
 */
type CheckInContextData = CheckInContextResponse & {
  clientInfo: CheckInClientInfo;
};

export function useClientCheckIn() {
  const { user } = useAuth();
  const { mutate } = useSWRConfig();
  // The context carries the period's habit week, the Habits step's first
  // answer: read once every habit entry on its way has its answer, it holds
  // them all, and nothing can land in the step's week between its read and
  // its arrival — the wizard, and with it the step, waits for the context.
  const fetchAfterHabitEntries = useReadAfterHabitEntries(fetchUrl);
  const [contextData, setContextData] = useState<CheckInContextData | null>(null);
  const [isLoadingContext, setIsLoadingContext] = useState(true);
  const [contextError, setContextError] = useState<string | null>(null);
  const [nextDueDate, setNextDueDate] = useState<string | null>(null);

  // Fetch check-in context on mount
  useEffect(() => {
    if (!user) {
      setIsLoadingContext(false);
      return;
    }

    const fetchContext = async () => {
      try {
        setIsLoadingContext(true);
        setContextError(null);
        setNextDueDate(null);

        const response = await fetchAfterHabitEntries("/api/client/check-in-context");
        const result = await response.json();

        if (!response.ok || !result.success) {
          // Surface the gating error codes so the page can show a friendly
          // message. Two: `not_due` covers both "your turn has not come round"
          // and "you have already checked in", which became one state when the
          // due date started advancing on submit; `unscheduled` is the client
          // whose coach has set no date at all.
          if (result.error === "not_due" || result.error === "unscheduled") {
            setContextError(result.error);
            if (typeof result.nextDueDate === "string") {
              setNextDueDate(result.nextDueDate);
            }
            return;
          }
          throw new Error(result.error || "Failed to fetch check-in context");
        }

        setContextData(result.data);
        // The Habits step's first answer is this visit's week: a week cached
        // from an earlier visit in this tab may be older than the context.
        const habitWeek = (result.data as CheckInContextData).habitWeek;
        if (habitWeek) {
          void mutate(checkInHabitWeekKey(habitWeek.start, habitWeek.end), { success: true, data: habitWeek }, { revalidate: false });
        }
      } catch (error) {
        setContextError(error instanceof Error ? error.message : "Failed to load context");
      } finally {
        setIsLoadingContext(false);
      }
    };

    void fetchContext();
  }, [user, mutate, fetchAfterHabitEntries]);

  // Submit check-in function
  const submitCheckIn = async (formData: CheckInFormData): Promise<{ success: boolean; error?: string }> => {
    if (!user) {
      return { success: false, error: "User not authenticated" };
    }

    try {
      const response = await fetch("/api/client/check-ins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        // The route answers with SubmitCheckInResponse.errorMessage (the first
        // validation issue); `error` is the shape of the other client routes.
        return {
          success: false,
          error: result.errorMessage || result.error || "Failed to submit check-in",
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to submit check-in",
      };
    }
  };

  return {
    contextData,
    isLoadingContext,
    contextError,
    nextDueDate,
    submitCheckIn,
  };
}