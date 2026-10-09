"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { motion } from "framer-motion";
import { Chrome, Loader2 } from "lucide-react";
import { loginSchema, type LoginFormData } from "@/lib/validations/auth";
import { authClient } from "@/lib/auth-client";
import { authErrorSentence } from "@/lib/auth-error-messages";
import { LOGIN_PAGE, PRODUCT_NAME } from "@/lib/constants";
import { LoginNotice } from "@/components/auth/login-notice";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  // Continue with Google in flight, until the browser has left for Google.
  const [googlePending, setGooglePending] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });
  const busy = isSubmitting || googlePending;

  // Back from Google's page, the browser may show this page as it was left,
  // busy, from its back-forward cache: nothing is in flight any more.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setGooglePending(false);
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);

  // Continue with Google (rule 8, D3): Better Auth answers Google's sign-in
  // page and the browser goes there. Google sends it back to Better Auth's
  // callback, which signs in the login that has the Google address and lands
  // on /, where the proxy sends each role home (F11); a refusal lands on
  // /login?error=…, which the notice above words.
  const continueWithGoogle = async () => {
    // An earlier sign-in's sentence is about that attempt, not this one.
    clearErrors("root.signIn");
    setGooglePending(true);
    let refusal: unknown = null;
    try {
      const { error } = await authClient.signIn.social({ provider: "google", callbackURL: "/", errorCallbackURL: LOGIN_PAGE });
      refusal = error;
    } catch (failure) {
      console.error("Continue with Google failed:", failure);
      refusal = failure;
    }
    if (!refusal) return;
    setGooglePending(false);
    setError("root.signIn", { message: authErrorSentence(refusal) });
  };

  const onSubmit = async (data: LoginFormData) => {
    try {
      const role = await login(data.email, data.password);

      // Redirect based on role
      const redirectTo = role === "client" ? "/client" : "/dashboard";
      router.push(redirectTo);
    } catch (error: unknown) {
      // Shown under the form: a wrong pair, too many attempts, or the generic
      // sentence (rules 1 and 15); never Better Auth's own words.
      setError("root.signIn", { message: authErrorSentence(error) });
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      {/* Subtle background gradient */}
      <div className="absolute inset-0 bg-muted opacity-50" />

      {/* Animated background orbs */}
      <motion.div
        className="absolute top-20 left-20 w-64 h-64 bg-primary/10 rounded-full blur-3xl"
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.3, 0.5, 0.3],
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />
      <motion.div
        className="absolute bottom-20 right-20 w-96 h-96 bg-accent/10 rounded-full blur-3xl"
        animate={{
          scale: [1.2, 1, 1.2],
          opacity: [0.2, 0.4, 0.2],
        }}
        transition={{
          duration: 10,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* Login card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="bg-card border border-border rounded-lg p-8">
          {/* Branding */}
          <div className="text-center mb-8">
            <motion.h1
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-3xl font-semibold mb-2 text-foreground"
            >
              {PRODUCT_NAME}
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="text-muted-foreground"
            >
              Sign in to your account
            </motion.p>
          </div>

          {/* The proxy's reason for sending a signed-in visitor here, if
              any. Its own Suspense boundary: the reader must not deopt the
              page's static prerender (CONVENTIONS §7). */}
          <Suspense fallback={null}>
            <LoginNotice />
          </Suspense>

          {/* Continue with Google */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="mb-6"
          >
            <Button
              type="button"
              variant="outline"
              className="w-full rounded-xs h-11"
              onClick={continueWithGoogle}
              disabled={busy}
            >
              {googlePending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Chrome className="h-4 w-4 mr-2" />
              )}
              Continue with Google
            </Button>
          </motion.div>

          {/* Divider */}
          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
            </div>
          </div>

          {/* Email/Password form */}
          <motion.form
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="coach@example.com"
                className="rounded-xs h-11"
                disabled={busy}
                {...register("email")}
              />
              {errors.email && (
                <p className="text-xs text-destructive">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  href="/forgot-password"
                  className="text-xs text-primary hover:underline"
                >
                  Forgot your password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                className="rounded-xs h-11"
                disabled={busy}
                {...register("password")}
              />
              {errors.password && (
                <p className="text-xs text-destructive">{errors.password.message}</p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full rounded-xs h-11 bg-primary hover:bg-primary/90 transition-colors"
              disabled={busy}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign in"
              )}
            </Button>

            {errors.root?.signIn && (
              <p role="alert" className="text-sm text-destructive">
                {errors.root.signIn.message}
              </p>
            )}
          </motion.form>
        </div>
      </motion.div>
    </div>
  );
}
