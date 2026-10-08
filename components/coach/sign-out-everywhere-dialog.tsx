"use client";

import { useState } from "react";
import { Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { THUMB_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import { authClient } from "@/lib/auth-client";
import { authErrorSentence } from "@/lib/auth-error-messages";
import { LOGGED_OUT_PAGE } from "@/lib/constants";
import { loadFreshPage } from "@/lib/load-fresh-page";
import { cn } from "@/lib/utils";

/**
 * Sign out everywhere (rule 7, D14), on the coach's Account card: one
 * confirm, then Better Auth ends every session of the login, this one
 * included, and the login page loads fresh, as Log out's does
 * (contexts/auth-context.tsx): a fresh page keeps nothing of the account,
 * neither the data this page holds nor the routes Next remembers. Between
 * the confirm and that page nothing changes on screen but the spinner: the
 * call is told not to have Better Auth re-read the session, which would
 * render this page signed out first. A refusal leaves the confirm open, its
 * reason in a toast.
 */
export function SignOutEverywhereDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [pending, setPending] = useState(false);

  const signOutEverywhere = async () => {
    setPending(true);
    let refusal: unknown = null;
    try {
      const { error } = await authClient.revokeSessions({ fetchOptions: { disableSignal: true } });
      refusal = error;
    } catch (failure) {
      console.error("Sign out everywhere failed:", failure);
      refusal = failure;
    }
    if (!refusal) {
      loadFreshPage(LOGGED_OUT_PAGE);
      return;
    }
    setPending(false);
    toast.error("Couldn't sign out everywhere", { description: authErrorSentence(refusal) });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className={cn(THUMB_CLASS, "h-9 w-9")}>
              <LogOut className="h-4 w-4" strokeWidth={1.5} />
            </span>
            <DialogTitle>Sign out everywhere?</DialogTitle>
          </div>
          <DialogDescription className="pt-2">Every device signed in to your account is signed out, this one too.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button className="bg-[#0d9488] text-white hover:bg-[#0b7f75]" disabled={pending} onClick={() => void signOutEverywhere()}>
            {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Sign out everywhere
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
