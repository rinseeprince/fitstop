"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangeEmailDialog } from "@/components/auth/change-email-dialog";
import { ChangePasswordDialog } from "@/components/auth/change-password-dialog";
import { useAuth } from "@/contexts/auth-context";
import { useDialogSubject } from "@/hooks/use-dialog-subject";
import { CLIENT_SETTINGS_PAGE } from "@/lib/constants";

/** The dialog the card has open, with what it shows: change email shows the address the session held. */
type AccountDialog = { kind: "change-password" } | { kind: "change-email"; currentEmail: string };

/**
 * The client's Account card on Settings, between Profile and Units (rule 13):
 * Change password and Change email, as the coach's (rules 6 and 17, D18).
 * Change email is handed the address the client signs in with, Better Auth's
 * session's, and waits until the session is read; both of its links land back
 * on this page. One dialog at a time (`useDialogSubject`): a close leaves it
 * showing what it showed, and each open mounts it fresh.
 */
export function ClientAccountCard() {
  const { user } = useAuth();
  const dialog = useDialogSubject<AccountDialog>();
  const onOpenChange = (next: boolean) => {
    if (!next) dialog.close();
  };
  const subject = dialog.subject;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => dialog.show({ kind: "change-password" })}>
            Change password
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!user}
            onClick={() => user && dialog.show({ kind: "change-email", currentEmail: user.email })}
          >
            Change email
          </Button>
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
          landing={CLIENT_SETTINGS_PAGE}
          onOpenChange={onOpenChange}
        />
      )}
    </>
  );
}
