"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ChangePasswordDialog } from "@/components/auth/change-password-dialog";
import { ChangeEmailDialog } from "@/components/coach/change-email-dialog";
import { SignOutEverywhereDialog } from "@/components/coach/sign-out-everywhere-dialog";
import {
  SETTINGS_CARD_CLASS,
  SETTINGS_CARD_HEADER_CLASS,
  SETTINGS_CARD_TITLE_CLASS,
} from "@/components/coach/settings-card-classes";
import { TextSkeleton } from "@/components/text-skeleton";
import { useAuth } from "@/contexts/auth-context";
import { useDialogSubject } from "@/hooks/use-dialog-subject";

/** The dialog the card has open, with what it shows: change email shows the address the card showed. */
type AccountDialog =
  | { kind: "change-password" }
  | { kind: "change-email"; currentEmail: string }
  | { kind: "sign-out-everywhere" };

const ACTION_CLASS = "rounded-[6px] border-[rgba(13,148,136,0.08)] bg-white text-[#5a7d82] hover:text-[#0c1a1e]";

/**
 * The coach's Account card on Settings (rules 5, 6 and 7): the name and the
 * address they sign in with, both Better Auth's, then Change password, Change
 * email and Sign out everywhere. Who is signed in comes from the session
 * alone (docs/BETTER-AUTH-PLAN.md 1.2), so the address changes here when the
 * change of email's second link does, and not before. Until the session is
 * read the two values are pending and Change email, which needs the address,
 * waits. One dialog at a time (`useDialogSubject`): a close leaves it showing
 * what it showed, and each open mounts it fresh.
 */
export function CoachAccountCard() {
  const { user } = useAuth();
  const dialog = useDialogSubject<AccountDialog>();
  const onOpenChange = (next: boolean) => {
    if (!next) dialog.close();
  };
  const subject = dialog.subject;

  return (
    <>
      <Card className={SETTINGS_CARD_CLASS}>
        <CardHeader className={SETTINGS_CARD_HEADER_CLASS}>
          <h3 className={SETTINGS_CARD_TITLE_CLASS}>Account</h3>
        </CardHeader>
        <CardContent className="space-y-4 p-5">
          <dl className="space-y-2">
            <AccountDetail label="Name" value={user?.name} />
            <AccountDetail label="Email" value={user?.email} />
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className={ACTION_CLASS} onClick={() => dialog.show({ kind: "change-password" })}>
              Change password
            </Button>
            <Button
              variant="outline"
              className={ACTION_CLASS}
              disabled={!user}
              onClick={() => user && dialog.show({ kind: "change-email", currentEmail: user.email })}
            >
              Change email
            </Button>
            <Button variant="outline" className={ACTION_CLASS} onClick={() => dialog.show({ kind: "sign-out-everywhere" })}>
              Sign out everywhere
            </Button>
          </div>
        </CardContent>
      </Card>

      {subject?.kind === "change-password" && (
        <ChangePasswordDialog key={`change-password-${dialog.openKey}`} open={dialog.open} onOpenChange={onOpenChange} />
      )}
      {subject?.kind === "change-email" && (
        <ChangeEmailDialog
          key={`change-email-${dialog.openKey}`}
          open={dialog.open}
          currentEmail={subject.currentEmail}
          onOpenChange={onOpenChange}
        />
      )}
      {subject?.kind === "sign-out-everywhere" && (
        <SignOutEverywhereDialog key={`sign-out-everywhere-${dialog.openKey}`} open={dialog.open} onOpenChange={onOpenChange} />
      )}
    </>
  );
}

/** One of the card's two values, pending until the session is read. */
function AccountDetail({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="flex items-center justify-between gap-4 text-[13px]">
      <dt className="text-[#5a7d82]">{label}</dt>
      <dd className="min-w-0 truncate font-medium text-[#0c1a1e]">
        {value ?? <TextSkeleton className="w-32 bg-[rgba(13,148,136,0.08)]" />}
      </dd>
    </div>
  );
}
