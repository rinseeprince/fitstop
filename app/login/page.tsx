"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { Chrome, Loader2 } from "lucide-react";
import { loginSchema, type LoginFormData } from "@/lib/validations/auth";
import { supabase } from "@/services/supabase-client";

export default function LoginPage() {
  const router = useRouter();
  const { login, loginWithGoogle } = useAuth();
  const { toast } = useToast();
  const [googleLoading, setGoogleLoading] = useState(false);
  const [isInviteFlow, setIsInviteFlow] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    try {
      const role = await login(data.email, data.password);

      // Redirect based on role
      const redirectTo = role === "client" ? "/client/dashboard" : "/dashboard";
      router.push(redirectTo);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Invalid email or password";
      toast({
        title: "Login failed",
        description: message,
        variant: "destructive",
      });
    }
  };

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    try {
      await loginWithGoogle();
      // Redirect will be handled by Supabase
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Could not sign in with Google";
      toast({
        title: "Login failed",
        description: message,
        variant: "destructive",
      });
      setGoogleLoading(false);
    }
  };

  // Process invitation user after session is established
  const processInvitationUser = async (user: any) => {
    console.log('[Invite Flow] Processing invitation for user:', user.id);
    
    // Accept the invitation if clientId is present
    const clientId = user.user_metadata?.clientId;
    if (clientId) {
      console.log('[Invite Flow] Calling /api/invitations/accept...');
      
      try {
        const response = await fetch('/api/invitations/accept', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            clientId,
            userId: user.id,
          }),
        });

        console.log('[Invite Flow] API response status:', response.status);

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[Invite Flow] API request failed:', response.status, errorText);
          throw new Error(`API request failed: ${response.status}`);
        }

        const result = await response.json();
        console.log('[Invite Flow] Accept invitation result:', result);

        if (!result.success) {
          throw new Error(result.error || 'Failed to accept invitation');
        }
      } catch (apiError) {
        console.error('[Invite Flow] API call error:', apiError);
        // Don't fail the entire flow if invitation acceptance fails
        // The user can still continue to onboarding
        console.log('[Invite Flow] Continuing despite API error');
      }
    } else {
      console.log('[Invite Flow] No clientId found in metadata, skipping invitation acceptance');
    }

    // Wait for auth context to sync
    console.log('[Invite Flow] Waiting for auth context to sync...');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check if user needs onboarding
    const needsOnboarding = !user.user_metadata?.password_set;
    const redirectTo = needsOnboarding ? '/client/onboarding' : '/client/dashboard';
    
    console.log('[Invite Flow] Password set:', user.user_metadata?.password_set);
    console.log('[Invite Flow] Needs onboarding:', needsOnboarding);
    console.log('[Invite Flow] Redirecting to:', redirectTo);
    
    // Clear hash from URL
    console.log('[Invite Flow] Clearing URL hash...');
    window.history.replaceState({}, document.title, window.location.pathname);
    
    console.log('[Invite Flow] Initiating redirect...');
    router.push(redirectTo);
  };

  // Handle invitation magic link tokens
  useEffect(() => {
    const handleInvitationFlow = async () => {
      const hash = window.location.hash;
      if (!hash) return;

      console.log('[Invite Flow] Hash detected:', hash);

      // Parse hash parameters
      const params = new URLSearchParams(hash.substring(1));
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const type = params.get('type');

      const isInviteFlow = type === 'invite';
      console.log('[Invite Flow] Is invite flow:', isInviteFlow);
      console.log('[Invite Flow] Access token present:', !!accessToken);
      console.log('[Invite Flow] Refresh token present:', !!refreshToken);

      if (isInviteFlow && accessToken && refreshToken) {
        setIsInviteFlow(true);
        setInviteLoading(true);

        try {
          console.log('[Invite Flow] Calling setSession...');
          
          let sessionResult = null;
          let sessionError = null;
          
          try {
            // Establish session with tokens using timeout
            const setSessionPromise = supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });

            // Add timeout to prevent hanging
            const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error('setSession timeout')), 5000)
            );

            const { data, error } = await Promise.race([setSessionPromise, timeoutPromise]) as any;
            sessionResult = data;
            sessionError = error;
            
            console.log('[Invite Flow] setSession result:', {
              hasSession: !!data?.session,
              hasUser: !!data?.user,
              error: error?.message
            });
          } catch (timeoutError) {
            console.error('[Invite Flow] setSession timed out:', timeoutError instanceof Error ? timeoutError.message : 'unknown error');
            sessionError = timeoutError;
          }

          // If setSession failed or timed out, try alternative approach
          if (sessionError) {
            console.log('[Invite Flow] setSession failed/timed out, waiting for auth state change...');
            
            // Wait a bit longer for the auth state change to process
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Get the current session with timeout
            console.log('[Invite Flow] Getting current session...');
            
            let currentSession = null;
            let getSessionError = null;
            
            try {
              const getSessionPromise = supabase.auth.getSession();
              const getSessionTimeout = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('getSession timeout')), 3000)
              );
              
              const result = await Promise.race([getSessionPromise, getSessionTimeout]) as any;
              currentSession = result.data;
              getSessionError = result.error;
            } catch (timeoutError) {
              console.error('[Invite Flow] getSession timed out:', timeoutError instanceof Error ? timeoutError.message : 'unknown error');
              
              // Last resort: try to extract user data from the JWT token directly
              console.log('[Invite Flow] Extracting user from JWT token...');
              try {
                const tokenPayload = JSON.parse(atob(accessToken.split('.')[1]));
                console.log('[Invite Flow] JWT payload:', tokenPayload);
                
                // Create a mock user object from the JWT
                const mockUser = {
                  id: tokenPayload.sub,
                  email: tokenPayload.email,
                  user_metadata: tokenPayload.user_metadata,
                  app_metadata: tokenPayload.app_metadata
                };
                
                console.log('[Invite Flow] Using user from JWT:', mockUser.id);
                await processInvitationUser(mockUser);
                return;
              } catch (jwtError) {
                console.error('[Invite Flow] Failed to parse JWT:', jwtError);
                throw new Error('Failed to establish session and parse JWT');
              }
            }
            
            console.log('[Invite Flow] Current session check:', {
              hasSession: !!currentSession?.session,
              hasUser: !!currentSession?.session?.user,
              error: getSessionError?.message
            });
            
            if (!currentSession?.session?.user) {
              throw new Error('Failed to establish session - no user found');
            }
            
            const user = currentSession.session.user;
            console.log('[Invite Flow] Got user from current session:', user.id);
            console.log('[Invite Flow] Client ID from metadata:', user.user_metadata?.clientId);
            console.log('[Invite Flow] User metadata:', user.user_metadata);
            
            // Continue with this user
            await processInvitationUser(user);
            return;
          }

          // setSession worked normally
          if (!sessionResult?.user) {
            console.error('[Invite Flow] No user in session data');
            throw new Error('No user found in session');
          }

          const user = sessionResult.user;
          console.log('[Invite Flow] User ID:', user.id);
          console.log('[Invite Flow] Client ID from metadata:', user.user_metadata?.clientId);
          console.log('[Invite Flow] User metadata:', user.user_metadata);
          
          await processInvitationUser(user);
        } catch (error) {
          console.error('[Invite Flow] Error:', error);
          toast({
            title: 'Invitation Error',
            description: error instanceof Error ? error.message : 'Failed to process invitation',
            variant: 'destructive',
          });
          setIsInviteFlow(false);
          setInviteLoading(false);
        }
      }
    };

    handleInvitationFlow();
  }, [router, toast]);

  // Show loading state for invite flow
  if (isInviteFlow && inviteLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative z-10 w-full max-w-md"
        >
          <div className="glass-surface rounded-lg p-8 shadow-custom-lg text-center">
            <motion.div
              animate={{
                scale: [1, 1.2, 1],
                opacity: [0.5, 1, 0.5],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              className="mx-auto mb-4 w-12 h-12 bg-primary/20 rounded-full flex items-center justify-center"
            >
              <Loader2 className="h-6 w-6 text-primary animate-spin" />
            </motion.div>
            <h2 className="text-xl font-semibold mb-2">Setting up your account...</h2>
            <p className="text-muted-foreground">Please wait while we process your invitation</p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      {/* Subtle background gradient */}
      <div className="absolute inset-0 gradient-subtle opacity-50" />

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
        <div className="glass-surface rounded-lg p-8 shadow-custom-lg">
          {/* Branding */}
          <div className="text-center mb-8">
            <motion.h1
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-3xl font-semibold mb-2 bg-gradient-to-r from-primary via-accent to-secondary bg-clip-text text-transparent"
            >
              CoachHub
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

          {/* Google OAuth */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="mb-6"
          >
            <Button
              variant="outline"
              className="w-full rounded-xs h-11"
              onClick={handleGoogleLogin}
              disabled={googleLoading || isSubmitting}
            >
              {googleLoading ? (
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
                disabled={isSubmitting || googleLoading}
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
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                className="rounded-xs h-11"
                disabled={isSubmitting || googleLoading}
                {...register("password")}
              />
              {errors.password && (
                <p className="text-xs text-destructive">{errors.password.message}</p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full rounded-xs h-11 gradient-primary hover:opacity-90 transition-opacity"
              disabled={isSubmitting || googleLoading}
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
          </motion.form>

          {/* Sign up link */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="text-center text-sm text-muted-foreground mt-6"
          >
            Don't have an account?{" "}
            <Link href="/signup" className="text-primary hover:underline font-medium">
              Sign up
            </Link>
          </motion.p>
        </div>
      </motion.div>
    </div>
  );
}
