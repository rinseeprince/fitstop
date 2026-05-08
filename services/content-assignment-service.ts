import { supabaseAdmin } from "./supabase-admin";
import {
  mapAssignmentFromDatabase,
  mapContentItemFromDatabase,
} from "@/lib/content-mappers";
import type {
  ContentAssignment,
  ContentItem,
  CreateContentAssignmentInput,
} from "@/types/content";

export const assignContentToClient = async (
  input: CreateContentAssignmentInput,
): Promise<ContentAssignment> => {
  const { data, error } = await supabaseAdmin
    .from("content_assignments")
    .insert({
      content_id: input.contentId,
      client_id: input.clientId,
      assigned_by: input.assignedBy,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to assign content: ${error.message}`);
  }

  return mapAssignmentFromDatabase(data);
};

export const unassignContentFromClient = async (
  contentId: string,
  clientId: string,
): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("content_assignments")
    .delete()
    .eq("content_id", contentId)
    .eq("client_id", clientId);

  if (error) {
    throw new Error(`Failed to unassign content: ${error.message}`);
  }
};

export const getContentAssignments = async (
  contentId: string,
): Promise<ContentAssignment[]> => {
  const { data, error } = await supabaseAdmin
    .from("content_assignments")
    .select("*")
    .eq("content_id", contentId);

  if (error) {
    throw new Error(`Failed to fetch assignments: ${error.message}`);
  }

  return data.map(mapAssignmentFromDatabase);
};

export const getClientAssignedContent = async (
  clientId: string,
): Promise<ContentItem[]> => {
  // First, get all content IDs assigned to this client
  const { data: assignmentData, error: assignmentError } = await supabaseAdmin
    .from("content_assignments")
    .select("content_id, assigned_at")
    .eq("client_id", clientId)
    .order("assigned_at", { ascending: false });

  if (assignmentError) {
    console.error("Error fetching content assignments:", {
      error: assignmentError,
      clientId,
      timestamp: new Date().toISOString(),
    });
    throw new Error(
      `Failed to fetch content assignments: ${assignmentError.message}`,
    );
  }

  if (!assignmentData || assignmentData.length === 0) {
    console.info("No content assignments found for client", { clientId });
    return [];
  }

  const contentIds = assignmentData.map((a) => a.content_id);

  // Then get the actual content items
  const { data: contentData, error: contentError } = await supabaseAdmin
    .from("content_items")
    .select("*")
    .in("id", contentIds)
    .order("created_at", { ascending: false });

  if (contentError) {
    console.error("Error fetching assigned content items:", {
      error: contentError,
      clientId,
      contentIds,
      timestamp: new Date().toISOString(),
    });
    throw new Error(
      `Failed to fetch assigned content items: ${contentError.message}`,
    );
  }

  console.info("Successfully fetched assigned content", {
    clientId,
    assignmentCount: assignmentData.length,
    contentCount: contentData?.length || 0,
  });

  return (contentData || []).map(mapContentItemFromDatabase);
};
