"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { THUMB_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import { authClient } from "@/lib/auth-client";
import { AUTH_ERROR_SENTENCES, authErrorSentence } from "@/lib/auth-error-messages";
import { PASSWORD_MIN_LENGTH } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { changePasswordSchema, type ChangePasswordFormData } from "@/lib/validations/auth";

const FIELD_ERROR_CLASS = "text-[12px] text-[#c06060]";

/**
 * Change password (rule 6, D19), on the coach's and the client's Account
 * cards: the current password, then the new one twice. Better Auth checks
 * the current one and ends every other session of the login, keeping this
 * device signed in on a new one. A save closes the dialog in the same tick
 * its answer lands, with "Password changed"; a wrong current password is
 * said under its box, anything else Better Auth refuses in a toast, and the
 * dialog stays open. The host keys the dialog by its opening, so each open
 * starts empty and idle.
 */
export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  // The change in flight, owned here rather than read off react-hook-form's
  // isSubmitting, which clears in the commit that closes the dialog: the
  // closing card would drop its spinner and re-enable its buttons.
  const [pending, setPending] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ChangePasswordFormData>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", password: "", confirmPassword: "" },
  });

  const onSubmit = async ({ currentPassword, password }: ChangePasswordFormData) => {
    setPending(true);
    let refusal: unknown = null;
    try {
      const { error } = await authClient.changePassword({ currentPassword, newPassword: password, revokeOtherSessions: true });
      refusal = error;
    } catch (failure) {
      console.error("Change password failed:", failure);
      refusal = failure;
    }
    if (!refusal) {
      onOpenChange(false);
      toast.success("Password changed");
      return;
    }
    setPending(false);
    const sentence = authErrorSentence(refusal);
    if (sentence === AUTH_ERROR_SENTENCES.wrongCurrentPassword) {
      setError("currentPassword", { message: sentence });
    } else {
      toast.error("Couldn't change your password", { description: sentence });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className={cn(THUMB_CLASS, "h-9 w-9")}>
              <KeyRound className="h-4 w-4" strokeWidth={1.5} />
            </span>
            <DialogTitle>Change password</DialogTitle>
          </div>
        </DialogHeader>

        <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="change-password-current">Current password</Label>
              <Input
                id="change-password-current"
                type="password"
                autoComplete="current-password"
                className="h-8"
                disabled={pending}
                {...register("currentPassword")}
              />
              {errors.currentPassword && <p className={FIELD_ERROR_CLASS}>{errors.currentPassword.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="change-password-new">New password</Label>
              <Input
                id="change-password-new"
                type="password"
                autoComplete="new-password"
                className="h-8"
                disabled={pending}
                {...register("password")}
              />
              {errors.password && <p className={FIELD_ERROR_CLASS}>{errors.password.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="change-password-confirm">Confirm new password</Label>
              <Input
                id="change-password-confirm"
                type="password"
                autoComplete="new-password"
                className="h-8"
                disabled={pending}
                {...register("confirmPassword")}
              />
              {errors.confirmPassword ? (
                <p className={FIELD_ERROR_CLASS}>{errors.confirmPassword.message}</p>
              ) : (
                <p className="text-[12px] text-[#93b0b4]">At least {PASSWORD_MIN_LENGTH} characters</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending} className="bg-[#0d9488] text-white hover:bg-[#0b7f75]">
              {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Change password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
