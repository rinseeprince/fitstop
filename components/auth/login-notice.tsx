"use client";

import { useSearchParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LOGIN_ERROR_PROFILE_UNAVAILABLE } from "@/lib/constants";

/**
 * The login page's notice for a visitor the middleware sent here because
 * their role could not be read (a failed read, or no profile row). The ONLY
 * reader of `?error=`. `useSearchParams` bails static prerendering out to the
 * nearest Suspense boundary, so the page hosts this leaf behind one of its
 * own and stays prerendered (CONVENTIONS §7 → "Gate content, not structure").
 */
export function LoginNotice() {
  const error = useSearchParams().get("error");
  if (error !== LOGIN_ERROR_PROFILE_UNAVAILABLE) return null;
  return (
    <Alert variant="destructive" className="mb-6">
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription>We couldn't load your account. Please try again in a few minutes.</AlertDescription>
    </Alert>
  );
}
