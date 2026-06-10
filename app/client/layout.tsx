"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "@/contexts/auth-context";
import { useClientProfile } from "@/hooks/use-client-profile";
import { useTimezoneSync } from "@/hooks/use-timezone-sync";
import { ClientWaitingState } from "@/components/client/walkthrough/client-waiting-state";
import {
  ClientTopBar,
  ClientBottomTabBar,
} from "@/components/client-portal/nav/client-nav";

function LoadingState() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

function ProfileLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <p className="text-destructive">We couldn&apos;t load your profile.</p>
      <button
        type="button"
        onClick={onRetry}
        className="text-sm text-primary underline"
      >
        Try again
      </button>
    </div>
  );
}

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading: authLoading } = useAuth();
  const { client, error, isLoading: clientLoading, mutate } = useClientProfile();
  const pathname = usePathname() ?? "";
  const router = useRouter();

  // Keep the stored timezone in sync with the device (Session 7.81).
  useTimezoneSync("client", client?.timezone);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (
      client?.onboardingStatus === "pending_intake" &&
      pathname !== "/client/onboarding"
    ) {
      router.replace("/client/onboarding");
    }
  }, [client, pathname, router]);

  if (authLoading) return <LoadingState />;
  if (!user) return null;

  const isOnboardingRoute = pathname === "/client/onboarding";

  if (isOnboardingRoute) {
    return (
      <>
        <ClientTopBar client={client} user={user} />
        <main className="mx-auto max-w-2xl pt-14 px-4">{children}</main>
      </>
    );
  }

  if (clientLoading && !client) {
    return (
      <>
        <ClientTopBar client={null} user={user} />
        <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-2xl items-center justify-center px-4 mt-14">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </main>
      </>
    );
  }

  if (error || !client) {
    return (
      <>
        <ClientTopBar client={null} user={user} />
        <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-2xl items-center justify-center px-4 mt-14">
          <ProfileLoadError onRetry={() => mutate()} />
        </main>
      </>
    );
  }

  if (client.onboardingStatus === "pending_intake") return null;

  if (client.onboardingStatus !== "active") {
    return (
      <>
        <ClientTopBar client={client} user={user} />
        <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-2xl items-center justify-center px-4 mt-14">
          <ClientWaitingState onboardingStatus={client.onboardingStatus} />
        </main>
      </>
    );
  }

  return (
    <>
      <ClientTopBar client={client} user={user} />
      <main className="mx-auto max-w-2xl pt-14 pb-[calc(4rem+env(safe-area-inset-bottom))] px-4">
        {children}
      </main>
      <ClientBottomTabBar />
    </>
  );
}
