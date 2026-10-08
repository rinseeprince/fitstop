import { z } from "zod"
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/constants"

/** Login form validation schema */
export const loginSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Please enter a valid email address"),
  password: z
    .string()
    .min(1, "Password is required"),
})

export type LoginFormData = z.infer<typeof loginSchema>

/** Forgot password: the address the reset link goes to */
export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Please enter a valid email address"),
})

export type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>

/** A password Better Auth will set, held to the lengths it holds every password to (D19) */
const newPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`)

/** The new password typed twice must match; the mismatch shows under the second box. */
const passwordsMatch = (data: { password: string; confirmPassword: string }) => data.password === data.confirmPassword
const PASSWORDS_DIFFER = { message: "Passwords don't match", path: ["confirmPassword"] }

/** A new password, twice (rule 4) */
export const newPasswordSchema = z
  .object({ password: newPassword, confirmPassword: z.string() })
  .refine(passwordsMatch, PASSWORDS_DIFFER)

export type NewPasswordFormData = z.infer<typeof newPasswordSchema>

/** Change password: the current password, then the new one twice (rule 6) */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    password: newPassword,
    confirmPassword: z.string(),
  })
  .refine(passwordsMatch, PASSWORDS_DIFFER)

export type ChangePasswordFormData = z.infer<typeof changePasswordSchema>

/** Change email: the new address, which is not the one the coach signs in with now (rule 6) */
export function changeEmailSchema(currentEmail: string) {
  return z.object({
    newEmail: z
      .string()
      .trim()
      .min(1, "Email is required")
      .email("Please enter a valid email address")
      .refine((email) => email.toLowerCase() !== currentEmail.toLowerCase(), "This is already your email."),
  })
}

export type ChangeEmailFormData = z.infer<ReturnType<typeof changeEmailSchema>>
