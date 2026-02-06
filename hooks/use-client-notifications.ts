"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";

export interface ClientNotification {
  id: string;
  type: "content" | "training" | "check-in" | "message";
  title: string;
  description: string;
  timestamp: string;
  actionUrl: string;
  read: boolean;
  metadata?: Record<string, any>;
}

interface ClientNotifications {
  notifications: ClientNotification[];
  unreadCount: number;
  markAllAsRead: () => void;
  markNotificationAsRead: (notificationId: string) => void;
  refreshNotifications: () => Promise<void>;
}

export function useClientNotifications(): ClientNotifications {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<ClientNotification[]>([]);
  const [lastSeenTimestamp, setLastSeenTimestamp] = useState<string>("");

  const STORAGE_KEY = "client_last_seen_notifications";

  useEffect(() => {
    if (!user) return;
    
    // Load last seen timestamp from localStorage
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setLastSeenTimestamp(stored);
    }
    
    // Fetch notifications on mount
    refreshNotifications();
    
    // Set up periodic refresh (every 30 seconds)
    const interval = setInterval(refreshNotifications, 30000);
    
    return () => clearInterval(interval);
  }, [user]);

  const refreshNotifications = async () => {
    if (!user) return;
    
    try {
      const response = await fetch("/api/client/resources");
      if (response.ok) {
        const data = await response.json();
        const resources = data.data;
        
        // Convert assigned content to notifications
        const contentNotifications: ClientNotification[] = 
          (resources?.assignedContent || []).map((content: any) => ({
            id: `content-${content.id}`,
            type: "content" as const,
            title: content.title,
            description: `New ${content.type === "video_link" ? "video" : 
                         content.type === "pdf" ? "document" : 
                         content.type === "image" ? "image" : "resource"} from your coach`,
            timestamp: content.createdAt,
            actionUrl: "/client/resources",
            read: lastSeenTimestamp ? new Date(content.createdAt) <= new Date(lastSeenTimestamp) : false,
            metadata: {
              contentId: content.id,
              contentType: content.type,
            }
          }));

        // Sort notifications by timestamp (newest first)
        const allNotifications = [...contentNotifications]
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, 20); // Limit to 20 most recent

        setNotifications(allNotifications);
        
        console.info("Refreshed client notifications", {
          contentNotifications: contentNotifications.length,
          totalNotifications: allNotifications.length,
          unreadCount: allNotifications.filter(n => !n.read).length,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error("Error refreshing client notifications:", error);
    }
  };

  const markAllAsRead = useCallback(() => {
    const now = new Date().toISOString();
    setLastSeenTimestamp(now);
    localStorage.setItem(STORAGE_KEY, now);
    
    // Update notifications to mark as read and get previous unread count
    setNotifications(prev => {
      const previousUnread = prev.filter(n => !n.read).length;
      
      console.info("Marked all notifications as read", {
        timestamp: now,
        previousUnread
      });
      
      return prev.map(notification => ({ ...notification, read: true }));
    });
  }, []);

  const markNotificationAsRead = useCallback((notificationId: string) => {
    setNotifications(prev =>
      prev.map(notification =>
        notification.id === notificationId
          ? { ...notification, read: true }
          : notification
      )
    );
    
    console.info("Marked notification as read", {
      notificationId,
      timestamp: new Date().toISOString()
    });
  }, []);

  const unreadCount = notifications.filter(notification => !notification.read).length;

  return {
    notifications,
    unreadCount,
    markAllAsRead,
    markNotificationAsRead,
    refreshNotifications,
  };
}