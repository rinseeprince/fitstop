"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/services/supabase-client";
import type { User, Session } from "@supabase/supabase-js";
import type { Coach } from "@/types/check-in";

interface AuthContextType {
  user: User | null;
  coach: Coach | null;
  session: Session | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  signup: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [coach, setCoach] = useState<Coach | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch or create coach profile for the authenticated user
  const fetchOrCreateCoachProfile = async (user: User) => {
    try {
      // First, try to get existing coach profile
      const { data: existingCoach, error: fetchError } = await supabase
        .from("coaches")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (existingCoach) {
        setCoach({
          id: (existingCoach as any).id,
          userId: (existingCoach as any).user_id,
          name: (existingCoach as any).name,
          email: (existingCoach as any).email,
          avatarUrl: (existingCoach as any).avatar_url,
          createdAt: (existingCoach as any).created_at,
          updatedAt: (existingCoach as any).updated_at,
        });
        return;
      }

      // If no coach profile exists, create one
      if (fetchError?.code === "PGRST116") {
        // PGRST116 = no rows returned
        const { data: newCoach, error: createError } = await supabase
          .from("coaches")
          .insert({
            user_id: user.id,
            name: user.user_metadata?.name || user.user_metadata?.full_name || "Coach",
            email: user.email!,
            avatar_url: user.user_metadata?.avatar_url || null,
          } as any)
          .select()
          .single();

        if (createError) {
          console.error("Error creating coach profile:", createError);
          throw createError;
        }

        setCoach({
          id: (newCoach as any).id,
          userId: (newCoach as any).user_id,
          name: (newCoach as any).name,
          email: (newCoach as any).email,
          avatarUrl: (newCoach as any).avatar_url,
          createdAt: (newCoach as any).created_at,
          updatedAt: (newCoach as any).updated_at,
        });
      } else {
        console.error("Unexpected fetch error:", fetchError);
        throw fetchError;
      }
    } catch (error) {
      console.error("Error with coach profile:", error);
      throw error;
    }
  };

  // Initialize auth state on mount
  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchOrCreateCoachProfile(session.user).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        await fetchOrCreateCoachProfile(session.user);
      } else {
        setCoach(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Login with email and password
  const login = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    if (data.user) {
      await fetchOrCreateCoachProfile(data.user);
    }
  };

  // Login with Google OAuth
  const loginWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) throw error;
  };

  // Sign up with email and password
  const signup = async (email: string, password: string, name: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
        },
      },
    });

    if (error) throw error;

    // Create coach profile immediately after signup
    if (data.user) {
      await fetchOrCreateCoachProfile(data.user);
    }
  };

  // Logout
  const logout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setCoach(null);
  };

  // Send password reset email
  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) throw error;
  };

  // Update password (called from reset password page)
  const updatePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) throw error;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        coach,
        session,
        loading,
        login,
        loginWithGoogle,
        signup,
        logout,
        resetPassword,
        updatePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// Hook to use auth context
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
