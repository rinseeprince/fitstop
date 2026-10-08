"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
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
import { motion } from "framer-motion"
import { authClient } from "@/lib/auth-client"
import { PASSWORD_MIN_LENGTH } from "@/lib/constants"
import { newPasswordSchema, type NewPasswordFormData } from "@/lib/validations/auth"
import type { AcceptInvitationResponse, InvitationDetails, InvitationDetailsResponse } from "@/types/auth"

export default function InvitePage() {
  const params = useParams()
  const router = useRouter()
  const token = params.token as string
  // The invite's answer sets the session cookie; the shared session store
  // learns of it here, before the client's pages read it.
  const { refetch: refetchSession } = authClient.useSession()

  const [invitation, setInvitation] = useState<InvitationDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // The password the client chooses, twice (rule 11)
  const form = useForm<NewPasswordFormData>({
    resolver: zodResolver(newPasswordSchema),
    defaultValues: {
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
      } catch (err) {
        console.error("Error loading invitation:", err)
        setError("Failed to load invitation details")
      } finally {
        setLoading(false)
      }
    }

    loadInvitation()
  }, [token])

  const onSubmit = async (data: NewPasswordFormData) => {
    if (!invitation) return

    setIsSubmitting(true)

    try {
      // The server makes the login on the invited address and signs it in.
      const response = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token, password: data.password }),
      })
      const result: AcceptInvitationResponse = await response.json()

      if (!response.ok || !result.success) {
        toast.error("Couldn't create your account", {
          description: result.error ?? "Something went wrong. Try again.",
        })
        return
      }

      await refetchSession()
      toast.success("Account created successfully! Welcome to CoachHub.")

      // The client home sends a new client on to their intake form
      router.push("/client")
    } catch (error) {
      console.error("Error accepting invitation:", error)
      toast.error("Couldn't create your account", {
        description: "Something went wrong. Try again.",
      })
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
                  <p className="text-sm text-muted-foreground">{invitation?.emailMasked}</p>
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

            {/* Password form */}
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                        Must be at least {PASSWORD_MIN_LENGTH} characters long
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
                href="/login"
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
