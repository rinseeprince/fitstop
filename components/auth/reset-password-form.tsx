"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { AUTH_ERROR_SENTENCES, authErrorSentence } from "@/lib/auth-error-messages";
import { PASSWORD_MIN_LENGTH } from "@/lib/constants";
import { newPasswordSchema, type NewPasswordFormData } from "@/lib/validations/auth";

/**
 * The two pages Better Auth's password link lands on (D17): the reset link's
 * (rule 4) and the "Set your password" link the owner's coach:create emails a
 * new coach (rule 9). One form, one call; only the words differ.
 */
export type PasswordLinkLanding = "reset" | "set";

export const PASSWORD_LINK_WORDING: Record<
  PasswordLinkLanding,
  { title: string; description: string; passwordLabel: string; submit: string; submitting: string; done: string }
> = {
  reset: {
    title: "Create new password",
    description: "Enter a new password for your account",
    passwordLabel: "New Password",
    submit: "Update password",
    submitting: "Updating password...",
    done: "Password updated",
  },
  set: {
    title: "Set your password",
    description: "Choose a password for your account",
    passwordLabel: "Password",
    submit: "Set password",
    submitting: "Setting password...",
    done: "Password set",
  },
};

/**
 * The link's landing: Better Auth sends the link's click here with `?token=`,
 * or with `?error=INVALID_TOKEN` when the link was used or has expired. The
 * ONLY reader of those params; `useSearchParams` bails static prerendering
 * out to the nearest Suspense boundary, so the page hosts this leaf behind
 * one of its own, with the fields as its pending frame (CONVENTIONS §7, "Gate
 * content, not structure").
 */
export function ResetPasswordForm({ landing }: { landing: PasswordLinkLanding }) {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  if (!token || searchParams.get("error")) return <ExpiredLink />;
  return <NewPasswordFields token={token} landing={landing} />;
}

function ExpiredLink() {
  return (
    <div role="alert" className="space-y-4">
      <p className="text-sm text-destructive">{AUTH_ERROR_SENTENCES.expiredLink}</p>
      <Button asChild variant="outline" className="w-full rounded-xs h-11">
        <Link href="/forgot-password">Request a new link</Link>
      </Button>
    </div>
  );
}

/**
 * Whoever is signed in on this browser is signed out once the password is
 * saved, so the login page shows its form: it sends a signed-in visitor to
 * their own dashboard, which, after a reset done where another account is
 * signed in, is that other account's. Nobody signed in is fine. A sign-out
 * that fails is logged and the person still goes on: the password is set.
 * The page needs no fresh load: it opens from the email's link, so Next
 * remembers no route and holds no account's data.
 */
async function signOutThisBrowser(): Promise<void> {
  try {
    const { error } = await authClient.signOut();
    if (error) console.error("Sign-out after the password was saved was refused:", error);
  } catch (error) {
    console.error("Sign-out after the password was saved failed:", error);
  }
}

/** The new password, twice. With no token yet (the pending frame) it is shown and can't be used. */
export function NewPasswordFields({ token, landing }: { token: string | null; landing: PasswordLinkLanding }) {
  const wording = PASSWORD_LINK_WORDING[landing];
  const router = useRouter();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<NewPasswordFormData>({
    resolver: zodResolver(newPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const onSubmit = async ({ password }: NewPasswordFormData) => {
    if (!token) return;
    try {
      const { error } = await authClient.resetPassword({ newPassword: password, token });
      if (error) {
        setError("root.reset", { message: authErrorSentence(error) });
        return;
      }
      await signOutThisBrowser();
      toast.success(wording.done);
      router.push("/login");
    } catch (error) {
      console.error("Password reset failed:", error);
      setError("root.reset", { message: authErrorSentence(error) });
    }
  };

  const disabled = !token || isSubmitting;

  return (
    <motion.form
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.4 }}
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label htmlFor="password">{wording.passwordLabel}</Label>
        <Input
          id="password"
          type="password"
          placeholder="••••••••"
          className="rounded-xs h-11"
          disabled={disabled}
          {...register("password")}
        />
        {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm Password</Label>
        <Input
          id="confirmPassword"
          type="password"
          placeholder="••••••••"
          className="rounded-xs h-11"
          disabled={disabled}
          {...register("confirmPassword")}
        />
        {errors.confirmPassword ? (
          <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
        ) : (
          <p className="text-xs text-muted-foreground">At least {PASSWORD_MIN_LENGTH} characters</p>
        )}
      </div>

      <Button
        type="submit"
        className="w-full rounded-xs h-11 bg-primary hover:bg-primary/90 transition-colors"
        disabled={disabled}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            {wording.submitting}
          </>
        ) : (
          <>
            <Check className="h-4 w-4 mr-2" />
            {wording.submit}
          </>
        )}
      </Button>

      {errors.root?.reset && (
        <div role="alert" className="space-y-2">
          <p className="text-sm text-destructive">{errors.root.reset.message}</p>
          {errors.root.reset.message === AUTH_ERROR_SENTENCES.expiredLink && (
            <Link href="/forgot-password" className="text-sm text-primary hover:underline">
              Request a new link
            </Link>
          )}
        </div>
      )}
    </motion.form>
  );
}
