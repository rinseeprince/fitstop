"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { toast } from "sonner"
import { 
  Loader2, 
  CheckCircle, 
  Lock, 
  AlertTriangle,
  Mail,
  User
} from "lucide-react"
import { supabase } from "@/services/supabase-client"
import { motion } from "framer-motion"
import type { InvitationDetailsResponse } from "@/types/auth"

// Validation schema for signup form
const signupSchema = z
  .object({
    email: z.string().email("Please enter a valid email address"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(72, "Password must be at most 72 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  })

type SignupFormData = z.infer<typeof signupSchema>

interface InvitationDetails {
  id: string
  clientName: string
  clientEmail: string
  coachName: string
  expiresAt: string | null
  status: string
}

export default function InvitePage() {
  const params = useParams()
  const router = useRouter()
  const token = params.token as string

  const [invitation, setInvitation] = useState<InvitationDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      email: "",
      password: "",
      confirmPassword: "",
    },
  })

  // Load invitation details
  useEffect(() => {
    async function loadInvitation() {
      if (!token) {
        setError("Invalid invitation link")
        setLoading(false)
        return
      }

      try {
        const response = await fetch(`/api/invitations/${token}`)
        const data: InvitationDetailsResponse = await response.json()

        if (!data.success || !data.invitation) {
          setError(data.error || "Invalid invitation")
          setLoading(false)
          return
        }

        setInvitation(data.invitation)
        // Pre-fill email and make it read-only
        form.setValue("email", data.invitation.clientEmail)
      } catch (err) {
        console.error("Error loading invitation:", err)
        setError("Failed to load invitation details")
      } finally {
        setLoading(false)
      }
    }

    loadInvitation()
  }, [token, form])

  const onSubmit = async (data: SignupFormData) => {
    if (!invitation) return

    setIsSubmitting(true)

    try {
      // Create Supabase user with standard signup
      const { data: authData, error: signupError } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          data: {
            name: invitation.clientName,
            role: "client",
            invitation_token: token, // Store token in user metadata for linking
          },
        },
      })

      if (signupError) {
        console.error("Signup error:", signupError)
        
        // Handle specific Supabase errors
        if (signupError.message?.includes("already registered")) {
          throw new Error("This email is already registered. Please sign in instead.")
        }
        
        throw new Error(signupError.message || "Failed to create account")
      }

      if (!authData.user) {
        throw new Error("Account creation failed - no user returned")
      }

      // Accept the invitation by linking the new user to the client
      const acceptResponse = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token,
          userId: authData.user.id,
        }),
      })

      if (!acceptResponse.ok) {
        console.error("Failed to accept invitation:", acceptResponse.status)
        // Don't fail the entire flow - user account is created successfully
        console.warn("User account created but invitation linking failed")
      }

      toast.success("Account created successfully! Welcome to CoachHub.")
      
      // Redirect to client dashboard (smart router handles onboarding vs walkthrough)
      router.push("/client/dashboard")

    } catch (error) {
      console.error("Error during signup:", error)
      toast.error(
        error instanceof Error ? error.message : "Failed to create account"
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading invitation...</p>
        </motion.div>
      </div>
    )
  }

  // Error state
  if (error) {
    const isExpired = error.toLowerCase().includes("expired")
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
                <h2 className="text-xl font-semibold mb-2">
                  {isExpired ? "Invitation Expired" : "Invalid Invitation"}
                </h2>
                <p className="text-muted-foreground mb-4">
                  {isExpired
                    ? "This invitation has expired. Please ask your coach to send a new one."
                    : error}
                </p>
                <Button
                  onClick={() => router.push("/")}
                  variant="outline"
                  className="w-full"
                >
                  Go to Homepage
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background decorations */}
      <div className="absolute inset-0 bg-muted opacity-50" />
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
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-md"
      >
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <CheckCircle className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-2xl">You're Invited!</CardTitle>
            <p className="text-muted-foreground">
              {invitation?.coachName} has invited you to join CoachHub to track your fitness journey together.
            </p>
          </CardHeader>

          <CardContent>
            {/* Invitation details */}
            <div className="mb-6 space-y-3">
              <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                <User className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Your Coach</p>
                  <p className="text-sm text-muted-foreground">{invitation?.coachName}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Your Email</p>
                  <p className="text-sm text-muted-foreground">{invitation?.clientEmail}</p>
                </div>
              </div>
            </div>

            {/* Expiry warning */}
            {invitation?.expiresAt && (
              <Alert className="mb-6">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  This invitation expires on{" "}
                  {new Date(invitation.expiresAt).toLocaleDateString()}. 
                  Create your account now to get started.
                </AlertDescription>
              </Alert>
            )}

            {/* Signup form */}
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Address</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="email"
                          readOnly
                          className="bg-muted/50 cursor-not-allowed"
                        />
                      </FormControl>
                      <FormDescription>
                        This email address was provided by your coach
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Create Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            {...field}
                            type="password"
                            placeholder="Enter your password"
                            className="pl-9"
                            disabled={isSubmitting}
                          />
                        </div>
                      </FormControl>
                      <FormDescription>
                        Must be at least 8 characters long
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            {...field}
                            type="password"
                            placeholder="Confirm your password"
                            className="pl-9"
                            disabled={isSubmitting}
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full bg-primary hover:bg-primary/90"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating your account...
                    </>
                  ) : (
                    "Create Account & Get Started"
                  )}
                </Button>
              </form>
            </Form>

            <p className="text-center text-xs text-muted-foreground mt-6">
              By creating an account, you agree to track your fitness progress with {invitation?.coachName}.
            </p>

            <p className="text-center text-sm text-muted-foreground mt-3">
              Already have an account?{" "}
              <a
                href={`/login?redirectTo=/client/dashboard`}
                className="text-primary hover:underline font-medium"
              >
                Sign in
              </a>
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}