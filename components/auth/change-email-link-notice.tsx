"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AUTH_ERROR_SENTENCES } from "@/lib/auth-error-messages";
import type { SettingsPage } from "@/lib/constants";

/**
 * Better Auth's answers for a change-of-email link that can no longer be used
 * (its verify-email endpoint at 1.7.7): expired, not one it signed, used
 * already (the address it names has changed), or opened where another login
 * is signed in. It sends the browser to the link's landing with `?error=`.
 */
const LINK_FAILURES = new Set(["TOKEN_EXPIRED", "INVALID_TOKEN", "USER_NOT_FOUND", "INVALID_USER"]);

/**
 * What a Settings page, the coach's or the client's, says when one of change
 * email's two links landed there failed (rules 6 and 17): the sentence every
 * used or expired emailed link says (rule 4), where the page would otherwise
 * show the address as it was and nothing else. The marker is then dropped, so
 * a refresh doesn't say it again; the toast's id keeps a repeated effect from
 * showing it twice. The ONLY reader of its page's `?error=`. `useSearchParams`
 * bails static prerendering out to the nearest Suspense boundary, so each page
 * hosts this leaf behind one of its own (CONVENTIONS §7, "Gate content, not
 * structure").
 */
export function ChangeEmailLinkNotice({ landing }: { landing: SettingsPage }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const failed = LINK_FAILURES.has(searchParams.get("error") ?? "");

  useEffect(() => {
    if (!failed) return;
    toast.error(AUTH_ERROR_SENTENCES.expiredLink, { id: "change-email-link" });
    router.replace(landing);
  }, [failed, landing, router]);

  return null;
}
