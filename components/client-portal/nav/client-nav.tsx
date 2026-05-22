"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Home, BarChart3, Dumbbell, BookOpen, LogOut, Settings } from "lucide-react";
import type { User } from "@supabase/supabase-js";

import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ClientNotificationsDropdown } from "@/components/client/notifications-dropdown";
import type { Client } from "@/types/check-in";

// --- Top bar ---

type ClientTopBarProps = {
  client: Client | null;
  user: User;
};

function getInitials(client: Client | null, user: User): string {
  if (client?.name) {
    const tokens = client.name.trim().split(/\s+/);
    const initials = tokens
      .slice(0, 2)
      .map((t) => t[0]?.toUpperCase() ?? "")
      .join("");
    if (initials) return initials;
  }
  return user.email?.[0]?.toUpperCase() ?? "?";
}

export function ClientTopBar({ client, user }: ClientTopBarProps) {
  const router = useRouter();
  const { logout } = useAuth();

  const handleSignOut = async () => {
    await logout();
    router.push("/login");
  };

  const initials = getInitials(client, user);
  const avatarUrl = client?.avatarUrl;

  return (
    <header className="fixed inset-x-0 top-0 z-40 h-14 border-b bg-card">
      <div className="mx-auto flex h-full max-w-2xl items-center justify-between px-4">
        <Link href="/client" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Dumbbell className="h-4 w-4" strokeWidth={1.5} />
          </div>
          <span className="font-semibold">CoachHub</span>
        </Link>

        <div className="flex items-center gap-2">
          <ClientNotificationsDropdown />

          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Open account menu"
              className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Avatar className="h-8 w-8">
                {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href="/client/settings">
                  <Settings className="mr-2 h-4 w-4" strokeWidth={1.5} />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleSignOut}>
                <LogOut className="mr-2 h-4 w-4" strokeWidth={1.5} />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}

// --- Bottom tab bar ---

type TabValue = "home" | "metrics" | "program" | "content";

type TabConfig = {
  value: TabValue;
  label: string;
  href: string;
  icon: typeof Home;
  isActive: (pathname: string) => boolean;
};

const TABS: readonly TabConfig[] = [
  {
    value: "home",
    label: "Home",
    href: "/client",
    icon: Home,
    isActive: (pathname) => pathname === "/client",
  },
  {
    value: "metrics",
    label: "Metrics",
    href: "/client/metrics",
    icon: BarChart3,
    isActive: (pathname) => pathname.startsWith("/client/metrics"),
  },
  {
    value: "program",
    label: "Program",
    href: "/client/program",
    icon: Dumbbell,
    isActive: (pathname) => pathname.startsWith("/client/program"),
  },
  {
    value: "content",
    label: "Content",
    href: "/client/resources",
    icon: BookOpen,
    isActive: (pathname) => pathname.startsWith("/client/resources"),
  },
];

export function ClientBottomTabBar() {
  const pathname = usePathname() ?? "";

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex h-16 max-w-2xl items-stretch">
        {TABS.map((tab) => {
          const active = tab.isActive(pathname);
          const Icon = tab.icon;
          return (
            <li key={tab.value} className="flex-1">
              <Link
                href={tab.href}
                data-active={active}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-1 text-xs font-medium",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
                <span>{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
