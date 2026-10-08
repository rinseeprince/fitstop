"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangePasswordDialog } from "@/components/auth/change-password-dialog";
import { useDialogSubject } from "@/hooks/use-dialog-subject";

/**
 * The client's Account card on Settings, between Profile and Units (rule 13):
 * Change password, as the coach's (rule 6). A client changes no email (D18).
 * Each open mounts the dialog fresh; a close leaves it showing what it showed.
 */
export function ClientAccountCard() {
  const dialog = useDialogSubject<"change-password">();

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" onClick={() => dialog.show("change-password")}>
            Change password
          </Button>
        </CardContent>
      </Card>

      {dialog.subject === "change-password" && (
        <ChangePasswordDialog
          key={`change-password-${dialog.openKey}`}
          open={dialog.open}
          onOpenChange={(next) => {
            if (!next) dialog.close();
          }}
        />
      )}
    </>
  );
}
