"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LOGGED_OUT_PARAM, LOGIN_ERROR_PROFILE_UNAVAILABLE } from "@/lib/constants";

/**
 * The login page's notices: the message for a visitor the proxy sent here
 * because their role could not be read (a failed read, or no profile row),
 * and "Logged out successfully" for one Log out sent here. The ONLY reader of
 * the login page's `?error=` and `?logged-out=`. `useSearchParams` bails
 * static prerendering out to the nearest Suspense boundary, so the page hosts
 * this leaf behind one of its own and stays prerendered (CONVENTIONS §7 →
 * "Gate content, not structure").
 */
export function LoginNotice() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const loggedOut = searchParams.has(LOGGED_OUT_PARAM);

  // Log out loads this page fresh (contexts/auth-context.tsx), which wipes
  // any toast shown before it, so the toast is shown here. The marker is then
  // dropped, so a refresh or a return to this page doesn't say it again; the
  // toast's id keeps a repeated effect from showing it twice.
  useEffect(() => {
    if (!loggedOut) return;
    toast.success("Logged out successfully", { id: LOGGED_OUT_PARAM, description: "See you next time!" });
    router.replace("/login");
  }, [loggedOut, router]);

  if (searchParams.get("error") !== LOGIN_ERROR_PROFILE_UNAVAILABLE) return null;
  return (
    <Alert variant="destructive" className="mb-6">
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription>We couldn't load your account. Please try again in a few minutes.</AlertDescription>
    </Alert>
  );
}
