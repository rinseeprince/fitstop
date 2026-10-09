"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { THUMB_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import { authClient } from "@/lib/auth-client";
import { authErrorSentence } from "@/lib/auth-error-messages";
import type { SettingsPage } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { changeEmailSchema, type ChangeEmailFormData } from "@/lib/validations/auth";

/**
 * Change email (rules 6 and 17, D18), on the coach's and the client's Account
 * cards: the new address. Better Auth emails the address they sign in with
 * now to approve the change, then the new one to confirm it, and only that
 * second link changes it, so the host keeps showing `currentEmail` until then.
 * Both links land on `landing`, the asker's own Settings. A save closes the
 * dialog in the same tick its answer lands, saying where the approval went; a
 * refusal leaves it open, its reason in a toast. The host keys the dialog by
 * its opening and hands it the address the session held when it opened.
 */
export function ChangeEmailDialog({
  open,
  currentEmail,
  landing,
  onOpenChange,
}: {
  open: boolean;
  /** The address the asker signs in with, as the session held it when the dialog opened. */
  currentEmail: string;
  /** The Settings page both emailed links land on: the coach's or the client's. */
  landing: SettingsPage;
  onOpenChange: (open: boolean) => void;
}) {
  // Owned here, not read off isSubmitting, for the reason ChangePasswordDialog gives.
  const [pending, setPending] = useState(false);
  const schema = useMemo(() => changeEmailSchema(currentEmail), [currentEmail]);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ChangeEmailFormData>({ resolver: zodResolver(schema), defaultValues: { newEmail: "" } });

  const onSubmit = async ({ newEmail }: ChangeEmailFormData) => {
    setPending(true);
    let refusal: unknown = null;
    try {
      const { error } = await authClient.changeEmail({ newEmail, callbackURL: landing });
      refusal = error;
    } catch (failure) {
      console.error("Change email failed:", failure);
      refusal = failure;
    }
    if (!refusal) {
      onOpenChange(false);
      toast.success(`We've emailed ${currentEmail} to approve the change.`);
      return;
    }
    setPending(false);
    toast.error("Couldn't change your email", { description: authErrorSentence(refusal) });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className={cn(THUMB_CLASS, "h-9 w-9")}>
              <Mail className="h-4 w-4" strokeWidth={1.5} />
            </span>
            <DialogTitle>Change email</DialogTitle>
          </div>
        </DialogHeader>

        <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5 py-1">
            <Label htmlFor="change-email-new">New email</Label>
            <Input id="change-email-new" type="email" autoComplete="email" className="h-8" disabled={pending} {...register("newEmail")} />
            {errors.newEmail && <p className="text-[12px] text-[#c06060]">{errors.newEmail.message}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending} className="bg-[#0d9488] text-white hover:bg-[#0b7f75]">
              {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Change email
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
