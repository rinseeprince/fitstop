import { supabaseAdmin } from "./supabase-admin";
import { mapFolderFromDatabase } from "@/lib/content-mappers";
import type {
  ContentFolder,
  CreateContentFolderInput,
  UpdateContentFolderInput,
} from "@/types/content";

export const createContentFolder = async (
  input: CreateContentFolderInput,
): Promise<ContentFolder> => {
  const { data, error } = await supabaseAdmin
    .from("content_folders")
    .insert({
      coach_id: input.coachId,
      name: input.name,
      parent_folder_id: input.parentFolderId,
      sort_order: input.sortOrder || 0,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create folder: ${error.message}`);
  }

  return mapFolderFromDatabase(data);
};

export const updateContentFolder = async (
  folderId: string,
  input: UpdateContentFolderInput,
): Promise<ContentFolder> => {
  const { data, error } = await supabaseAdmin
    .from("content_folders")
    .update({
      name: input.name,
      parent_folder_id: input.parentFolderId,
      sort_order: input.sortOrder,
    })
    .eq("id", folderId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update folder: ${error.message}`);
  }

  return mapFolderFromDatabase(data);
};

export const deleteContentFolder = async (folderId: string): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("content_folders")
    .delete()
    .eq("id", folderId);

  if (error) {
    throw new Error(`Failed to delete folder: ${error.message}`);
  }
};

export const getCoachFolders = async (
  coachId: string,
): Promise<ContentFolder[]> => {
  const { data, error } = await supabaseAdmin
    .from("content_folders")
    .select("*")
    .eq("coach_id", coachId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch folders: ${error.message}`);
  }

  return data.map(mapFolderFromDatabase);
};
