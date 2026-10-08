import { PasswordLinkPage } from "@/components/auth/password-link-page";

/** Where the reset link lands (rule 4). */
export default function ResetPasswordPage() {
  return <PasswordLinkPage landing="reset" />;
}
