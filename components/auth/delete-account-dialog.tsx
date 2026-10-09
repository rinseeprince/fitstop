"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Trash2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { AUTH_ERROR_SENTENCES, authErrorSentence } from "@/lib/auth-error-messages";
import { ACCOUNT_DELETED_PAGE, ACCOUNT_DELETION_TAKES, type DeletedAccount } from "@/lib/constants";
import { deleteAccountSchema, type DeleteAccountFormData } from "@/lib/validations/auth";

const FIELD_ERROR_CLASS = "text-[12px] text-[#c06060]";

/** The design system's danger outline (docs/newdesignsystem.md → "Destructive confirm dialog"): there is no filled destructive button. */
export const DANGER_OUTLINE_CLASS =
  "border border-[rgba(192,96,96,0.3)] text-[#c06060] hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]";

/**
 * Delete account (rules 10 and 13, D20), on the coach's and the client's
 * Account cards: what goes with the account, the coach's or the client's,
 * then the password. Better Auth checks the password and, instead of
 * deleting, emails a link that deletes the account when it is opened where
 * the person is signed in (landing on /login?deleted=1). A request closes the
 * dialog in the same tick its answer lands, with "Check your email to
 * confirm."; a wrong password is said under its box, anything else Better
 * Auth refuses in a toast, and the dialog stays open. The host keys the
 * dialog by its opening, so each open starts empty and idle.
 */
export function DeleteAccountDialog({
  open,
  account,
  onOpenChange,
}: {
  open: boolean;
  account: DeletedAccount;
  onOpenChange: (open: boolean) => void;
}) {
  // The request in flight, owned here rather than read off react-hook-form's
  // isSubmitting, which clears in the commit that closes the dialog: the
  // closing card would drop its spinner and re-enable its buttons.
  const [pending, setPending] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<DeleteAccountFormData>({
    resolver: zodResolver(deleteAccountSchema),
    defaultValues: { password: "" },
  });

  const onSubmit = async ({ password }: DeleteAccountFormData) => {
    setPending(true);
    let refusal: unknown = null;
    try {
      const { error } = await authClient.deleteUser({ password, callbackURL: ACCOUNT_DELETED_PAGE });
      refusal = error;
    } catch (failure) {
      console.error("Delete account failed:", failure);
      refusal = failure;
    }
    if (!refusal) {
      onOpenChange(false);
      toast.success("Check your email to confirm.");
      return;
    }
    setPending(false);
    const sentence = authErrorSentence(refusal);
    if (sentence === AUTH_ERROR_SENTENCES.wrongCurrentPassword) {
      setError("password", { message: sentence });
    } else {
      toast.error("Couldn't delete your account", { description: sentence });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-[rgba(192,96,96,0.08)]">
              <Trash2 className="h-4 w-4 text-[#c06060]" strokeWidth={1.5} />
            </span>
            <DialogTitle>Delete account?</DialogTitle>
          </div>
          <DialogDescription className="pt-2 text-sm text-[#5a7d82]">{ACCOUNT_DELETION_TAKES[account]}</DialogDescription>
        </DialogHeader>

        <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5 py-1">
            <Label htmlFor="delete-account-password">Password</Label>
            <Input
              id="delete-account-password"
              type="password"
              autoComplete="current-password"
              className="h-8"
              disabled={pending}
              {...register("password")}
            />
            {errors.password && <p className={FIELD_ERROR_CLASS}>{errors.password.message}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant="outline" disabled={pending} className={DANGER_OUTLINE_CLASS}>
              {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Delete account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
