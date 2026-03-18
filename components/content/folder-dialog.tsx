"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle } from "lucide-react";
import type { ContentFolder } from "@/types/content";

interface FolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: ContentFolder[];
  folder?: ContentFolder; // For editing existing folder
  onSuccess?: () => void;
}

export function FolderDialog({
  open,
  onOpenChange,
  folders,
  folder,
  onSuccess,
}: FolderDialogProps) {
  const [name, setName] = useState(folder?.name || "");
  const [parentFolderId, setParentFolderId] = useState<string | undefined>(folder?.parentFolderId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isEditing = !!folder;

  // Filter out the current folder and its descendants from parent options
  const availableParentFolders = folders.filter((f) => {
    if (isEditing && f.id === folder.id) return false;
    if (isEditing && f.parentFolderId === folder.id) return false;
    return true;
  });

  // Only show root folders (no parent) as parent options for simplicity
  const rootFolders = availableParentFolders.filter((f) => !f.parentFolderId);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("Folder name is required");
      return;
    }

    // Check for duplicate names at the same level
    const duplicateExists = folders.some((f) => 
      f.name.toLowerCase() === name.trim().toLowerCase() &&
      f.parentFolderId === (parentFolderId || null) &&
      (!isEditing || f.id !== folder.id)
    );

    if (duplicateExists) {
      setError("A folder with this name already exists at this level");
      return;
    }

    setLoading(true);
    setError("");

    try {
      if (isEditing) {
        // Update existing folder
        const response = await fetch(`/api/content/folders/${folder.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            parentFolderId: parentFolderId,
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to update folder");
        }
      } else {
        // Create new folder
        const response = await fetch("/api/content/folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            parentFolderId: parentFolderId,
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to create folder");
        }
      }

      // Reset form
      setName("");
      setParentFolderId(undefined);
      
      onSuccess?.();
      onOpenChange(false);
    } catch (_error) {
      setError(isEditing ? "Failed to update folder" : "Failed to create folder");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setName(folder?.name || "");
      setParentFolderId(folder?.parentFolderId);
      setError("");
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Folder" : "Create New Folder"}
          </DialogTitle>
          <DialogDescription>
            {isEditing 
              ? "Update folder name and location"
              : "Create a new folder to organize your content"
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="folder-name">Folder Name *</Label>
            <Input
              id="folder-name"
              placeholder="Enter folder name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
            />
          </div>

          <div className="space-y-2">
            <Label>Parent Folder</Label>
            <Select value={parentFolderId || "none"} onValueChange={(value) => setParentFolderId(value === "none" ? undefined : value)}>
              <SelectTrigger>
                <SelectValue placeholder="Select parent folder" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (root level)</SelectItem>
                {rootFolders.map((folder) => (
                  <SelectItem key={folder.id} value={folder.id}>
                    {folder.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-lg">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !name.trim()}>
            {loading 
              ? (isEditing ? "Updating..." : "Creating...") 
              : (isEditing ? "Update Folder" : "Create Folder")
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}