import { PasswordLinkPage } from "@/components/auth/password-link-page";

/** Where the "Set your password" link the owner's coach:create emails a new coach lands (rule 9). */
export default function SetPasswordPage() {
  return <PasswordLinkPage landing="set" />;
}
