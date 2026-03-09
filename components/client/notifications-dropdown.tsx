"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Bell, FileText, CheckCircle, BookOpen, Dumbbell, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useClientNotifications } from "@/hooks/use-client-notifications";
import { formatDistanceToNow } from "date-fns";

export function ClientNotificationsDropdown() {
  const { 
    notifications, 
    unreadCount, 
    markAllAsRead,
    markNotificationAsRead 
  } = useClientNotifications();
  
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open && unreadCount > 0) {
      // Mark all as read when dropdown opens
      markAllAsRead();
    }
  }, [open, unreadCount, markAllAsRead]);

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "content":
        return <BookOpen className="h-4 w-4" />;
      case "training":
        return <Dumbbell className="h-4 w-4" />;
      case "check-in":
        return <FileText className="h-4 w-4" />;
      case "message":
        return <MessageSquare className="h-4 w-4" />;
      default:
        return <Bell className="h-4 w-4" />;
    }
  };

  const getNotificationColor = (type: string) => {
    switch (type) {
      case "content":
        return "bg-primary/15 text-primary";
      case "training":
        return "bg-training/15 text-training";
      case "check-in":
        return "bg-warning/15 text-warning";
      case "message":
        return "bg-success/15 text-success";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const handleNotificationClick = (notification: any) => {
    markNotificationAsRead(notification.id);
    setOpen(false);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-4 w-4 flex items-center justify-center p-0 text-xs"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notifications</span>
          {unreadCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {unreadCount} new
            </Badge>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {notifications.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mx-auto mb-2">
              <CheckCircle className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="font-medium">All caught up!</p>
            <p className="text-xs mt-1">No new notifications</p>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {/* Group notifications by type */}
            {notifications.filter(n => n.type === "content").length > 0 && (
              <>
                <div className="px-2 py-1.5 text-xs font-semibold text-primary flex items-center gap-1">
                  <BookOpen className="h-3 w-3" />
                  New Resources
                </div>
                {notifications
                  .filter(n => n.type === "content")
                  .map((notification) => (
                    <DropdownMenuItem key={notification.id} asChild>
                      <Link
                        href={notification.actionUrl}
                        className="flex items-start gap-3 p-3 cursor-pointer"
                        onClick={() => handleNotificationClick(notification)}
                      >
                        <div className={`flex h-8 w-8 items-center justify-center rounded-full flex-shrink-0 ${getNotificationColor(notification.type)}`}>
                          {getNotificationIcon(notification.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {notification.title}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {notification.description}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatDistanceToNow(new Date(notification.timestamp), { addSuffix: true })}
                          </p>
                        </div>
                        {!notification.read && (
                          <div className="w-2 h-2 bg-primary rounded-full flex-shrink-0 mt-2" />
                        )}
                      </Link>
                    </DropdownMenuItem>
                  ))}
              </>
            )}

            {/* Future notification types can be added here */}
            {notifications.filter(n => n.type === "training").length > 0 && (
              <>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5 text-xs font-semibold text-training flex items-center gap-1">
                  <Dumbbell className="h-3 w-3" />
                  Training Updates
                </div>
                {notifications
                  .filter(n => n.type === "training")
                  .map((notification) => (
                    <DropdownMenuItem key={notification.id} asChild>
                      <Link
                        href={notification.actionUrl}
                        className="flex items-start gap-3 p-3 cursor-pointer"
                        onClick={() => handleNotificationClick(notification)}
                      >
                        <div className={`flex h-8 w-8 items-center justify-center rounded-full flex-shrink-0 ${getNotificationColor(notification.type)}`}>
                          {getNotificationIcon(notification.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {notification.title}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {notification.description}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatDistanceToNow(new Date(notification.timestamp), { addSuffix: true })}
                          </p>
                        </div>
                        {!notification.read && (
                          <div className="w-2 h-2 bg-primary rounded-full flex-shrink-0 mt-2" />
                        )}
                      </Link>
                    </DropdownMenuItem>
                  ))}
              </>
            )}
          </div>
        )}

        {notifications.length > 5 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link
                href="/client/notifications"
                className="w-full text-center text-sm font-medium cursor-pointer"
                onClick={() => setOpen(false)}
              >
                View all notifications
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}