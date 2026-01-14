"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react"
import { supabase } from "@/services/supabase-client"
import type { User, Session } from "@supabase/supabase-js"
import type { Coach } from "@/types/check-in"
import type { Profile, ProfileRow, UserRole } from "@/types/auth"

interface AuthContextType {
  user: User | null
  coach: Coach | null
  profile: Profile | null
  role: UserRole | null
  session: Session | null
  loading: boolean
  isTrainer: boolean
  isClient: boolean
  login: (email: string, password: string) => Promise<UserRole | null>
  loginWithGoogle: () => Promise<void>
  signup: (email: string, password: string, name: string) => Promise<void>
  logout: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  updatePassword: (newPassword: string) => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

/** Retry delay in ms for profile fetch */
const PROFILE_RETRY_DELAY = 200
/** Number of retries for profile fetch */
const PROFILE_RETRY_COUNT = 3

/** Database row type for coaches table */
type CoachRow = {
  id: string
  user_id: string
  name: string
  email: string
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [coach, setCoach] = useState<Coach | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  // Track if initialization is in progress to prevent race conditions
  const initializingRef = useRef(false)

  const role = profile?.role ?? null
  const isTrainer = role === "trainer"
  const isClient = role === "client"

  /** Fetch user profile from database */
  const fetchProfile = async (userId: string): Promise<Profile | null> => {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .single()

    if (error) {
      // PGRST116 = no rows returned
      if (error.code === "PGRST116") return null
      console.error("Error fetching profile:", error)
      return null
    }

    const row = data as unknown as ProfileRow
    return {
      id: row.id,
      userId: row.user_id,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  /** Create profile for user (fallback if trigger didn't create it) */
  const createProfile = async (
    userId: string,
    userRole: UserRole
  ): Promise<Profile> => {
    // Type assertion needed as profiles table not in generated types yet
    const { data, error } = await (supabase
      .from("profiles") as ReturnType<typeof supabase.from>)
      .insert({ user_id: userId, role: userRole } as Record<string, unknown>)
      .select()
      .single()

    if (error) {
      console.error("Error creating profile:", error)
      throw error
    }

    const row = data as unknown as ProfileRow
    return {
      id: row.id,
      userId: row.user_id,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  /** Convert CoachRow to Coach type */
  const toCoach = (row: CoachRow): Coach => ({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatar_url ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })

  /** Fetch or create coach profile for trainers */
  const fetchOrCreateCoachProfile = async (authUser: User) => {
    // Type assertions needed as coaches table not in generated types yet
    const coachesTable = supabase.from("coaches") as ReturnType<typeof supabase.from>

    const { data: coachData, error: fetchError } = await coachesTable
      .select("*")
      .eq("user_id", authUser.id)
      .single()

    if (coachData) {
      setCoach(toCoach(coachData as unknown as CoachRow))
      return
    }

    // PGRST116 = no rows returned - need to create coach
    if (fetchError?.code === "PGRST116") {
      const coachName =
        authUser.user_metadata?.name ||
        authUser.user_metadata?.full_name ||
        "Coach"

      const { data: newCoachData, error: createError } = await coachesTable
        .insert({
          user_id: authUser.id,
          name: coachName,
          email: authUser.email ?? "",
          avatar_url: authUser.user_metadata?.avatar_url || null,
        } as Record<string, unknown>)
        .select()
        .single()

      if (createError) {
        console.error("Error creating coach profile:", createError)
        throw createError
      }

      if (newCoachData) {
        setCoach(toCoach(newCoachData as unknown as CoachRow))
      }
    } else if (fetchError) {
      console.error("Error fetching coach profile:", fetchError)
      throw fetchError
    }
  }

  /** Initialize user data based on role with retry logic for RLS timing */
  const initializeUserData = async (authUser: User) => {
    // Prevent concurrent initialization
    if (initializingRef.current) return
    initializingRef.current = true

    try {
      // Fetch profile - trigger should have created it
      // Retry a few times in case of RLS timing issues
      let userProfile: Profile | null = null
      for (let i = 0; i < PROFILE_RETRY_COUNT; i++) {
        userProfile = await fetchProfile(authUser.id)
        if (userProfile) break
        await new Promise((resolve) => setTimeout(resolve, PROFILE_RETRY_DELAY))
      }

      if (!userProfile) {
        // Fallback: try to create if still not found
        try {
          const isInvitedClient = authUser.user_metadata?.role === "client"
          const defaultRole: UserRole = isInvitedClient ? "client" : "trainer"
          userProfile = await createProfile(authUser.id, defaultRole)
        } catch {
          // Profile might exist but RLS blocking - try one more fetch
          userProfile = await fetchProfile(authUser.id)
          if (!userProfile) {
            console.error("Could not fetch or create profile")
            return
          }
        }
      }

      setProfile(userProfile)

      // Only fetch/create coach profile for trainers
      if (userProfile.role === "trainer") {
        await fetchOrCreateCoachProfile(authUser)
      } else {
        setCoach(null)
      }
    } finally {
      initializingRef.current = false
    }
  }

  // Initialize auth state on mount
  useEffect(() => {
    const initSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        setSession(session)
        setUser(session?.user ?? null)

        if (session?.user) {
          await initializeUserData(session.user)
        }
      } catch (error) {
        console.error("Error initializing session:", error)
      } finally {
        setLoading(false)
      }
    }

    initSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)

      if (session?.user) {
        try {
          await initializeUserData(session.user)
        } catch (error) {
          console.error("Error initializing user data on auth change:", error)
        }
      } else {
        setCoach(null)
        setProfile(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  /** Login with email and password - returns user role for redirect */
  const login = async (
    email: string,
    password: string
  ): Promise<UserRole | null> => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) throw error

    if (data.user) {
      try {
        await initializeUserData(data.user)
        // Return the role for redirect logic
        const userProfile = await fetchProfile(data.user.id)
        return userProfile?.role ?? null
      } catch (initError) {
        console.error("Error initializing user data after login:", initError)
        // Still return the role from profile state if it was set
        return profile?.role ?? null
      }
    }

    return null
  }

  // Login with Google OAuth
  const loginWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) throw error
  }

  // Sign up with email and password (trainers only)
  const signup = async (email: string, password: string, name: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
          role: "trainer", // Explicitly set role for new signups
        },
      },
    })

    if (error) {
      // Provide clearer error messages
      if (error.status === 422 || error.message?.includes("already registered")) {
        throw new Error("This email is already registered. Please log in instead.")
      }
      throw error
    }

    // Check if user already exists (Supabase returns user but no session for existing emails)
    // For existing users, identities array will be empty
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      throw new Error("This email is already registered. Please log in instead.")
    }

    // Database trigger handles profile/coach creation automatically
    // The onAuthStateChange listener will call initializeUserData when session is ready
  }

  // Logout
  const logout = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    setCoach(null)
    setProfile(null)
  }

  // Send password reset email
  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    if (error) throw error
  }

  // Update password
  const updatePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    })

    if (error) throw error
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        coach,
        profile,
        role,
        session,
        loading,
        isTrainer,
        isClient,
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
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
