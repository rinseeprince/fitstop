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
  const [lastRefresh, setLastRefresh] = useState<number>(0);
  const [checkInStatus, setCheckInStatus] = useState<any>(null);

  const STORAGE_KEY = "client_last_seen_notifications";
  const CACHE_DURATION = 30 * 1000; // 30 seconds
  const NOTIFICATION_REFRESH_INTERVAL = 60 * 1000; // 1 minute for check-in notifications
  const CONTENT_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes for content notifications

  useEffect(() => {
    if (!user) return;
    
    // Load last seen timestamp from localStorage
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setLastSeenTimestamp(stored);
    }
    
    // Fetch notifications on mount
    refreshNotifications();
    
    // Set up smart refresh intervals
    const notificationInterval = setInterval(() => {
      refreshNotifications('notifications');
    }, NOTIFICATION_REFRESH_INTERVAL);
    
    const contentInterval = setInterval(() => {
      refreshNotifications('content');
    }, CONTENT_REFRESH_INTERVAL);
    
    return () => {
      clearInterval(notificationInterval);
      clearInterval(contentInterval);
    };
  }, [user]);

  const refreshNotifications = async (type: 'all' | 'notifications' | 'content' = 'all') => {
    if (!user) return;
    
    // Check cache freshness - avoid unnecessary requests
    const now = Date.now();
    if (type === 'all' && now - lastRefresh < CACHE_DURATION) {
      console.debug('Skipping refresh - cache still fresh');
      return;
    }
    
    try {
      // Conditional fetching based on type
      const requests = [];
      
      if (type === 'all' || type === 'notifications') {
        requests.push(fetch("/api/client/notifications"));
      } else {
        requests.push(Promise.resolve(null));
      }
      
      if (type === 'all' || type === 'content') {
        requests.push(fetch("/api/client/resources"));
      } else {
        requests.push(Promise.resolve(null));
      }
      
      const [notificationsResponse, resourcesResponse] = await Promise.all(requests);
      
      let allNotifications: ClientNotification[] = [];
      
      // Add check-in and other notifications
      if (notificationsResponse && notificationsResponse.ok) {
        const notificationsData = await notificationsResponse.json();
        if (notificationsData.success) {
          allNotifications.push(...notificationsData.data.notifications);
          
          // Cache check-in status for smarter updates
          if (notificationsData.data.checkInStatus) {
            setCheckInStatus(notificationsData.data.checkInStatus);
          }
        }
      } else if (type === 'content') {
        // If only refreshing content, keep existing check-in notifications
        allNotifications.push(...notifications.filter(n => n.type === 'check-in'));
      }
      
      // Add content notifications
      if (resourcesResponse && resourcesResponse.ok) {
        const resourcesData = await resourcesResponse.json();
        const resources = resourcesData.data;
        
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
          
        allNotifications.push(...contentNotifications);
      } else if (type === 'notifications') {
        // If only refreshing notifications, keep existing content notifications
        allNotifications.push(...notifications.filter(n => n.type === 'content'));
      }

      // Sort notifications by priority and timestamp
      allNotifications.sort((a, b) => {
        // Check-in notifications have priority
        if (a.type === "check-in" && b.type !== "check-in") return -1;
        if (a.type !== "check-in" && b.type === "check-in") return 1;
        
        // Within check-in notifications, sort by severity
        if (a.type === "check-in" && b.type === "check-in") {
          const aOverdue = a.metadata?.severity;
          const bOverdue = b.metadata?.severity;
          
          if (aOverdue && !bOverdue) return -1;
          if (!aOverdue && bOverdue) return 1;
          if (aOverdue && bOverdue) {
            const severityOrder = { critical: 0, urgent: 1, overdue: 2 };
            return (severityOrder[aOverdue as keyof typeof severityOrder] || 3) - 
                   (severityOrder[bOverdue as keyof typeof severityOrder] || 3);
          }
        }
        
        // Then by timestamp (newest first)
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });

      // Limit to 20 most recent
      allNotifications = allNotifications.slice(0, 20);

      setNotifications(allNotifications);
      setLastRefresh(now);
      
      console.info("Refreshed client notifications", {
        type,
        checkInNotifications: allNotifications.filter(n => n.type === "check-in").length,
        contentNotifications: allNotifications.filter(n => n.type === "content").length,
        totalNotifications: allNotifications.length,
        unreadCount: allNotifications.filter(n => !n.read).length,
        timestamp: new Date().toISOString(),
        cacheAge: now - lastRefresh
      });
      
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