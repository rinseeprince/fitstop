"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/contexts/auth-context"
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
import { toast } from "sonner"
import { Loader2, Lock, CheckCircle } from "lucide-react"
import { supabase } from "@/services/supabase-client"

const onboardingSchema = z
  .object({
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

type OnboardingInput = z.infer<typeof onboardingSchema>

export default function ClientOnboardingPage() {
  console.log('[Onboarding] Component mounting/rendering')
  
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [sessionLoading, setSessionLoading] = useState(true)
  const router = useRouter()
  const { user, updatePassword, loading } = useAuth()
  
  console.log('[Onboarding] Component state:', { 
    user: user ? user.id : 'null', 
    loading, 
    sessionLoading 
  })

  const form = useForm<OnboardingInput>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  })

  // Direct session check to ensure user is authenticated
  useEffect(() => {
    const checkSession = async () => {
      console.log('[Onboarding] Checking session...')
      console.log('[Onboarding] Auth context user:', user ? user.id : 'null')
      console.log('[Onboarding] Auth context loading:', loading)
      
      // If auth context is still loading, don't proceed yet
      if (loading) {
        console.log('[Onboarding] Auth context still loading, waiting...')
        return
      }
      
      try {
        let sessionUser = null;
        
        // First try auth context
        if (user) {
          console.log('[Onboarding] Found user in auth context:', user.id)
          sessionUser = user
        } else {
          console.log('[Onboarding] No user in auth context, trying getSession...')
          
          // Try getSession with timeout
          try {
            const getSessionPromise = supabase.auth.getSession();
            const timeout = new Promise((_, reject) => 
              setTimeout(() => reject(new Error('getSession timeout')), 3000)
            );
            
            const result = await Promise.race([getSessionPromise, timeout]) as any;
            const session = result.data?.session;
            sessionUser = session?.user;
            
            if (result.error) {
              console.error('[Onboarding] Session error:', result.error)
            }
          } catch (timeoutError) {
            console.log('[Onboarding] getSession timed out:', timeoutError instanceof Error ? timeoutError.message : 'unknown error')
          }
        }
        
        if (!sessionUser) {
          console.log('[Onboarding] No user found anywhere, redirecting to login')
          router.push('/login')
          return
        }
        
        console.log('[Onboarding] Session found for user:', sessionUser.id)
        console.log('[Onboarding] User metadata:', sessionUser.user_metadata)
        
        // Check if password is already set
        if (sessionUser.user_metadata?.password_set) {
          console.log('[Onboarding] Password already set, redirecting to dashboard')
          router.push('/client/dashboard')
          return
        }
        
        console.log('[Onboarding] Session valid, showing onboarding form')
      } catch (error) {
        console.error('[Onboarding] Error checking session:', error)
        console.log('[Onboarding] Defaulting to showing onboarding form')
      } finally {
        setSessionLoading(false)
      }
    }
    
    checkSession()
  }, [router, user, loading])

  const onSubmit = async (data: OnboardingInput) => {
    setIsSubmitting(true)

    try {
      // Update the user's password
      await updatePassword(data.password)

      // Mark password as set in user metadata
      await supabase.auth.updateUser({
        data: { password_set: true },
      })

      toast.success("Account setup complete!")
      router.push("/client/dashboard")
    } catch (error) {
      console.error("Error setting password:", error)
      toast.error(
        error instanceof Error ? error.message : "Failed to set password"
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  console.log('[Onboarding] Render decision:', { sessionLoading, loading, hasUser: !!user })
  
  // Show loading state while checking session
  if (sessionLoading) {
    console.log('[Onboarding] Showing loading state')
    return (
      <div className="flex min-h-[80vh] flex-col items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }
  
  console.log('[Onboarding] Rendering onboarding form')

  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <CheckCircle className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Welcome to CoachHub!</CardTitle>
          <p className="mt-2 text-muted-foreground">
            Your coach has invited you to track your fitness journey. Set a
            password to complete your account setup.
          </p>
        </CardHeader>

        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="password"
                          placeholder="Create a password"
                          className="pl-9"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormDescription>
                      Must be at least 8 characters
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
                          type="password"
                          placeholder="Confirm your password"
                          className="pl-9"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Setting up account...
                  </>
                ) : (
                  "Complete Setup"
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
