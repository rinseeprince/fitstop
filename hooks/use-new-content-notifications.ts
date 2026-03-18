"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";

interface NewContentNotifications {
  newContentCount: number;
  markContentAsSeen: () => void;
  checkForNewContent: () => Promise<void>;
}

export function useNewContentNotifications(): NewContentNotifications {
  const { user } = useAuth();
  const [newContentCount, setNewContentCount] = useState(0);
  const [lastSeenCount, setLastSeenCount] = useState(0);

  const STORAGE_KEY = "client_last_seen_content_count";

  useEffect(() => {
    if (!user) return;
    
    // Load last seen count from localStorage
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setLastSeenCount(parseInt(stored, 10));
    }
    
    // Check for new content on mount
    checkForNewContent();
    
    // Set up periodic check for new content (every 30 seconds)
    const interval = setInterval(() => void checkForNewContent(), 30000);
    
    return () => clearInterval(interval);
  }, [user]);

  const checkForNewContent = async () => {
    if (!user) return;
    
    try {
      const response = await fetch("/api/client/resources");
      if (response.ok) {
        const data = await response.json();
        const resources = data.data;
        const totalAssignedContent = resources?.assignedContent?.length || 0;
        
        // Calculate new content count based on difference from last seen
        const newCount = Math.max(0, totalAssignedContent - lastSeenCount);
        setNewContentCount(newCount);
        
        console.info("Checked for new content", {
          totalAssignedContent,
          lastSeenCount,
          newCount,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error("Error checking for new content:", error);
    }
  };

  const markContentAsSeen = () => {
    // Mark current content as seen by updating the last seen count
    const currentCount = lastSeenCount + newContentCount;
    setLastSeenCount(currentCount);
    setNewContentCount(0);
    
    // Persist to localStorage
    localStorage.setItem(STORAGE_KEY, currentCount.toString());
    
    console.info("Marked content as seen", {
      previousLastSeen: lastSeenCount,
      newLastSeen: currentCount,
      timestamp: new Date().toISOString()
    });
  };

  return {
    newContentCount,
    markContentAsSeen,
    checkForNewContent,
  };
}