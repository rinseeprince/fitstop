"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type {
  CheckInFormEditorConfig,
  CheckInFormTemplate,
  CheckInQuestion,
} from "@/types/check-in";

/**
 * The COACH's reads behind the customisable check-in form (#4, C6b).
 *
 * Not to be confused with `hooks/use-check-in-form.ts`, which is the CLIENT
 * wizard's localStorage draft hook. Different audience, different job; the
 * names are close because both describe "the check-in form".
 *
 * Every read exports its key builder AND a matching area invalidator, and no
 * call site builds one of these keys inline (CONVENTIONS §7).
 *
 * **All three are gated on `enabled`.** They back a sheet that is closed most
 * of the time, and an unconditional read would cost every visit to the
 * Check-ins tab three requests nobody opened (the `useClientGoalHistory`
 * precedent).
 *
 * One live overlap worth knowing rather than rediscovering: the queue
 * invalidator `useInvalidateCheckInsQueue` matches the `/api/check-ins` prefix,
 * so it also matches the questions and templates keys below. Harmless — those
 * two are only mounted while the editor sheet is open, and the sheet and the
 * review detail are mutually exclusive surfaces — but it means a Send would
 * revalidate them if that ever stopped being true.
 */

// Stable empty arrays — a fresh [] per unresolved render re-runs every
// consumer memo keyed on them (the NO_OVERDUE_CLIENTS reasoning).
const NO_QUESTIONS: CheckInQuestion[] = [];
const NO_TEMPLATES: CheckInFormTemplate[] = [];

const SWR_OPTS = {
  revalidateOnFocus: false,
  errorRetryCount: 3,
  errorRetryInterval: 1000,
};

type FormResponse = { success: boolean; data: CheckInFormEditorConfig };
type QuestionsResponse = { success: boolean; data: { questions: CheckInQuestion[] } };
type TemplatesResponse = { success: boolean; data: { templates: CheckInFormTemplate[] } };

/** The AREA for one client's form, not one endpoint (CONVENTIONS §7). */
export const clientCheckInFormKey = (clientId: string) =>
  `/api/clients/${clientId}/check-in-form`;

export const checkInQuestionsKey = "/api/check-ins/questions";
export const checkInFormTemplatesKey = "/api/check-ins/forms";

/**
 * A client's form as the COACH sees it — disabled questions included, so a
 * row that is off renders as off rather than vanishing.
 */
export function useClientCheckInForm(clientId: string, enabled: boolean) {
  const { data, error, isLoading } = useSWR<FormResponse>(
    enabled && clientId ? clientCheckInFormKey(clientId) : null,
    swrFetcher,
    SWR_OPTS
  );

  return { form: data?.data ?? null, isLoading, isError: !!error };
}

export function useInvalidateClientCheckInForm() {
  const { mutate } = useSWRConfig();
  return useCallback(
    (clientId: string) =>
      mutate(
        (key) =>
          typeof key === "string" && key.startsWith(clientCheckInFormKey(clientId))
      ),
    [mutate]
  );
}

/** The coach's question bank, newest first, archived rows already excluded. */
export function useCheckInQuestions(enabled: boolean) {
  const { data, error, isLoading } = useSWR<QuestionsResponse>(
    enabled ? checkInQuestionsKey : null,
    swrFetcher,
    SWR_OPTS
  );

  return { questions: data?.data.questions ?? NO_QUESTIONS, isLoading, isError: !!error };
}

export function useInvalidateCheckInQuestions() {
  const { mutate } = useSWRConfig();
  return useCallback(
    () =>
      mutate(
        (key) => typeof key === "string" && key.startsWith(checkInQuestionsKey)
      ),
    [mutate]
  );
}

/** The coach's saved form templates, each carrying its own fields + questions. */
export function useCheckInFormTemplates(enabled: boolean) {
  const { data, error, isLoading } = useSWR<TemplatesResponse>(
    enabled ? checkInFormTemplatesKey : null,
    swrFetcher,
    SWR_OPTS
  );

  return { templates: data?.data.templates ?? NO_TEMPLATES, isLoading, isError: !!error };
}

export function useInvalidateCheckInFormTemplates() {
  const { mutate } = useSWRConfig();
  return useCallback(
    () =>
      mutate(
        (key) => typeof key === "string" && key.startsWith(checkInFormTemplatesKey)
      ),
    [mutate]
  );
}
