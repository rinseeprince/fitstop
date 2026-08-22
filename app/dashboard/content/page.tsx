"use client";

import { useState, useEffect } from "react";
import { AppLayout } from "@/components/app-layout";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ContentUploadDialog } from "@/components/content/content-upload-dialog";
import { FolderDialog } from "@/components/content/folder-dialog";
import { AssignmentDialog } from "@/components/content/assignment-dialog";
import { Plus, FolderPlus, Grid, List, Filter, FileText, Image, Video, ExternalLink, MoreHorizontal, Folder, FolderOpen, Edit, Trash2, Users, Download } from "lucide-react";
import type { ContentLibraryResponse, ContentItem, ContentFolder } from "@/types/content";
import { cn } from "@/lib/utils";
import { MONO } from "@/components/clients/training/program-builder/builder-tokens";
import { LibrarySearchInput } from "@/components/programs/shared/library-search-input";

export default function ContentLibraryPage() {
  const [library, setLibrary] = useState<ContentLibraryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string | null; name: string; }[]>([
    { id: null, name: "Content Library" }
  ]);
  
  // Dialog states
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
  const [selectedContent, setSelectedContent] = useState<ContentItem | null>(null);
  const [editingFolder, setEditingFolder] = useState<ContentFolder | null>(null);

  useEffect(() => {
    fetchContent();
  }, []);

  const fetchContent = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/content/library");
      if (response.ok) {
        const data = await response.json();
        setLibrary(data.data);
      }
    } catch (error) {
      console.error("Error fetching content library:", error);
    } finally {
      setLoading(false);
    }
  };

  const getContentIcon = (type: string) => {
    switch (type) {
      case "video_link":
        return <Video className="h-4 w-4" />;
      case "hyperlink":
        return <ExternalLink className="h-4 w-4" />;
      case "pdf":
      case "document":
        return <FileText className="h-4 w-4" />;
      case "image":
        return <Image className="h-4 w-4" />;
      default:
        return <FileText className="h-4 w-4" />;
    }
  };

  const getContentTypeColor = (_type: string) => {
    return "bg-[rgba(13,148,136,0.05)] text-[#5a7d82]";
  };

  const getCurrentFolderData = () => {
    if (!currentFolder || !library) {
      return {
        folders: library?.folders || [],
        items: library?.rootItems || [],
      };
    }

    const findFolder = (folders: any[], id: string): any => {
      for (const folder of folders) {
        if (folder.id === id) return folder;
        if (folder.subfolders) {
          const found = findFolder(folder.subfolders, id);
          if (found) return found;
        }
      }
      return null;
    };

    const folder = findFolder(library.folders, currentFolder);
    return {
      folders: folder?.subfolders || [],
      items: folder?.items || [],
    };
  };

  const navigateToFolder = (folder: ContentFolder | null) => {
    if (folder) {
      setCurrentFolder(folder.id);
      setBreadcrumbs([
        { id: null, name: "Content Library" },
        { id: folder.id, name: folder.name },
      ]);
    } else {
      setCurrentFolder(null);
      setBreadcrumbs([{ id: null, name: "Content Library" }]);
    }
  };

  const filteredData = () => {
    const { folders, items } = getCurrentFolderData();
    
    if (!searchQuery) return { folders, items };

    return {
      folders: folders.filter((folder: ContentFolder) =>
        folder.name.toLowerCase().includes(searchQuery.toLowerCase())
      ),
      items: items.filter((item: ContentItem) =>
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.description?.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    };
  };

  const handleContentAction = (action: string, content: ContentItem) => {
    switch (action) {
      case "assign":
        setSelectedContent(content);
        setAssignmentDialogOpen(true);
        break;
      case "edit":
        // TODO: Implement content edit dialog
        break;
      case "delete":
        handleDeleteContent(content.id);
        break;
    }
  };

  const handleFolderAction = (action: string, folder: ContentFolder) => {
    switch (action) {
      case "edit":
        setEditingFolder(folder);
        setFolderDialogOpen(true);
        break;
      case "delete":
        handleDeleteFolder(folder.id);
        break;
    }
  };

  const handleDeleteContent = async (contentId: string) => {
    if (!confirm("Are you sure you want to delete this content? This action cannot be undone.")) {
      return;
    }

    try {
      const response = await fetch(`/api/content/items/${contentId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        await fetchContent();
      }
    } catch (error) {
      console.error("Error deleting content:", error);
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    if (!confirm("Are you sure you want to delete this folder? Content inside will be moved to the root level.")) {
      return;
    }

    try {
      const response = await fetch(`/api/content/folders/${folderId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        await fetchContent();
        // If we're currently in the deleted folder, navigate to root
        if (currentFolder === folderId) {
          navigateToFolder(null);
        }
      }
    } catch (error) {
      console.error("Error deleting folder:", error);
    }
  };

  const handleDialogSuccess = async () => {
    await fetchContent();
    setEditingFolder(null);
  };

  const pageHeader = (
    <PageHeader
      title="Content Library"
      description="Organize and share resources with your clients"
    />
  );

  if (loading) {
    return (
      <AppLayout pageHeader={pageHeader}>
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-10 w-32" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  const { folders, items } = filteredData();

  const headerActions = (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 rounded-[6px] text-[#5a7d82] hover:text-[#0c1a1e] hover:bg-[rgba(0,0,0,0.02)] transition-colors"
        onClick={() => setFolderDialogOpen(true)}
      >
        <FolderPlus className="h-4 w-4" strokeWidth={1.5} />
        <span className="sr-only">Create New Folder</span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 rounded-[6px] text-[#5a7d82] hover:text-[#0c1a1e] hover:bg-[rgba(0,0,0,0.02)] transition-colors"
        onClick={() => setUploadDialogOpen(true)}
      >
        <Plus className="h-4 w-4" strokeWidth={1.5} />
        <span className="sr-only">Add Content</span>
      </Button>
    </div>
  );

  return (
    <AppLayout pageHeader={pageHeader} headerActions={headerActions}>
      <div className="space-y-6">
        {/* Breadcrumbs */}
        {breadcrumbs.length > 1 && (
          <nav className="flex items-center space-x-2 text-sm text-[#93b0b4]">
            {breadcrumbs.map((crumb, index) => (
              <span key={crumb.id || "root"} className="flex items-center">
                {index > 0 && <span className="mx-2">/</span>}
                <button
                  onClick={() => {
                    if (index === 0) {
                      navigateToFolder(null);
                    }
                  }}
                  className={index === breadcrumbs.length - 1 ? "text-[#0c1a1e]" : "hover:text-[#5a7d82]"}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </nav>
        )}

        {/* Search and Filters */}
        <div className="flex items-center gap-4">
          <LibrarySearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search content"
            className="flex-1 max-w-md"
          />
          <Button
            variant="outline"
            className="bg-white border-[rgba(13,148,136,0.08)] text-[#5a7d82] hover:bg-[rgba(13,148,136,0.05)] hover:text-[#0c1a1e] rounded-[6px]"
          >
            <Filter className="h-4 w-4 mr-2" strokeWidth={1.5} />
            Filter
          </Button>
          <Button
            variant="outline"
            onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
            className="bg-white border-[rgba(13,148,136,0.08)] text-[#5a7d82] hover:bg-[rgba(13,148,136,0.05)] hover:text-[#0c1a1e] rounded-[6px]"
          >
            {viewMode === "grid" ? <List className="h-4 w-4" strokeWidth={1.5} /> : <Grid className="h-4 w-4" strokeWidth={1.5} />}
          </Button>
        </div>

        {/* Empty State */}
        {folders.length === 0 && items.length === 0 && !searchQuery && (
          <div className="text-center py-12">
            <div className="mx-auto w-24 h-24 bg-[rgba(13,148,136,0.05)] rounded-full flex items-center justify-center mb-4">
              <FolderOpen className="h-8 w-8 text-[#93b0b4]" strokeWidth={1.5} />
            </div>
            <h3 className="text-lg font-semibold mb-2 text-[#0c1a1e]">No content yet</h3>
            <p className="text-[#5a7d82]">
              Start building your content library by adding videos, documents, or links.
            </p>
          </div>
        )}

        {/* Folders and Content Grid */}
        {(folders.length > 0 || items.length > 0) && (
          <div className={viewMode === "grid" 
            ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            : "space-y-2"
          }>
            {/* Folders */}
            {folders.map((folder: ContentFolder) => (
              <div
                key={folder.id}
                className="group bg-white rounded-[6px] p-4 transition-all duration-150 hover:-translate-y-px hover:shadow-[0_6px_20px_rgba(13,148,136,0.08)]"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-[rgba(245,158,11,0.07)] cursor-pointer"
                    onClick={() => navigateToFolder(folder)}
                  >
                    <Folder className="h-5 w-5 text-[#d97706]" strokeWidth={1.5} />
                  </div>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigateToFolder(folder)}>
                    <p className="font-semibold truncate text-[#0c1a1e]">{folder.name}</p>
                    <p className="text-sm text-[#5a7d82]">
                      Folder
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-[#93b0b4] hover:text-[#5a7d82] hover:bg-[rgba(0,0,0,0.02)]"
                      >
                        <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleFolderAction("edit", folder)}>
                        <Edit className="h-4 w-4 mr-2" strokeWidth={1.5} />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleFolderAction("delete", folder)}
                        className="text-[#b91c1c]"
                      >
                        <Trash2 className="h-4 w-4 mr-2" strokeWidth={1.5} />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}

            {/* Content Items */}
            {items.map((item: ContentItem) => (
              <div
                key={item.id}
                className="group bg-white rounded-[6px] transition-all duration-150 hover:-translate-y-px hover:shadow-[0_6px_20px_rgba(13,148,136,0.08)]"
              >
                <div className="px-4 pt-4 pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`p-2 rounded-[6px] ${getContentTypeColor(item.type)}`}>
                        {getContentIcon(item.type)}
                      </div>
                      <span className="inline-flex items-center rounded-[4px] bg-[rgba(13,148,136,0.05)] px-2 py-0.5 text-[11px] font-medium text-[#5a7d82]">
                        {item.type.replace("_", " ")}
                      </span>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-[#93b0b4] hover:text-[#5a7d82] hover:bg-[rgba(0,0,0,0.02)]"
                        >
                          <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleContentAction("assign", item)}>
                          <Users className="h-4 w-4 mr-2" strokeWidth={1.5} />
                          Assign to Clients
                        </DropdownMenuItem>
                        {(item.type === "pdf" || item.type === "document" || item.type === "image") && (
                          <DropdownMenuItem onClick={() => window.open(item.storagePath, "_blank")}>
                            <Download className="h-4 w-4 mr-2" strokeWidth={1.5} />
                            Download
                          </DropdownMenuItem>
                        )}
                        {(item.type === "video_link" || item.type === "hyperlink") && (
                          <DropdownMenuItem onClick={() => window.open(item.url, "_blank")}>
                            <ExternalLink className="h-4 w-4 mr-2" strokeWidth={1.5} />
                            Open Link
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => handleContentAction("edit", item)}>
                          <Edit className="h-4 w-4 mr-2" strokeWidth={1.5} />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleContentAction("delete", item)}
                          className="text-[#b91c1c]"
                        >
                          <Trash2 className="h-4 w-4 mr-2" strokeWidth={1.5} />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="px-4 pb-4">
                  <h4 className="font-semibold mb-1 line-clamp-2 text-[#0c1a1e]">{item.title}</h4>
                  {item.description && (
                    <p className="text-sm text-[#5a7d82] line-clamp-2 mb-2">
                      {item.description}
                    </p>
                  )}
                  <div className="flex items-center justify-between text-xs">
                    <span className={cn(MONO, "text-[#93b0b4]")}>{new Date(item.createdAt).toLocaleDateString()}</span>
                    {item.isLibrary ? (
                      <span className="inline-flex items-center rounded-[4px] bg-[rgba(13,148,136,0.05)] px-2 py-0.5 text-[11px] font-medium text-[#5a7d82]">Library</span>
                    ) : (
                      <span className="inline-flex items-center rounded-[4px] bg-[rgba(13,148,136,0.08)] px-2 py-0.5 text-[11px] font-medium text-[#0d9488]">Assigned</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Dialogs */}
      <ContentUploadDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        folders={library ? [...library.folders.filter(f => !f.parentFolderId)] : []}
        onSuccess={handleDialogSuccess}
      />

      <FolderDialog
        open={folderDialogOpen}
        onOpenChange={(open) => {
          setFolderDialogOpen(open);
          if (!open) setEditingFolder(null);
        }}
        folders={library ? [...library.folders] : []}
        folder={editingFolder || undefined}
        onSuccess={handleDialogSuccess}
      />

      {selectedContent && (
        <AssignmentDialog
          open={assignmentDialogOpen}
          onOpenChange={setAssignmentDialogOpen}
          content={selectedContent}
          onSuccess={handleDialogSuccess}
        />
      )}
    </AppLayout>
  );
}